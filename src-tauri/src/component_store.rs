//! Experimental immutable worker generations and atomic selection. Opt-in app callers only.
//! Integrity pins MUST come from a separately authenticated release policy; this module
//! does not authenticate downloads. Callers must retain Active until every descendant exits.
//! Cooperative Windows locks are not a crash/descendant recovery proof or power-loss guarantee.
use std::{collections::{BTreeMap,BTreeSet},fs::{self,File,OpenOptions},io::{Read,Write},path::{Path,PathBuf}};
use serde::{Serialize,Deserialize};
use sha2::{Sha256,Digest};
const LIMIT:u64=1_500_000_000;
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Entry{pub path:String,pub bytes:u64,pub sha256:String}
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest{pub schema:u32,pub component:String,pub files:Vec<Entry>}
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
#[serde(deny_unknown_fields)]
pub struct Selection{pub schema:u32,pub active:Option<String>,pub previous:Option<String>}
#[derive(Clone,Copy,Debug,PartialEq,Eq)]
pub enum Kind { Worker, Upscale }
impl Kind {
 fn name(self)->&'static str {match self{Self::Worker=>"python-tools",Self::Upscale=>"upscale-ncnn"}}
 fn owner(self)->Vec<u8>{format!("{{\"schema\":1,\"component\":\"{}\"}}",self.name()).into_bytes()}
}
pub struct Store{root:PathBuf,kind:Kind}
pub struct Active{_lease:File,pub path:PathBuf,pub generation:String}
fn hash(data:&[u8])->String{format!("{:x}",Sha256::digest(data))}
fn hex(s:&str)->bool{s.len()==64&&s.bytes().all(|c|c.is_ascii_digit()||(b'a'..=b'f').contains(&c))}
fn ordinary(p:&Path,dir:bool)->Result<(),String>{
 let m=fs::symlink_metadata(p).map_err(|e|e.to_string())?;
 #[cfg(windows)]{use std::os::windows::fs::MetadataExt;if m.file_attributes()&0x400!=0{return Err("Reparse path rejected".into());}}
 if m.file_type().is_symlink()||if dir{!m.is_dir()}else{!m.is_file()}{return Err("Nonordinary path rejected".into());}Ok(())
}
fn ancestors(p:&Path)->Result<(),String>{for p in p.ancestors(){ordinary(p,true)?;}Ok(())}
fn safe_name(s:&str)->bool{
 !s.is_empty()&&s.len()<=1000&&!s.contains('\\')&&s.split('/').all(|p|{
 let stem=p.split('.').next().unwrap_or("").to_ascii_lowercase();
 !p.is_empty()&&p!="."&&p!=".."&&!p.ends_with(['.',' '])&&!p.chars().any(|c|c.is_control()||":<>\"|?*".contains(c))&&
 !matches!(stem.as_str(),"con"|"prn"|"aux"|"nul")&&!(stem.len()==4&&(stem.starts_with("com")||stem.starts_with("lpt"))&&matches!(stem.as_bytes()[3],b'1'..=b'9'))
 })
}
fn approved(bytes:&[u8],pin:&str)->Result<Manifest,String>{approved_kind(bytes,pin,Kind::Worker)}
fn approved_kind(bytes:&[u8],pin:&str,kind:Kind)->Result<Manifest,String>{
 if bytes.len()>12_000_000||!hex(pin)||hash(bytes)!=pin{return Err("Unapproved manifest digest".into());}
 let m:Manifest=serde_json::from_slice(bytes).map_err(|e|e.to_string())?;
 if m.schema!=1||m.component!=kind.name()||m.files.is_empty()||m.files.len()>30000{return Err("Invalid worker manifest".into());}
 let mut names=BTreeSet::new();let mut total=0u64;
 for e in &m.files{
  if !safe_name(&e.path)||!hex(&e.sha256)||!names.insert(e.path.to_lowercase()){return Err("Unsafe/duplicate manifest entry".into());}
  total=total.checked_add(e.bytes).ok_or("Size overflow")?;if total>LIMIT{return Err("Component size budget".into());}
 }
 for name in &names{let mut p=name.as_str();while let Some((parent,_))=p.rsplit_once('/') {if names.contains(parent){return Err("File/directory collision".into());}p=parent;}}
 Ok(m)
}
fn tree(root:&Path,m:&Manifest)->Result<(),String>{
 ancestors(root)?;let expected:BTreeMap<_,_>=m.files.iter().map(|e|(e.path.as_str(),e)).collect();let mut seen=BTreeSet::new();let mut dirs=vec![root.to_owned()];let mut visited=0;
 while let Some(dir)=dirs.pop(){for item in fs::read_dir(&dir).map_err(|e|e.to_string())?{
  let path=item.map_err(|e|e.to_string())?.path();visited+=1;if visited>60000{return Err("Tree entry budget".into());}
  let meta=fs::symlink_metadata(&path).map_err(|e|e.to_string())?;ordinary(&path,meta.is_dir())?;
  if meta.is_dir(){dirs.push(path);continue;}
  let rel=path.strip_prefix(root).map_err(|e|e.to_string())?.to_str().ok_or("Non-Unicode component path")?.replace('\\',"/");
  let e=expected.get(rel.as_str()).ok_or_else(||format!("Unexpected component file: {rel}"))?;
  if meta.len()!=e.bytes{return Err(format!("Component size mismatch: {rel}"));}
  let mut f=File::open(&path).map_err(|e|e.to_string())?;let mut digest=Sha256::new();let mut block=[0u8;65536];
  loop{let n=f.read(&mut block).map_err(|e|e.to_string())?;if n==0{break;}digest.update(&block[..n]);}
  if format!("{:x}",digest.finalize())!=e.sha256{return Err(format!("Component checksum mismatch: {rel}"));}seen.insert(rel);
 }}
 if seen.len()!=expected.len(){return Err("Component file missing".into());}Ok(())
}
impl Store{
 pub fn create(path:&Path)->Result<Self,String>{Self::create_kind(path,Kind::Worker)}
 pub fn create_kind(path:&Path,kind:Kind)->Result<Self,String>{
  if !path.is_absolute(){return Err("Absolute store path required".into());}ancestors(path.parent().ok_or("Store parent required")?)?;
  fs::create_dir(path).map_err(|e|e.to_string())?;
  let root=fs::canonicalize(path).map_err(|e|e.to_string())?;
  for n in ["staging","generations"]{fs::create_dir(root.join(n)).map_err(|e|e.to_string())?;}
  fs::write(root.join("store-owner.json"),kind.owner()).map_err(|e|e.to_string())?;
  OpenOptions::new().write(true).create_new(true).open(root.join("store.lease")).map_err(|e|e.to_string())?;
  let s=Self{root,kind};s.publish(&Selection{schema:1,active:None,previous:None})?;Ok(s)
 }
 pub fn open(path:&Path)->Result<Self,String>{Self::open_kind(path,Kind::Worker)}
 pub fn open_kind(path:&Path,kind:Kind)->Result<Self,String>{
  ancestors(path)?;ordinary(&path.join("store-owner.json"),false)?;
  if fs::metadata(path.join("store-owner.json")).map_err(|e|e.to_string())?.len()>128||fs::read(path.join("store-owner.json")).map_err(|e|e.to_string())?!=kind.owner(){return Err("Unknown component store".into());}
  for n in ["staging","generations"]{ordinary(&path.join(n),true)?;}
  Ok(Self{root:fs::canonicalize(path).map_err(|e|e.to_string())?,kind})
 }
 fn lock(&self,write:bool)->Result<File,String>{
  ancestors(&self.root)?;let p=self.root.join("store.lease");ordinary(&p,false)?;
  if fs::metadata(&p).map_err(|e|e.to_string())?.len()!=0{return Err("Invalid store lease".into());}
  #[cfg(not(windows))]{let _=write;return Err("Store leases require Windows".into());}
  #[cfg(windows)]{use std::os::windows::fs::OpenOptionsExt;
   let f=OpenOptions::new().read(true).write(write).share_mode(if write{0}else{1}).custom_flags(0x00200000).open(p).map_err(|e|format!("Component busy or inaccessible: {e}"))?;Ok(f)
  }
 }
 fn read(&self)->Result<Selection,String>{
  let p=self.root.join("selection.json");ordinary(&p,false)?;if fs::metadata(&p).map_err(|e|e.to_string())?.len()>16384{return Err("Oversized selection".into());}
  let s:Selection=serde_json::from_slice(&fs::read(p).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
  if s.schema!=1||[&s.active,&s.previous].iter().any(|x|x.as_ref().is_some_and(|v|!hex(v))){return Err("Invalid selection".into());}Ok(s)
 }
 fn publish(&self,s:&Selection)->Result<(),String>{
  let target=self.root.join("selection.json");if target.exists(){ordinary(&target,false)?;}
  let temp=self.root.join(format!("selection-{}.pending",uuid::Uuid::new_v4()));
  let mut f=OpenOptions::new().write(true).create_new(true).open(&temp).map_err(|e|e.to_string())?;
  f.write_all(&serde_json::to_vec(s).map_err(|e|e.to_string())?).and_then(|_|f.sync_all()).map_err(|e|e.to_string())?;drop(f);
  // Same-volume atomic rename. Failed/unpublished temporary files are retained, not treated as active.
  fs::rename(temp,target).map_err(|e|e.to_string())
 }
 pub fn selection(&self)->Result<Selection,String>{let _g=self.lock(false)?;self.read()}
 pub fn staging_directory(&self)->Result<PathBuf,String>{let _g=self.lock(true)?;ordinary(&self.root.join("staging"),true)?;let p=self.root.join("staging").join(uuid::Uuid::new_v4().simple().to_string());fs::create_dir(&p).map_err(|e|e.to_string())?;Ok(p)}
 pub fn install(&self,stage:&Path,manifest:&[u8],pin:&str)->Result<(),String>{self.install_inner(stage,manifest,pin,||{})}
 fn install_inner(&self,stage:&Path,manifest:&[u8],pin:&str,after_move:impl FnOnce())->Result<(),String>{
  let _g=self.lock(true)?;let m=approved_kind(manifest,pin,self.kind)?;let old=self.read()?;
  if stage.parent()!=Some(self.root.join("staging").as_path()){return Err("Not an owned staging directory".into());}
  tree(stage,&m)?;ordinary(&self.root.join("generations"),true)?;let dest=self.root.join("generations").join(pin);
  if dest.exists(){return Err("Generation exists; never overwrite".into());}
  fs::rename(stage,&dest).map_err(|e|e.to_string())?;after_move();
  self.publish(&Selection{schema:1,active:Some(pin.into()),previous:old.active})
 }
 pub fn acquire(&self,manifest:&[u8],pin:&str)->Result<Active,String>{
  let guard=self.lock(false)?;let m=approved_kind(manifest,pin,self.kind)?;let s=self.read()?;
  if s.active.as_deref()!=Some(pin){return Err("No active approved generation".into());}
  let path=self.root.join("generations").join(pin);tree(&path,&m)?;Ok(Active{_lease:guard,path,generation:pin.into()})
 }
 pub fn rollback(&self,manifest:&[u8],pin:&str)->Result<(),String>{
  let _g=self.lock(true)?;let m=approved_kind(manifest,pin,self.kind)?;let old=self.read()?;
  if old.previous.as_deref()!=Some(pin){return Err("Not the approved previous generation".into());}
  tree(&self.root.join("generations").join(pin),&m)?;self.publish(&Selection{schema:1,active:old.previous,previous:old.active})
 }
 /// Logical removal only. No recursive deletion; old bytes remain available for rollback.
 pub fn deactivate(&self)->Result<(),String>{let _g=self.lock(true)?;let old=self.read()?;if old.active.is_none(){return Ok(());}self.publish(&Selection{schema:1,active:None,previous:old.active})}
}
#[cfg(all(test,windows))]
#[path="component_store_tests.rs"]mod tests;
/// Exclusive, unpublished import workspace. Drop retains incomplete bytes for diagnosis.
/// Holding this object never authorizes execution; only successful commit publishes selection.
#[cfg(windows)]
pub(crate) struct Import {
 store:Store, _guard:File, stage:PathBuf, manifest:Manifest, bytes:Vec<u8>, pin:String, old:Selection,
}
#[cfg(windows)]
impl Store {
 pub(crate) fn begin_import(&self,bytes:&[u8],pin:&str)->Result<Import,String>{
  let manifest=approved_kind(bytes,pin,self.kind)?;if manifest.files.iter().any(|e|e.bytes>600_000_000){return Err("Archive entry budget exceeded".into());}let guard=self.lock(true)?;let old=self.read()?;
  ordinary(&self.root.join("generations"),true)?;ordinary(&self.root.join("staging"),true)?;
  if self.root.join("generations").join(pin).try_exists().map_err(|e|e.to_string())?{return Err("Generation exists; never overwrite or re-extract".into());}
  let stage=self.root.join("staging").join(uuid::Uuid::new_v4().simple().to_string());fs::create_dir(&stage).map_err(|e|e.to_string())?;
  Ok(Import{store:Store{root:self.root.clone(),kind:self.kind},_guard:guard,stage,manifest,bytes:bytes.to_vec(),pin:pin.into(),old})
 }
}
#[cfg(windows)]
impl Import {
 pub(crate) fn stage(&self)->&Path{&self.stage}
 pub(crate) fn manifest(&self)->&Manifest{&self.manifest}
 fn publish_manifest(&self)->Result<(),String>{
  let target=self.store.root.join("approved-tree.json");
  match fs::symlink_metadata(&target){
   Ok(meta)=>{ordinary(&target,false)?;if meta.len()!=self.bytes.len()as u64||fs::read(&target).map_err(|e|e.to_string())?!=self.bytes{return Err("Existing approval differs; never replace it implicitly".into());}return Ok(());},
   Err(e)if e.kind()==std::io::ErrorKind::NotFound=>{},Err(e)=>return Err(e.to_string()),
  }
  let pending=self.store.root.join(format!("approval-{}.pending",uuid::Uuid::new_v4()));
  let mut f=OpenOptions::new().write(true).create_new(true).open(&pending).map_err(|e|e.to_string())?;
  f.write_all(&self.bytes).and_then(|_|f.sync_all()).map_err(|e|e.to_string())?;drop(f);
  use std::os::windows::ffi::OsStrExt;
  #[link(name="kernel32")]extern "system"{fn MoveFileExW(from:*const u16,to:*const u16,flags:u32)->i32;}
  let from:Vec<u16>=pending.as_os_str().encode_wide().chain(Some(0)).collect();let to:Vec<u16>=target.as_os_str().encode_wide().chain(Some(0)).collect();
  // NO REPLACE_EXISTING or cross-volume copy. Failed pending files remain evidence.
  if unsafe{MoveFileExW(from.as_ptr(),to.as_ptr(),8)}==0{return Err(format!("Publish approval without overwrite: {}",std::io::Error::last_os_error()));}Ok(())
 }
 pub(crate) fn commit(self,cancel:&std::sync::atomic::AtomicBool)->Result<PathBuf,String>{
  let check=||if cancel.load(std::sync::atomic::Ordering::Acquire){Err("Import cancelled; unpublished staging retained".to_owned())}else{Ok(())};
  check()?;tree(&self.stage,&self.manifest)?;check()?;
  self.publish_manifest()?;check()?;
  let destination=self.store.root.join("generations").join(&self.pin);
  if destination.try_exists().map_err(|e|e.to_string())?{return Err("Generation appeared; never overwrite".into());}
  // Cancellation linearizes at this commit boundary. Once rename begins, finish or
  // report a publication error; never claim a committed generation was cancelled.
  fs::rename(&self.stage,&destination).map_err(|e|e.to_string())?;
  self.store.publish(&Selection{schema:1,active:Some(self.pin.clone()),previous:self.old.active.clone()})?;
  Ok(destination)
 }
}
