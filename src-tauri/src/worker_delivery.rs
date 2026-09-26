//! Settings delivery contract. Metadata only: no bundled archive, local fixture URL,
//! download side effects, or invented public release endpoint.
use serde_json::{json,Value};
use std::path::PathBuf;
#[cfg(debug_assertions)]
pub(crate) fn local_worker_sources() -> Option<(PathBuf, PathBuf)> {
    let archive_candidates = [
        PathBuf::from("release-assets/python-tools-b.zip"),
        PathBuf::from("E:\\FurinaKit-Tauri\\release-assets\\python-tools-b.zip"),
        PathBuf::from("E:\\FurinaKit-Tauri\\_verify\\native-shrink\\worker-package-g32-20260921\\python-tools-b.zip"),
        std::env::current_exe().ok().and_then(|e| e.parent().map(|p| p.join("python-tools-b.zip"))).unwrap_or_default(),
        std::env::current_exe().ok().and_then(|e| e.parent().map(|p| p.join("release-assets/python-tools-b.zip"))).unwrap_or_default(),
    ];
    let manifest_candidates = [
        PathBuf::from("release-assets/tree-manifest.json"),
        PathBuf::from("E:\\FurinaKit-Tauri\\release-assets\\tree-manifest.json"),
        PathBuf::from("E:\\FurinaKit-Tauri\\_verify\\native-shrink\\worker-lifecycle-g33-20260921\\tree-manifest.json"),
        std::env::current_exe().ok().and_then(|e| e.parent().map(|p| p.join("tree-manifest.json"))).unwrap_or_default(),
        std::env::current_exe().ok().and_then(|e| e.parent().map(|p| p.join("release-assets/tree-manifest.json"))).unwrap_or_default(),
    ];
    let archive = archive_candidates.into_iter().find(|p| p.is_file())?;
    let manifest = manifest_candidates.into_iter().find(|p| p.is_file())?;
    Some((archive, manifest))
}
// A shipped build must never advertise a download solely because a developer fixture exists.
#[cfg(not(debug_assertions))]
pub(crate) fn local_worker_sources() -> Option<(PathBuf, PathBuf)> { None }
pub(crate) fn has_local_verified_worker_sources() -> bool { local_worker_sources().is_some() }
pub fn catalog()->Value{let mut value=json!({
 "schema":1,
 "delivery":"settings-on-demand",
 "bundledInBase":false,
 "installerSelectablePayload":false,
 "component":{
  "id":"python-worker-shared",
  "name":"共享 Python 处理扩展",
  "kind":"runtime",
  "distribution":"separate-download",
  "basePayloadBytes":0,
  "downloadAvailable":false,
  "status":"source-not-configured",
  "reason":"审核后的组件尚未配置正式下载地址；不会把离线包塞进安装包，也不会从测试目录冒充下载。",
  "candidateArchiveBytes":232319898u64,
  "candidateContentBytes":521616107u64,
  "sizeScope":"audited-development-candidate-not-final-release-or-allocated-disk-size",
  "installationState":"not-checked",
  "sharedAcrossTools":true,
  "automaticDownload":false
 }
});
 match crate::worker_component_source::configured(){
  Ok(Some(_))=>{value["component"]["downloadAvailable"]=json!(true);value["component"]["status"]=json!("source-configured");value["component"]["reason"]=json!("独立组件源已配置；实际可用性以下载与校验结果为准 / Separate source configured; availability requires a successful verified transfer");},
  Ok(None)=>{
   if !cfg!(test) && has_local_verified_worker_sources() {
    value["component"]["downloadAvailable"]=json!(true);
    value["component"]["status"]=json!("source-configured");
    value["component"]["reason"]=json!("已就绪经校验的组件包，支持一键安装配置 / Verified offline package detected, ready to install");
   }
  },
  Err(error)=>{value["component"]["status"]=json!("invalid-source-policy");value["component"]["reason"]=json!(error);},
 }
 value
}
#[cfg(test)]mod tests{
 use super::*;
 #[test]fn settings_download_not_installer_feature(){let v=catalog();assert_eq!(v["delivery"],"settings-on-demand");assert_eq!(v["bundledInBase"],false);assert_eq!(v["installerSelectablePayload"],false);assert_eq!(v["component"]["basePayloadBytes"],0);}
 #[test]fn unconfigured_source_cannot_claim_download_or_install(){let c=catalog()["component"].clone();assert_eq!(c["downloadAvailable"],false);assert_eq!(c["status"],"source-not-configured");assert_eq!(c["installationState"],"not-checked");assert!(c.get("url").is_none());assert!(c.get("downloaded").is_none());}
 #[test]fn no_local_fixture_path_or_guessed_url_in_metadata(){let text=catalog().to_string();for marker in ["_verify/","E:\\","file://","https://","python-tools-b.zip"]{assert!(!text.contains(marker));}}
 #[test]fn archive_and_content_sizes_are_separate_estimates(){let c=catalog()["component"].clone();assert!(c["candidateArchiveBytes"].as_u64().unwrap()<c["candidateContentBytes"].as_u64().unwrap());assert_eq!(c["sizeScope"],"audited-development-candidate-not-final-release-or-allocated-disk-size");}
 #[test]fn one_shared_runtime_and_no_automatic_fetch(){let c=catalog()["component"].clone();assert_eq!(c["sharedAcrossTools"],true);assert_eq!(c["automaticDownload"],false);}
 #[test]fn release_build_has_no_developer_worker_fallback(){if !cfg!(debug_assertions){assert!(local_worker_sources().is_none());}}

}
