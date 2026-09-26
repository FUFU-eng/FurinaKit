//! Experimental offline importer: Rust + Windows inbox tar; NEVER system Python.
//! Only the compiled, previously audited archive/tree pair is admitted. This is NOT
//! publisher authentication, a general ZIP extractor, production delivery or cleanup.
use std::{collections::BTreeSet,fs::{self,File,OpenOptions},io::{Read,Seek,SeekFrom},path::{Path,PathBuf},sync::{Arc,atomic::{AtomicBool,Ordering}},time::{Duration,Instant}};
use sha2::{Sha256,Digest};
use crate::{component_store::{Store,Import},download_process::OwnedProcess,resource_custody::Custody};
const ARCHIVE_PIN:&str="377bc1a1186559b19feadeeb3d66ca395d0d508b5426c639c827b6ce01b80bb4";
const TREE_PIN:&str="50ca47cabddf65f24f77475343a87dc8c7a181d877d7b0d378de7a4e95f5e156";
const ARCHIVE_LIMIT:u64=600_000_000;
fn cancelled(cancel:&AtomicBool)->Result<(),String>{if cancel.load(Ordering::Acquire){Err("Import cancelled; no new generation selected".into())}else{Ok(())}}
fn ordinary(path:&Path,directory:bool)->Result<(),String>{use std::os::windows::fs::MetadataExt;let m=fs::symlink_metadata(path).map_err(|e|e.to_string())?;if m.file_attributes()&0x400!=0||m.file_type().is_symlink()||if directory{!m.is_dir()}else{!m.is_file()}{return Err("Importer rejects linked or nonordinary paths".into());}Ok(())}
fn inbox_tar()->Result<PathBuf,String>{
 #[link(name="kernel32")]extern "system"{fn GetSystemDirectoryW(buffer:*mut u16,size:u32)->u32;}
 let mut b=[0u16;32768];let n=unsafe{GetSystemDirectoryW(b.as_mut_ptr(),b.len()as u32)}as usize;
 if n==0||n>=b.len(){return Err("Cannot resolve Windows inbox tools".into());}
 let p=PathBuf::from(String::from_utf16(&b[..n]).map_err(|e|e.to_string())?).join("tar.exe");ordinary(&p,false)?;
 for dir in p.parent().ok_or("Missing system tool directory")?.ancestors(){ordinary(dir,true)?;}
 fs::canonicalize(p).map_err(|e|format!("Windows inbox tar unavailable; no PATH fallback: {e}"))
}
fn archive(path:&Path,pin:&str,cancel:&AtomicBool)->Result<Arc<File>,String>{
 use std::os::windows::fs::{OpenOptionsExt,MetadataExt};
 if !path.is_absolute(){return Err("Absolute archive path required".into());}ordinary(path,false)?;
 for p in path.parent().ok_or("Missing archive parent")?.ancestors(){ordinary(p,true)?;}
 let path=fs::canonicalize(path).map_err(|e|e.to_string())?;
 let mut f=OpenOptions::new().read(true).share_mode(1).custom_flags(0x00200000).open(&path).map_err(|e|e.to_string())?;
 let meta=f.metadata().map_err(|e|e.to_string())?;
 if !meta.is_file()||meta.file_attributes()&0x400!=0||meta.len()==0||meta.len()>ARCHIVE_LIMIT{return Err("Invalid/oversized archive".into());}
 let mut hash=Sha256::new();let mut block=[0u8;65536];let mut bytes=0u64;
 loop{cancelled(cancel)?;let n=f.read(&mut block).map_err(|e|e.to_string())?;if n==0{break;}bytes+=n as u64;if bytes>ARCHIVE_LIMIT{return Err("Archive read budget exceeded".into());}hash.update(&block[..n]);}
 if format!("{:x}",hash.finalize())!=pin{return Err("Archive not approved; no extraction performed".into());}
 f.seek(SeekFrom::Start(0)).map_err(|e|e.to_string())?;Ok(Arc::new(f))
}
fn output(path:&Path)->Result<String,String>{let f=File::open(path).map_err(|e|e.to_string())?;let mut bytes=Vec::new();f.take(16_000_001).read_to_end(&mut bytes).map_err(|e|e.to_string())?;if bytes.len()>16_000_000{return Err("Archive listing budget exceeded".into());}// Inbox bsdtar writes the Windows ANSI code page, including localized dates.
 // Decode strictly, never with replacement. Unrepresentable/escaped entry names
 // still fail exact comparison with the approved Unicode manifest before extraction.
 #[link(name="kernel32")]extern "system"{fn MultiByteToWideChar(cp:u32,flags:u32,input:*const u8,len:i32,output:*mut u16,capacity:i32)->i32;}
 if bytes.is_empty(){return Ok(String::new());}
 let count=unsafe{MultiByteToWideChar(0,8,bytes.as_ptr(),bytes.len()as i32,std::ptr::null_mut(),0)};
 if count<=0{return Err("Undecodable Windows archive listing".into());}
 let mut wide=vec![0u16;count as usize];
 if unsafe{MultiByteToWideChar(0,8,bytes.as_ptr(),bytes.len()as i32,wide.as_mut_ptr(),count)}!=count{return Err("Invalid archive listing encoding".into());}
 String::from_utf16(&wide).map_err(|_|"Invalid archive listing text".into())}
fn run_tar(tool:&Path,transaction:&Arc<Import>,source:&Arc<File>,mode:&str,cancel:&AtomicBool)->Result<String,String>{
 cancelled(cancel)?;
 let out=transaction.stage().with_extension(format!("{mode}.stdout"));let err=transaction.stage().with_extension(format!("{mode}.stderr"));
 let stdout=OpenOptions::new().write(true).create_new(true).open(&out).map_err(|e|e.to_string())?;
 let stderr=OpenOptions::new().write(true).create_new(true).open(&err).map_err(|e|e.to_string())?;
 let option=match mode{"names"=>"-tf","types"=>"-tvf","extract"=>"-xf",_=>return Err("Unknown import step".into())};
 // Every invocation receives the already-verified disk handle, not a pathname.
 // Calls are sequential and the preceding whole Job must exit before rewinding.
 let mut input=source.as_ref();input.seek(SeekFrom::Start(0)).map_err(|e|e.to_string())?;
 let args=vec![option.into(),"-".into(),"-C".into(),".".into()];
 let mut environment:Vec<(std::ffi::OsString,Option<std::ffi::OsString>)>=["TAR_OPTIONS","BSDTAR_OPTIONS","TAR_READER_OPTIONS","TAR_WRITER_OPTIONS","LC_ALL","LC_CTYPE","LANG","LANGUAGE"].into_iter().map(|key|(key.into(),None)).collect();
 environment.push(("PATH".into(),Some(tool.parent().ok_or("Missing inbox tool directory")?.as_os_str().to_owned())));
 let process=Custody::new(OwnedProcess::spawn_with_files(tool,&args,transaction.stage(),&environment,source.as_ref(),&stdout,&stderr)?,(transaction.clone(),source.clone()));
 let start=Instant::now();
 let outcome=loop{
  if let Err(e)=cancelled(cancel){break Err(e);}
  if start.elapsed()>Duration::from_secs(180){break Err("Windows archive operation timed out".into());}
  if stdout.metadata().map_err(|e|e.to_string())?.len()>16_000_000||stderr.metadata().map_err(|e|e.to_string())?.len()>16_000_000{break Err("Archive output budget exceeded".into());}
  match process.try_exit(){Ok(Some(0))=>break Ok(()),Ok(Some(code))=>break Err(format!("Windows tar failed ({code}); see retained {mode}.stderr")),Ok(None)=>{},Err(e)=>break Err(e)}
  std::thread::sleep(Duration::from_millis(25));
 };
 process.after_exit(outcome)??;drop(process);output(&out)
}
fn listing(names:&str,types:&str,transaction:&Import)->Result<(),String>{
 let expected:BTreeSet<_>=transaction.manifest().files.iter().map(|e|e.path.as_str()).collect();
 let mut actual=BTreeSet::new();
 for name in names.lines(){if !expected.contains(name)||!actual.insert(name){return Err("Unexpected or duplicate archive entry; extraction refused".into());}}
 if actual!=expected{return Err("Archive entry set differs from approved tree".into());}
 let lines:Vec<_>=types.lines().collect();if lines.len()!=expected.len()||lines.iter().any(|s|!s.starts_with('-')){return Err("Linked, directory or unsupported archive entries rejected".into());}
 let sizes:std::collections::BTreeMap<_,_>=transaction.manifest().files.iter().map(|e|(e.path.as_str(),e.bytes)).collect();
 for (name,line) in names.lines().zip(lines){
  let size=line.split_whitespace().nth(4).and_then(|s|s.parse::<u64>().ok()).ok_or("Unsupported inbox tar metadata format")?;
  if sizes.get(name)!=Some(&size){return Err("Archive entry size differs from approved manifest; no extraction".into());}
 }Ok(())
}
/// Explicit local import only. No environment toggle bypasses the compiled pins.
/// Caller owns/creates the Store; this function does not discover or overwrite installs.
pub(crate) fn install_experimental(store:&Store,path:&Path,manifest:&[u8],cancel:&AtomicBool)->Result<PathBuf,String>{
 install_policy(store,path,manifest,ARCHIVE_PIN,TREE_PIN,cancel,||{})
}
pub(crate) fn install_policy(store:&Store,path:&Path,manifest:&[u8],archive_pin:&str,tree_pin:&str,cancel:&AtomicBool,after_extract:impl FnOnce())->Result<PathBuf,String>{
 cancelled(cancel)?;
 if manifest.len()>12_000_000||format!("{:x}",Sha256::digest(manifest))!=tree_pin{return Err("Tree manifest not approved".into());}
 let tool=inbox_tar()?;let file=archive(path,archive_pin,cancel)?;cancelled(cancel)?;
 let transaction=Arc::new(store.begin_import(manifest,tree_pin)?);
 ensure_space(transaction.stage(),payload_bytes(&transaction)?)?;
 let names=run_tar(&tool,&transaction,&file,"names",cancel)?;
 let types=run_tar(&tool,&transaction,&file,"types",cancel)?;
 listing(&names,&types,&transaction)?;cancelled(cancel)?;
 ensure_space(transaction.stage(),payload_bytes(&transaction)?)?;
 run_tar(&tool,&transaction,&file,"extract",cancel)?;after_extract();cancelled(cancel)?;
 // No helper can still be holding resources: otherwise do not publish anything.
 let transaction=Arc::try_unwrap(transaction).map_err(|_|"Archive helper custody still active; not committing")?;
 transaction.commit(cancel)
}

// Conservative headroom, not disk-space reservation or a concurrent-write guarantee.
const DISK_HEADROOM:u64=256*1024*1024;
fn required_space(payload:u64)->Result<u64,String>{payload.checked_add(DISK_HEADROOM).ok_or("Import disk-space budget overflow".into())}
fn check_space(payload:u64,available:u64)->Result<(),String>{let need=required_space(payload)?;if available<need{return Err(format!("可用空间不足；不会开始解压 / Insufficient free space; extraction not started (need {need}, available {available} bytes)"));}Ok(())}
fn payload_bytes(transaction:&Import)->Result<u64,String>{transaction.manifest().files.iter().try_fold(0u64,|sum,e|sum.checked_add(e.bytes).ok_or("Import byte count overflow".into()))}
fn available_space(directory:&Path)->Result<u64,String>{
 use std::os::windows::ffi::OsStrExt;
 #[link(name="kernel32")]extern "system"{fn GetDiskFreeSpaceExW(directory:*const u16,available:*mut u64,total:*mut u64,free:*mut u64)->i32;}
 ordinary(directory,true)?;
 let mut wide:Vec<u16>=directory.as_os_str().encode_wide().collect();if wide.contains(&0){return Err("NUL in import directory".into());}wide.push(0);
 let mut available=0u64;
 if unsafe{GetDiskFreeSpaceExW(wide.as_ptr(),&mut available,std::ptr::null_mut(),std::ptr::null_mut())}==0{return Err(format!("Cannot verify available import space: {}",std::io::Error::last_os_error()));}
 Ok(available)
}
fn ensure_space(directory:&Path,payload:u64)->Result<(),String>{check_space(payload,available_space(directory)?)}

#[cfg(test)]#[path="worker_import_tests.rs"]mod tests;
