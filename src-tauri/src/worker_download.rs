//! Verified network transfer core. No app-update integration or published source.
//! Production permits HTTPS only. Loopback HTTP exists only in test compilation.
use std::{fs::{self,File,OpenOptions},io::{Read,Seek,SeekFrom},path::{Path,PathBuf},sync::{Arc,atomic::{AtomicBool,Ordering}},time::{Duration,Instant}};
use sha2::{Digest,Sha256};
use crate::{download_process::OwnedProcess,resource_custody::Custody,component_store::Store};
const ARCHIVE_SHA:&str="377bc1a1186559b19feadeeb3d66ca395d0d508b5426c639c827b6ce01b80bb4";
const MANIFEST_SHA:&str="50ca47cabddf65f24f77475343a87dc8c7a181d877d7b0d378de7a4e95f5e156";
const ARCHIVE_BYTES:u64=232319898;
const MANIFEST_BYTES:u64=1627003;
#[derive(Clone,Copy)]enum Protocol{Https,#[cfg(test)]Loopback}
fn validate_url(url:&str,protocol:Protocol)->Result<(),String>{
 if url.len()>4096||!url.is_ascii()||url.bytes().any(|b|b<=32||b==127)||url.contains(['@','#','\\']){return Err("Invalid component source URL".into());}
 let rest=match protocol{Protocol::Https=>url.strip_prefix("https://"),#[cfg(test)]Protocol::Loopback=>url.strip_prefix("http://")}.ok_or("Component source protocol rejected")?;
 let (authority,path)=rest.split_once('/').ok_or("Component source path required")?;
 if authority.is_empty()||path.is_empty()||!authority.bytes().all(|b|b.is_ascii_alphanumeric()||b".-:".contains(&b)){return Err("Invalid component source authority".into());}
 #[cfg(test)]if matches!(protocol,Protocol::Loopback){let(host,port)=authority.split_once(':').ok_or("Loopback port required")?;if host!="127.0.0.1"||port.parse::<u16>().ok().filter(|n|*n>0).is_none(){return Err("Test transfer must use numeric IPv4 loopback".into());}}
 Ok(())
}
fn cancelled(cancel:&AtomicBool)->Result<(),String>{if cancel.load(Ordering::Acquire){Err("Download cancelled; incomplete files retained".into())}else{Ok(())}}
fn ordinary(path:&Path,directory:bool)->Result<(),String>{use std::os::windows::fs::MetadataExt;let m=fs::symlink_metadata(path).map_err(|e|e.to_string())?;if m.file_attributes()&0x400!=0||if directory{!m.is_dir()}else{!m.is_file()}{return Err("Linked/nonordinary download path rejected".into());}Ok(())}
fn directory(path:&Path)->Result<(),String>{if !path.is_absolute(){return Err("Absolute download root required".into());}for p in path.ancestors(){ordinary(p,true)?;}Ok(())}
fn curl()->Result<PathBuf,String>{
 #[link(name="kernel32")]extern "system"{fn GetSystemDirectoryW(buffer:*mut u16,size:u32)->u32;}
 let mut buffer=[0u16;32768];let n=unsafe{GetSystemDirectoryW(buffer.as_mut_ptr(),buffer.len()as u32)}as usize;
 if n==0||n>=buffer.len(){return Err("Cannot resolve inbox curl".into());}
 let p=PathBuf::from(String::from_utf16(&buffer[..n]).map_err(|e|e.to_string())?).join("curl.exe");directory(p.parent().unwrap())?;ordinary(&p,false)?;fs::canonicalize(p).map_err(|e|e.to_string())
}
fn space(root:&Path,bytes:u64)->Result<(),String>{
 use std::os::windows::ffi::OsStrExt;
 #[link(name="kernel32")]extern "system"{fn GetDiskFreeSpaceExW(path:*const u16,available:*mut u64,total:*mut u64,free:*mut u64)->i32;}
 let required=bytes.checked_add(256*1024*1024).ok_or("Download space budget overflow")?;let mut available=0u64;let path:Vec<u16>=root.as_os_str().encode_wide().chain(Some(0)).collect();
 if unsafe{GetDiskFreeSpaceExW(path.as_ptr(),&mut available,std::ptr::null_mut(),std::ptr::null_mut())}==0{return Err("Cannot query available download space".into());}
 if available<required{return Err("Insufficient download space; not reserved".into());}Ok(())
}
struct Work{path:PathBuf,_lease:File}
impl Work{fn create(root:&Path,bytes:u64)->Result<Arc<Self>,String>{
 use std::os::windows::fs::OpenOptionsExt;
 directory(root)?;space(root,bytes)?;
 let path=root.join(format!("component-cache-{}",uuid::Uuid::new_v4().simple()));fs::create_dir(&path).map_err(|e|e.to_string())?;
 let lease=OpenOptions::new().read(true).write(true).create_new(true).share_mode(0).open(path.join("download.lease")).map_err(|e|e.to_string())?;
 Ok(Arc::new(Self{path:fs::canonicalize(path).map_err(|e|e.to_string())?,_lease:lease}))
}}
fn verify(file:&File,bytes:u64,sha:&str,cancel:&AtomicBool)->Result<(),String>{
 if file.metadata().map_err(|e|e.to_string())?.len()!=bytes{return Err("Downloaded size mismatch".into());}
 let mut borrowed=file;borrowed.seek(SeekFrom::Start(0)).map_err(|e|e.to_string())?;let mut digest=Sha256::new();let mut block=[0u8;65536];let mut count=0u64;
 loop{cancelled(cancel)?;let n=borrowed.read(&mut block).map_err(|e|e.to_string())?;if n==0{break;}count+=n as u64;if count>bytes{return Err("Download read budget exceeded".into());}digest.update(&block[..n]);}
 if count!=bytes||format!("{:x}",digest.finalize())!=sha{return Err("Downloaded SHA-256 mismatch".into());}Ok(())
}
// Outer error means whole-Job exit unconfirmed: stop, never try another source.
fn attempt(work:&Arc<Work>,url:&str,bytes:u64,sha:&str,protocol:Protocol,name:&str,cancel:&AtomicBool)->Result<Result<PathBuf,String>,String>{
 use std::os::windows::fs::OpenOptionsExt;
 let tool=curl()?;let path=work.path.join(format!("{name}.part"));
 let body=Arc::new(OpenOptions::new().read(true).write(true).create_new(true).share_mode(1).open(&path).map_err(|e|e.to_string())?);
 let errors=Arc::new(OpenOptions::new().read(true).write(true).create_new(true).share_mode(1).open(work.path.join(format!("{name}.stderr"))).map_err(|e|e.to_string())?);
 let mut args:Vec<String>=["--disable","--fail","--silent","--show-error","--ssl-no-revoke","--connect-timeout","15","--max-time","300","--max-filesize",&bytes.to_string(),"--proxy","","--output","-"].into_iter().map(str::to_owned).collect();
 match protocol{Protocol::Https=>args.extend(["--location","--max-redirs","3","--proto","=https","--proto-redir","=https","--tlsv1.2"].into_iter().map(str::to_owned)),#[cfg(test)]Protocol::Loopback=>args.extend(["--proto","=http","--proto-redir","=http"].into_iter().map(str::to_owned))};
 args.extend(["--url".into(),url.into()]);
 let mut env:Vec<(std::ffi::OsString,Option<std::ffi::OsString>)>=["CURL_CA_BUNDLE","SSL_CERT_FILE","SSL_CERT_DIR","CURL_SSL_BACKEND"].into_iter().map(|s|(s.into(),None)).collect();env.push(("PATH".into(),Some(tool.parent().unwrap().as_os_str().to_owned())));
 let input=File::open("NUL").map_err(|e|e.to_string())?;
 let job=Custody::new(OwnedProcess::spawn_with_files(&tool,&args,&work.path,&env,&input,&body,&errors)?,(work.clone(),body.clone(),errors.clone()));
 let start=Instant::now();let outcome=loop{
  if let Err(e)=cancelled(cancel){break Err(e);}
  if start.elapsed()>Duration::from_secs(310){break Err("Download timed out".into());}
  match (body.metadata(),errors.metadata()){(Ok(b),Ok(e))if b.len()<=bytes&&e.len()<=65536=>{},_=>break Err("Download/output budget exceeded".into())}
  match job.try_exit(){Ok(Some(0))=>break Ok(()),Ok(Some(code))=>break Err(format!("Component source failed ({code}); partial retained")),Ok(None)=>{},Err(e)=>break Err(e)}
  std::thread::sleep(Duration::from_millis(20));
 };
 let result=job.after_exit(outcome)?;drop(job);
 Ok(result.and_then(|_|{verify(&body,bytes,sha,cancel)?;body.sync_all().map_err(|e|e.to_string())?;Ok(path)}))
}
fn fetch(work:&Arc<Work>,urls:&[String],bytes:u64,sha:&str,protocol:Protocol,label:&str,cancel:&AtomicBool)->Result<PathBuf,String>{
 if urls.is_empty()||urls.len()>3||bytes==0||bytes>600_000_000||sha.len()!=64||!sha.bytes().all(|c|c.is_ascii_digit()||(b'a'..=b'f').contains(&c)){return Err("Invalid pinned transfer policy".into());}
 for url in urls{validate_url(url,protocol)?;}
 let mut errors=Vec::new();for(index,url)in urls.iter().enumerate(){cancelled(cancel)?;match attempt(work,url,bytes,sha,protocol,&format!("{label}-{index}"),cancel)?{Ok(path)=>return Ok(path),Err(e)=>errors.push(e)}}
 Err(format!("No component source succeeded: {}",errors.join("; ")))
}
/// Internal trusted release metadata only. Not an IPC URL/hash parameter surface.
/// There is deliberately no configured public source or app-update publication here.
pub(crate) fn install_from_https(components:&Path,manifest_urls:&[String],archive_urls:&[String],cancel:&AtomicBool)->Result<PathBuf,String>{install(components,manifest_urls,archive_urls,Protocol::Https,cancel)}
pub(crate) fn install_from_https_progress(components:&Path,manifest_urls:&[String],archive_urls:&[String],cancel:&AtomicBool,progress:&dyn Fn(&str))->Result<PathBuf,String>{install_progress(components,manifest_urls,archive_urls,Protocol::Https,cancel,progress)}
#[cfg(test)]pub(crate) fn test_install_loopback_progress(components:&Path,origin:&str,cancel:&AtomicBool,progress:&dyn Fn(&str))->Result<PathBuf,String>{install_progress(components,&[format!("{origin}/manifest")],&[format!("{origin}/missing"),format!("{origin}/archive")],Protocol::Loopback,cancel,progress)}
fn install(components:&Path,manifest_urls:&[String],archive_urls:&[String],protocol:Protocol,cancel:&AtomicBool)->Result<PathBuf,String>{install_progress(components,manifest_urls,archive_urls,protocol,cancel,&|_|{})}
fn install_progress(components:&Path,manifest_urls:&[String],archive_urls:&[String],protocol:Protocol,cancel:&AtomicBool,progress:&dyn Fn(&str))->Result<PathBuf,String>{
 cancelled(cancel)?;for urls in [manifest_urls,archive_urls]{if urls.is_empty()||urls.len()>3{return Err("Approved component sources not configured".into());}for url in urls{validate_url(url,protocol)?;}}
 let work=Work::create(components,ARCHIVE_BYTES+MANIFEST_BYTES)?;
 progress("manifest");
 let manifest=fetch(&work,manifest_urls,MANIFEST_BYTES,MANIFEST_SHA,protocol,"manifest",cancel)?;
 progress("archive");
 let archive=fetch(&work,archive_urls,ARCHIVE_BYTES,ARCHIVE_SHA,protocol,"archive",cancel)?;
 cancelled(cancel)?;let mut bytes=Vec::new();File::open(manifest).map_err(|e|e.to_string())?.take(MANIFEST_BYTES+1).read_to_end(&mut bytes).map_err(|e|e.to_string())?;
 if bytes.len()as u64!=MANIFEST_BYTES||format!("{:x}",Sha256::digest(&bytes))!=MANIFEST_SHA{return Err("Manifest changed before import".into());}
 cancelled(cancel)?;progress("install");
 let target=components.join("python-tools-v2");let store=match fs::symlink_metadata(&target){Ok(_)=>Store::open(&target)?,Err(e)if e.kind()==std::io::ErrorKind::NotFound=>Store::create(&target)?,Err(e)=>return Err(e.to_string())};
 // Native importer independently rechecks the archive pin and exact tree before commit.
 crate::worker_import::install_experimental(&store,&archive,&bytes,cancel)
}
#[cfg(test)]#[path="worker_download_tests.rs"]mod tests;
