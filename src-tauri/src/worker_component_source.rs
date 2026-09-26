//! Component source policy compiled into the app, separate from app update feeds.
//! This is a distribution allowlist, not publisher-signature verification.
use serde::Deserialize;
#[derive(Clone,Debug)]pub(crate) struct Sources{pub manifest_urls:Vec<String>,pub archive_urls:Vec<String>}
#[derive(Deserialize)]#[serde(deny_unknown_fields,rename_all="camelCase")]
struct Policy{schema:u32,channel:String,component:String,publication:String,manifest_urls:Vec<String>,archive_urls:Vec<String>}
fn parse(text:&str)->Result<Option<Sources>,String>{
 if text.len()>32768{return Err("Component source policy too large".into());}
 let p:Policy=serde_json::from_str(text).map_err(|e|format!("Invalid component source policy: {e}"))?;
 if p.schema!=1||p.channel!="worker-components-v1"||p.component!="python-worker-shared"{return Err("Wrong component source policy/channel".into());}
 if p.publication=="unpublished"{if !p.manifest_urls.is_empty()||!p.archive_urls.is_empty(){return Err("Unpublished policy cannot advertise sources".into());}return Ok(None);}
 if p.publication!="approved"{return Err("Unknown component publication status".into());}
 for list in [&p.manifest_urls,&p.archive_urls]{
  if list.is_empty()||list.len()>3{return Err("Require one to three approved sources per artifact".into());}
  let mut seen=std::collections::BTreeSet::new();
  for url in list{
   if !seen.insert(url)||!url.is_ascii()||url.len()>4096||url.bytes().any(|b|b<=32||b==127)||url.contains(['@','#','\\']){return Err("Invalid/duplicate component source URL".into());}
   let rest=url.strip_prefix("https://").ok_or("Component source must use HTTPS")?;let(host,path)=rest.split_once('/').ok_or("Artifact path required")?;
   if host.is_empty()||path.is_empty()||!host.bytes().all(|b|b.is_ascii_alphanumeric()||b".-:".contains(&b)){return Err("Invalid source host/path".into());}
   let lower=url.to_ascii_lowercase();
   if lower.contains("github.com/fufu-eng/furinakit/releases")||lower.contains("api.github.com/repos/fufu-eng/furinakit/releases"){return Err("Components must not use the application's release/update channel".into());}
  }
 }
 Ok(Some(Sources{manifest_urls:p.manifest_urls,archive_urls:p.archive_urls}))
}
pub(crate) fn configured()->Result<Option<Sources>,String>{parse(include_str!("../worker-component-source.json"))}
#[cfg(test)]pub(crate) fn test_sources()->Sources{Sources{manifest_urls:vec!["https://component-fixture.invalid/manifest.json".into()],archive_urls:vec!["https://component-fixture.invalid/archive.zip".into()]}}
#[cfg(test)]mod tests{
 use super::*;
 fn policy()->serde_json::Value{serde_json::json!({"schema":1,"channel":"worker-components-v1","component":"python-worker-shared","publication":"approved","manifestUrls":["https://components.example.org/manifest.json"],"archiveUrls":["https://components.example.org/archive.zip"]})}
 #[test]fn compiled_unpublished_policy_never_advertises_a_source(){assert!(configured().unwrap().is_none());}
 #[test]fn separate_https_sources_are_admitted_without_network_io(){assert!(parse(&policy().to_string()).unwrap().is_some());}
 #[test]fn app_release_channel_and_relays_rejected(){for url in ["https://github.com/FUFU-eng/FurinaKit/releases/download/components/worker.zip","https://relay.example/https://github.com/FUFU-eng/FurinaKit/releases/download/x/a","https://api.github.com/repos/FUFU-eng/FurinaKit/releases/latest"]{let mut p=policy();p["archiveUrls"]=serde_json::json!([url]);assert!(parse(&p.to_string()).is_err());}}
 #[test]fn unsafe_schemes_credentials_and_duplicates_rejected(){for list in [vec!["http://127.0.0.1/a"],vec!["file:///a"],vec!["https://user@host/a"],vec!["https://host/a","https://host/a"]]{let mut p=policy();p["archiveUrls"]=serde_json::json!(list);assert!(parse(&p.to_string()).is_err());}}
 #[test]fn empty_or_excess_source_lists_rejected(){for list in [vec![],vec!["https://a/a","https://b/b","https://c/c","https://d/d"]]{let mut p=policy();p["manifestUrls"]=serde_json::json!(list);assert!(parse(&p.to_string()).is_err());}}
 #[test]fn application_version_and_unknown_fields_not_accepted(){let mut p=policy();p["appVersion"]=serde_json::json!("99.0.0");assert!(parse(&p.to_string()).is_err());}
 #[test]fn wrong_channel_schema_and_publication_rejected(){for(key,value)in [("channel",serde_json::json!("app-update")),("schema",serde_json::json!(2)),("publication",serde_json::json!("draft"))]{let mut p=policy();p[key]=value;assert!(parse(&p.to_string()).is_err());}}
 #[test]fn unpublished_source_cannot_be_enabled_by_url_alone(){let mut p=policy();p["publication"]=serde_json::json!("unpublished");assert!(parse(&p.to_string()).is_err());}
}
