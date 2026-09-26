//! Explicit, previewed in-place rename. No content filtering and no overwrite semantics.
use std::{collections::{HashMap, HashSet}, fs, path::{Path, PathBuf}, sync::{Mutex, OnceLock}, time::{Instant, SystemTime}};
use serde::{Serialize, Deserialize};
use tauri::Manager;
#[derive(Clone)]
struct Source { path: PathBuf, parent: PathBuf, name: String, relative: String, size: u64, modified: Option<SystemTime>, created: Option<SystemTime> }
#[derive(Clone)]
struct Session { root: PathBuf, files: Vec<Source>, time: Instant }
struct Plan { session: Session, names: Vec<String>, time: Instant }
#[derive(Default)]
struct Store { sessions: HashMap<String,Session>, plans: HashMap<String,Plan> }
static STORE: OnceLock<Mutex<Store>> = OnceLock::new();
fn store() -> &'static Mutex<Store> { STORE.get_or_init(||Mutex::new(Store::default())) }
fn id() -> String { uuid::Uuid::new_v4().to_string() }
fn reparse(m: &fs::Metadata)->bool {
 #[cfg(windows)] { use std::os::windows::fs::MetadataExt; m.file_attributes() & 0x400 != 0 }
 #[cfg(not(windows))] { m.file_type().is_symlink() }
}
fn walk(root:&Path, dir:&Path, recursive:bool, files:&mut Vec<Source>, skipped:&mut usize)->Result<(),String> {
 if dir.strip_prefix(root).map_err(|e|e.to_string())?.components().count()>128 {return Err("子文件夹层级超过128层，请缩小范围".into());}
 for item in fs::read_dir(dir).map_err(|e|e.to_string())? {
  let p=item.map_err(|e|e.to_string())?.path(); let m=fs::symlink_metadata(&p).map_err(|e|e.to_string())?;
  if reparse(&m) { *skipped+=1; continue; }
  if m.is_dir() && recursive { walk(root,&p,true,files,skipped)?; }
  else if m.is_file() {
   if files.len()>=5000 { return Err("一次最多处理5000个文件，请缩小目录范围".into()); }
   let name=p.file_name().and_then(|s|s.to_str()).ok_or("文件名编码无法显示")?.to_owned();
   files.push(Source{parent:fs::canonicalize(p.parent().ok_or("目录无效")?).map_err(|e|e.to_string())?,relative:p.strip_prefix(root).map_err(|e|e.to_string())?.to_string_lossy().into_owned(),path:p,name,size:m.len(),modified:m.modified().ok(),created:m.created().ok()});
  }
 } Ok(())
}
#[derive(Serialize)]
pub struct Row { id:usize, name:String, relative:String, size:u64 }
#[derive(Serialize)]
pub struct Scan { session:String, rows:Vec<Row>, skipped:usize }
#[tauri::command]
pub async fn rename_scan(folder:String, recursive:bool)->Result<Scan,String> {
 tauri::async_runtime::spawn_blocking(move|| {
  let root=fs::canonicalize(folder).map_err(|e|e.to_string())?;
  if !root.is_dir() {return Err("请选择文件夹".into());}
  let mut files=vec![]; let mut skipped=0;walk(&root,&root,recursive,&mut files,&mut skipped)?;
  files.sort_by(|a,b|a.relative.cmp(&b.relative));
  let rows=files.iter().enumerate().map(|(id,f)|Row{id,name:f.name.clone(),relative:f.relative.clone(),size:f.size}).collect();
  let mut s=store().lock().map_err(|_|"重命名服务暂不可用")?;
  s.sessions.retain(|_,v|v.time.elapsed().as_secs()<3600);s.plans.retain(|_,v|v.time.elapsed().as_secs()<900);
  if s.sessions.len()>=8 {s.sessions.clear();} // Expired previews fail closed; never modify files.
  let session=id();s.sessions.insert(session.clone(),Session{root,files,time:Instant::now()});
  Ok(Scan{session,rows,skipped})
 }).await.map_err(|e|e.to_string())?
}
pub fn valid_name(name:&str)->Result<(),String> {
 if name.is_empty() || name=="." || name==".." || name.ends_with(['.',' ']) || name.chars().any(|c|c<' ' || "<>:\"/\\|?*".contains(c)) {return Err("名称包含Windows不允许的字符，或以空格/句点结尾".into());}
 if name.encode_utf16().count()>255 {return Err("文件名超过文件系统的255字符长度限制".into());}
 let head=name.split('.').next().unwrap_or("").trim_end().to_uppercase();
 if ["CON","PRN","AUX","NUL","CONIN$","CONOUT$"].contains(&head.as_str()) || ((head.starts_with("COM")||head.starts_with("LPT")) && head.chars().count()==4 && "123456789¹²³".contains(head.chars().last().unwrap())) {return Err("这是Windows保留的设备名称".into());} Ok(())
}
fn unchanged(s:&Session)->Result<(),String> {
 if fs::canonicalize(&s.root).map_err(|e|e.to_string())?!=s.root {return Err("原目录已变化，请重新选择".into());}
 for f in &s.files {
  let m=fs::symlink_metadata(&f.path).map_err(|e|format!("{}: {e}",f.relative))?;
  if reparse(&m)||!m.is_file()||m.len()!=f.size||m.modified().ok()!=f.modified||m.created().ok()!=f.created||fs::canonicalize(f.path.parent().ok_or("目录无效")?).map_err(|e|e.to_string())?!=f.parent {return Err(format!("文件已变化，请重新预览：{}",f.relative));}
 } Ok(())
}
fn validate(s:&Session,names:&[String])->Result<usize,String> {
 if names.len()!=s.files.len() {return Err("文件列表已变化，请重新预览".into());}
 unchanged(s)?;
 let sources:HashSet<_>=s.files.iter().map(|f|f.path.to_string_lossy().to_uppercase()).collect();
 let mut targets=HashSet::new();let mut changed=0;
 for (f,n) in s.files.iter().zip(names) {
  valid_name(n).map_err(|e|format!("{} → {}: {}",f.relative,n,e))?;
  let target=f.parent.join(n); let key=target.to_string_lossy().to_uppercase();
  if !targets.insert(key.clone()) {return Err(format!("同一文件夹内出现重名：{n}"));}
  if fs::symlink_metadata(&target).is_ok()&&!sources.contains(&key) {return Err(format!("目标名称已存在，不会覆盖其他文件：{n}"));}
  if n!=&f.name {changed+=1;}
 } Ok(changed)
}
#[derive(Serialize)]
pub struct Preview { token:String, changed:usize }
#[tauri::command]
pub async fn rename_preview(session:String,names:Vec<String>)->Result<Preview,String> {
 tauri::async_runtime::spawn_blocking(move||{
  let mut st=store().lock().map_err(|_|"重命名服务暂不可用")?;
  let s=st.sessions.get(&session).filter(|s|s.time.elapsed().as_secs()<3600).ok_or("预览已过期，请重新选择文件夹")?.clone();
  let changed=validate(&s,&names)?; if changed==0 {return Err("没有需要更改的文件名".into());}
  st.plans.retain(|_,p|p.time.elapsed().as_secs()<900);
  if st.plans.len()>=16 {st.plans.clear();}
  let token=id();st.plans.insert(token.clone(),Plan{session:s,names,time:Instant::now()});Ok(Preview{token,changed})
 }).await.map_err(|e|e.to_string())?
}
#[cfg(windows)]
pub(crate) fn move_new(from:&Path,to:&Path)->Result<(),String> {
 use std::os::windows::ffi::OsStrExt;
 #[link(name="kernel32")] extern "system" {fn MoveFileExW(a:*const u16,b:*const u16,flags:u32)->i32;}
 let a:Vec<u16>=from.as_os_str().encode_wide().chain(Some(0)).collect();let b:Vec<u16>=to.as_os_str().encode_wide().chain(Some(0)).collect();
 if unsafe{MoveFileExW(a.as_ptr(),b.as_ptr(),0)}==0 {Err(std::io::Error::last_os_error().to_string())}else{Ok(())}
}
#[cfg(not(windows))]
pub(crate) fn move_new(_: &Path,_:&Path)->Result<(),String>{Err("原地重命名当前仅支持Windows桌面版".into())}
#[derive(Serialize,Deserialize)]
struct JournalRow { original:PathBuf, temporary:PathBuf, destination:PathBuf }
fn write_journal(path:&Path, rows:&[JournalRow],status:&str)->Result<(),String> {
 let body=serde_json::to_vec_pretty(&serde_json::json!({"status":status,"files":rows})).map_err(|e|e.to_string())?;
 crate::atomic_store::write(path,&body)
}
#[derive(Serialize)]
pub struct Receipt { changed:usize, journal:String }
#[tauri::command]
pub async fn rename_commit(app:tauri::AppHandle,token:String)->Result<Receipt,String> {
 tauri::async_runtime::spawn_blocking(move||{
  // Serializes operations within this process. A token can be consumed once only.
  let mut st=store().lock().map_err(|_|"重命名服务暂不可用")?;
  let p=st.plans.remove(&token).ok_or("确认已失效，请重新预览")?;
  if p.time.elapsed().as_secs()>900 {return Err("确认已过期，请重新预览".into());}
  validate(&p.session,&p.names)?;
  let rows:Vec<_>=p.session.files.iter().zip(&p.names).filter(|(f,n)|&f.name!=*n).map(|(f,n)|JournalRow{original:f.path.clone(),temporary:f.parent.join(format!(".furinakit-rename-{}",id())),destination:f.parent.join(n)}).collect();
  let dir=app.path().app_data_dir().map_err(|e|e.to_string())?.join("rename-journals");fs::create_dir_all(&dir).map_err(|e|e.to_string())?;
  let journal=dir.join(format!("{token}.json"));write_journal(&journal,&rows,"prepared")?;
  let mut staged=0;let mut finished=0;
  let result=(||->Result<(),String>{
   for r in &rows {move_new(&r.original,&r.temporary)?;staged+=1;}
   for r in &rows {move_new(&r.temporary,&r.destination)?;finished+=1;}
   Ok(())
  })();
  if let Err(error)=result {
   let mut recovery=vec![];
   for r in rows[..finished].iter().rev(){if let Err(e)=move_new(&r.destination,&r.temporary){recovery.push(e);}}
   for r in rows[..staged].iter().rev(){if let Err(e)=move_new(&r.temporary,&r.original){recovery.push(e);}}
   let state=if recovery.is_empty(){"rolled_back"}else{"manual_recovery_required"};let _=write_journal(&journal,&rows,state);
   return Err(format!("重命名失败：{error}。恢复状态：{state}。未删除文件；恢复清单：{}",journal.display()));
  }
  // Keep the prepared journal even if recording completion fails: do not misreport file operations.
  let _=write_journal(&journal,&rows,"completed");
  st.sessions.retain(|_,s|s.root!=p.session.root);
  Ok(Receipt{changed:rows.len(),journal:journal.to_string_lossy().into_owned()})
 }).await.map_err(|e|e.to_string())?
}
