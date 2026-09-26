//! One owned aria2 RPC instance per explicitly started task. No startup networking.
use std::{fs,path::{Path,PathBuf},net::{TcpListener,TcpStream,SocketAddr,UdpSocket},io::{Read,Write},sync::{Arc,atomic::Ordering},time::{Duration,Instant}};
use serde_json::{json,Value};
use crate::{owned_tasks::{self,Control},download_process::OwnedProcess};
struct Rpc{port:u16,secret:String}
impl Rpc{fn call(&self,method:&str,mut params:Vec<Value>)->Result<Value,String>{
 params.insert(0,json!(format!("token:{}",self.secret)));let body=serde_json::to_vec(&json!({"jsonrpc":"2.0","id":"furinakit","method":format!("aria2.{method}"),"params":params})).map_err(|e|e.to_string())?;
 let address:SocketAddr=format!("127.0.0.1:{}",self.port).parse().map_err(|_|"本地RPC地址错误")?;let mut stream=TcpStream::connect_timeout(&address,Duration::from_millis(700)).map_err(|_|"aria2尚未响应")?;
 stream.set_read_timeout(Some(Duration::from_secs(2))).map_err(|e|e.to_string())?;stream.set_write_timeout(Some(Duration::from_secs(2))).map_err(|e|e.to_string())?;
 write!(stream,"POST /jsonrpc HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: {}\r\n\r\n",self.port,body.len()).map_err(|e|e.to_string())?;stream.write_all(&body).map_err(|e|e.to_string())?;
 let mut response=Vec::new();stream.take(2*1024*1024+1).read_to_end(&mut response).map_err(|_|"aria2响应超时")?;if response.len()>2*1024*1024{return Err("aria2响应超出限制".into());}
 let boundary=response.windows(4).position(|x|x==b"\r\n\r\n").ok_or("aria2响应格式错误")?;
 let result:Value=serde_json::from_slice(&response[boundary+4..]).map_err(|_|"aria2返回无效JSON")?;if result.get("error").is_some(){return Err(format!("aria2：{}",result["error"]["message"].as_str().unwrap_or("请求失败")));}result.get("result").cloned().ok_or("aria2未返回结果".into())
}}
fn source(app:&tauri::AppHandle,args:&Value)->Result<Value,String>{
 if let Some(uri)=args.get("magnet").or_else(||args.get("url")).and_then(Value::as_str).map(str::trim).filter(|v|!v.is_empty()){
  if uri.len()>16384{return Err("磁力链接过长".into());}let url=url::Url::parse(uri).map_err(|_|"磁力链接无效")?;
  if url.scheme()!="magnet"||!url.query_pairs().any(|(key,value)|key=="xt"&&value.strip_prefix("urn:btih:").map(|h|(h.len()==40&&h.chars().all(|c|c.is_ascii_hexdigit()))||(h.len()==32&&h.chars().all(|c|c.is_ascii_alphabetic()||('2'..='7').contains(&c)))).unwrap_or(false)){return Err("需要包含有效BTIH的magnet链接".into());}
  return Ok(json!({"kind":"magnet","value":uri}));
 }
 let files=args["__files"].as_array().ok_or("请粘贴磁力链接或选择torrent文件")?;if files.len()!=1{return Err("一次请选择一个torrent文件".into());}
 let saved=crate::jobs::save_request_uploads(app,&crate::jobs::new_job_id_public(),files)?;let path=PathBuf::from(saved[0]["path"].as_str().ok_or("上传种子不可用")?);
 if fs::metadata(&path).map_err(|e|e.to_string())?.len()>8*1024*1024{return Err("种子文件超过8MB限制".into());}let bytes=fs::read(&path).map_err(|e|e.to_string())?;if bytes.first()!=Some(&b'd')||bytes.last()!=Some(&b'e'){return Err("不是有效的torrent文件".into());}
 Ok(json!({"kind":"torrent","value":path.to_string_lossy()}))
}
pub fn api(app:&tauri::AppHandle,args:&Value)->Result<Value,String>{
 match args["action"].as_str().unwrap_or("status"){
 "status"=>{let engine=owned_tasks::engine(app,"aria2");Ok(json!({"ready":engine.is_ok(),"mode":"bundled-owned","message":engine.err(),"tasks":crate::jobs::list_native_jobs(app).into_iter().filter(|j|j["nativeEngine"]=="aria2").collect::<Vec<_>>()}))},
 "start"=>{owned_tasks::engine(app,"aria2")?;let source=source(app,args)?;let output=crate::default_output::directory(app)?;
  let job=crate::jobs::create_native_job(app,"magnet-download","aria2",json!({"source":source}))?;let id=job["id"].as_str().ok_or("缺少任务编号")?.to_owned();let output=output.join(format!("磁力下载-{id}"));
  let setup=(||->Result<(),String>{
  fs::create_dir(&output).map_err(|e|e.to_string())?;let output=fs::canonicalize(output).map_err(|e|e.to_string())?;
  let payload=json!({"source":source,"outputDir":output.to_string_lossy()});crate::jobs::update_job(app,&id,json!({"payload":payload,"outputDir":output.to_string_lossy(),"message":"正在启动自有aria2引擎…"}).as_object().unwrap().clone()).ok_or("保存下载任务失败")?;
  launch(app,&id,payload)
  })();if let Err(error)=setup{let _=crate::jobs::update_job(app,&id,json!({"status":"failed","error":error}).as_object().unwrap().clone());return Err(error);}Ok(json!({"ok":true,"job":crate::jobs::read_job_public(app,&id)}))},
 "delete"=>{let id=job_id(args)?;owned_job(app,id)?;owned_tasks::forget_magnet(app,id)},
 "pause"|"cancel"=>{let id=job_id(args)?;owned_job(app,id)?;owned_tasks::stop(app,id,args["action"]=="pause")},
 "resume"=>{let id=job_id(args)?;let job=owned_job(app,id)?;if job["status"]!="paused"{return Err("只有已暂停任务可以继续；失败任务请重新提交".into());}launch(app,id,job["payload"].clone())?;Ok(json!({"ok":true,"job":crate::jobs::read_job_public(app,id)}))},
 "open"=>{let job=owned_job(app,job_id(args)?)?;let path=PathBuf::from(job["outputDir"].as_str().ok_or("此任务没有输出目录")?);if !path.is_absolute()||!path.is_dir(){return Err("下载目录不存在".into());}crate::commands::open_path(app.clone(),path.to_string_lossy().into_owned())?;Ok(json!({"ok":true}))},
 _=>Err("未知磁力任务操作".into())
 }
}
fn job_id(args:&Value)->Result<&str,String>{args["job"].as_str().filter(|id|crate::jobs::is_valid_job_id(id)).ok_or("任务编号无效".into())}
fn owned_job(app:&tauri::AppHandle,id:&str)->Result<Value,String>{let job=crate::jobs::read_job_public(app,id).ok_or("任务不存在")?;if job["nativeEngine"]!="aria2"{return Err("不是自有磁力任务".into());}Ok(job)}
fn launch(app:&tauri::AppHandle,id:&str,payload:Value)->Result<(),String>{
 owned_tasks::engine(app,"aria2")?;let control=owned_tasks::reserve(id,"aria2")?;
 if let Err(e)=owned_tasks::progress(app,id,&control,json!({"status":"processing","message":"正在恢复断点并连接可用节点…","error":null,"speed":0})){owned_tasks::finish(app,id,&control,Err(e.clone()));return Err(e);}
 let app=app.clone();let id=id.to_owned();std::thread::spawn(move||{let result=std::panic::catch_unwind(std::panic::AssertUnwindSafe(||run(&app,&id,&payload,&control))).unwrap_or_else(|_|Err("下载引擎异常".into()));owned_tasks::finish(&app,&id,&control,result);});Ok(())
}
fn stop_child(process:&OwnedProcess,rpc:&Rpc)->Result<(),String>{let _=rpc.call("forcePauseAll",vec![]);let _=rpc.call("saveSession",vec![]);let _=rpc.call("shutdown",vec![]);let start=Instant::now();while start.elapsed()<Duration::from_secs(3){if process.try_exit()?.is_some(){return Ok(());}std::thread::sleep(Duration::from_millis(100));}process.terminate(Duration::from_secs(5))}
fn number(v:&Value,key:&str)->u64{v[key].as_str().and_then(|s|s.parse().ok()).or_else(||v[key].as_u64()).unwrap_or(0)}
fn engine_path(path:&Path)->String {
 let text=path.to_string_lossy();
 if let Some(rest)=text.strip_prefix(r"\\?\UNC\"){format!(r"\\{}",rest)}
 else {text.strip_prefix(r"\\?\").unwrap_or(&text).to_owned()}
}
fn run(app:&tauri::AppHandle,id:&str,payload:&Value,control:&Arc<Control>)->Result<Value,String>{
 let state=crate::jobs::storage_dir(app).join("native-downloads").join(id);fs::create_dir_all(&state).map_err(|e|e.to_string())?;let state=fs::canonicalize(state).map_err(|e|e.to_string())?;
 let output=PathBuf::from(payload["outputDir"].as_str().ok_or("下载目录缺失")?);if !output.is_absolute()||!output.is_dir(){return Err("原下载目录已移动或不可用；为保护断点，不会改写到其它目录".into());}
 let listener=TcpListener::bind("127.0.0.1:0").map_err(|e|e.to_string())?;let port=listener.local_addr().map_err(|e|e.to_string())?.port();drop(listener);
 let tcp=TcpListener::bind("0.0.0.0:0").map_err(|e|format!("无法分配BT监听端口：{e}"))?;let bt_port=tcp.local_addr().map_err(|e|e.to_string())?.port();
 let udp=UdpSocket::bind("0.0.0.0:0").map_err(|e|format!("无法分配DHT端口：{e}"))?;let dht_port=udp.local_addr().map_err(|e|e.to_string())?.port();drop(tcp);drop(udp);
 let rpc=Rpc{port,secret:uuid::Uuid::new_v4().to_string()};
 let args=vec!["--no-conf=true".into(),"--enable-rpc=true".into(),"--rpc-listen-all=false".into(),format!("--rpc-listen-port={port}"),format!("--rpc-secret={}",rpc.secret),"--rpc-allow-origin-all=false".into(),"--enable-color=false".into(),"--console-log-level=error".into(),"--summary-interval=0".into(),"--file-allocation=none".into(),"--disk-cache=32M".into(),"--max-download-limit=0".into(),"--max-overall-download-limit=0".into(),"--seed-time=0".into(),"--bt-save-metadata=true".into(),"--auto-save-interval=10".into(),"--continue=true".into(),"--allow-overwrite=false".into(),"--auto-file-renaming=true".into(),"--bt-enable-lpd=false".into(),"--enable-dht=true".into(),"--enable-dht6=false".into(),"--enable-peer-exchange=true".into(),"--dht-entry-point=router.bittorrent.com:6881".into(),format!("--listen-port={bt_port}"),format!("--dht-listen-port={dht_port}"),"--bt-max-peers=160".into(),"--bt-request-peer-speed-limit=5M".into(),"--bt-tracker-connect-timeout=10".into(),"--bt-tracker-timeout=15".into(),"--bt-stop-timeout=300".into(),"--bt-tracker=udp://tracker.opentrackr.org:1337/announce,udp://open.stealth.si:80/announce,udp://tracker.torrent.eu.org:451/announce,https://tracker.tamersunion.org:443/announce,https://tracker.gbitt.info:443/announce,http://tracker.opentrackr.org:1337/announce,udp://exodus.desync.com:6969/announce".into(),"--max-concurrent-downloads=1".into(),"--force-save=true".into(),"--save-session-interval=10".into(),format!("--save-session={}",engine_path(&state.join("session.txt"))),format!("--dht-file-path={}",engine_path(&state.join("dht.dat"))),format!("--dht-file-path6={}",engine_path(&state.join("dht6.dat"))),format!("--dir={}",engine_path(&output))];
 let process=OwnedProcess::spawn(&owned_tasks::engine(app,"aria2")?,&args,&state)?;let start=Instant::now();
 loop{if control.request.load(Ordering::SeqCst)!=0{stop_child(&process,&rpc)?;return Err("任务已停止".into());}if rpc.call("getVersion",vec![]).is_ok(){break;}if let Some(code)=process.try_exit()?{return Err(format!("aria2启动失败，退出码{code}"));}if start.elapsed()>Duration::from_secs(15){return Err("aria2启动超时（未连接任何外部RPC服务）".into());}std::thread::sleep(Duration::from_millis(200));}
 let source=&payload["source"];let options=json!({"dir":engine_path(&output),"seed-time":"0","continue":"true","allow-overwrite":"false"});
 let gid=if source["kind"]=="magnet"{rpc.call("addUri",vec![json!([source["value"].as_str().ok_or("磁力链接缺失")?]),options])?}else{let path=PathBuf::from(source["value"].as_str().ok_or("种子路径缺失")?);let owned=fs::canonicalize(crate::jobs::storage_dir(app).join("uploads")).map_err(|e|e.to_string())?;let path=fs::canonicalize(path).map_err(|e|e.to_string())?;if !path.starts_with(owned)||fs::metadata(&path).map_err(|e|e.to_string())?.len()>8*1024*1024{return Err("种子不在受控上传目录或体积过大".into());}rpc.call("addTorrent",vec![json!(crate::jobs::b64_encode_public(&fs::read(path).map_err(|e|e.to_string())?)),json!([]),options])?};
 let metadata_started=Instant::now();let mut metadata_resolved=source["kind"]!="magnet";
 let mut gid=gid.as_str().ok_or("aria2没有返回任务ID")?.to_owned();let mut failures=0;let mut complete_seen=false;
 loop{
  if control.request.load(Ordering::SeqCst)!=0{stop_child(&process,&rpc)?;return Err("任务已停止".into());}if let Some(code)=process.try_exit()?{return Err(format!("aria2意外退出：{code}；断点文件已保留"));}
  let status=match rpc.call("tellStatus",vec![json!(gid),json!(["gid","status","totalLength","completedLength","downloadSpeed","connections","numSeeders","errorCode","errorMessage","followedBy","bittorrent","files","infoHash"])]){Ok(s)=>{failures=0;s},Err(e)=>{failures+=1;if failures>=5{return Err(e);}std::thread::sleep(Duration::from_millis(500));continue;}};
  if let Some(next)=status["followedBy"].as_array().and_then(|v|v.first()).and_then(Value::as_str){gid=next.into();metadata_resolved=true;complete_seen=false;continue;}
  let total=number(&status,"totalLength");let done=number(&status,"completedLength");let speed=number(&status,"downloadSpeed");let stage=status["status"].as_str().unwrap_or("");
  if !metadata_resolved && metadata_started.elapsed()>Duration::from_secs(180){stop_child(&process,&rpc)?;return Err("3分钟内未获取到种子元数据。已启用DHT引导和公共Tracker；请确认资源有做种、网络允许UDP/BT，或尝试导入torrent。断点已保留，并未完成下载。".into());}
  if stage=="error"||stage=="removed"{return Err(format!("下载失败（{}）：{}；已保留断点",status["errorCode"].as_str().unwrap_or(""),status["errorMessage"].as_str().unwrap_or("任务已被移除")));}
  if stage=="complete"&&complete_seen&&metadata_resolved{
   let files=status["files"].as_array().ok_or("引擎完成但没有文件清单")?;let manifest:Vec<_>=files.iter().filter_map(|file|{let path=PathBuf::from(file["path"].as_str()?);let path=fs::canonicalize(path).ok()?;if !path.starts_with(&output)||!path.is_file(){return None;}Some(json!({"name":path.strip_prefix(&output).ok()?.to_string_lossy(),"bytes":fs::metadata(path).ok()?.len()}))}).collect();
   if manifest.len()!=files.len()||manifest.is_empty(){return Err("引擎完成但实际下载文件不可读；不会报告虚假完成".into());}
   let artifacts=crate::jobs::storage_dir(app).join("results").join(id);fs::create_dir_all(&artifacts).map_err(|e|e.to_string())?;let result=artifacts.join("download-manifest.json");crate::atomic_store::write(&result,&serde_json::to_vec_pretty(&json!({"outputDir":output.to_string_lossy(),"files":manifest})).map_err(|e|e.to_string())?)?;
   stop_child(&process,&rpc)?;return Ok(json!({"status":"completed","progress":100,"message":"下载完成；实际文件已保存在任务目录，可直接打开","downloadedBytes":done,"totalBytes":total,"speed":0,"outputDir":output.to_string_lossy(),"resultPath":result.to_string_lossy(),"resultFilename":"磁力下载文件清单.json","resultMimeType":"application/json"}));
  }
  complete_seen=stage=="complete";
  owned_tasks::progress(app,id,control,json!({"status":"processing","stage":if metadata_resolved{"download"}else{"metadata"},"progress":if metadata_resolved&&total>0{(done.saturating_mul(100)/total).min(99)}else{0},"downloadedBytes":done,"totalBytes":total,"speed":speed,"connections":number(&status,"connections"),"seeders":number(&status,"numSeeders"),"message":if !metadata_resolved{"正在获取种子元数据；无可用节点时可能需要等待"}else if speed==0{"正在连接可用节点；速度为0并不代表已完成"}else{"正在下载（真实字节进度）"}}))?;
  std::thread::sleep(Duration::from_millis(900));
 }
}
