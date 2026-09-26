//! Genuine whisper.cpp execution with pinned GGML model checksums and owned processes.
use serde_json::{json,Value};
use std::{fs,path::{Path,PathBuf},sync::{Mutex,OnceLock,Arc},collections::HashMap,time::Duration};
use crate::{api::ComponentInfo,owned_tasks::{self,Control},download_process::OwnedProcess};
pub struct Model{pub id:&'static str,pub label:&'static str,pub size:u64,pub sha:&'static str,pub note:&'static str}
pub const MODELS:&[Model]=&[
 Model{id:"tiny",label:"Whisper Tiny",size:77691713,sha:"be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21",note:"轻量快速，适合试用；复杂内容准确率较低"},
 Model{id:"base",label:"Whisper Base",size:147951465,sha:"60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",note:"低内存CPU环境推荐，中英等多语言"},
 Model{id:"small",label:"Whisper Small",size:487601967,sha:"1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",note:"更注重准确率；需要更多内存和时间"},
 Model{id:"large-v3-turbo-q5_0",label:"Whisper Large v3 Turbo Q5",size:574041195,sha:"394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",note:"量化多语言模型，建议至少4GB可用内存"},
 Model{id:"medium",label:"Whisper Medium",size:1533763059,sha:"6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208",note:"较大模型，CPU处理较慢；建议至少6GB可用内存"},
];
pub fn model(id:&str)->Result<&'static Model,String>{MODELS.iter().find(|m|m.id==id).ok_or("不支持的语音模型".into())}
pub fn components()->Vec<ComponentInfo>{MODELS.iter().map(|m|{let file=format!("ggml-{}.bin",m.id);ComponentInfo{id:format!("whisper-{}",m.id),name:m.label.into(),purpose:format!("本机语音识别：{}。首次下载需要联网，转写不上传音频。",m.note),file:file.clone(),size:m.size,mirrors:vec![format!("https://www.modelscope.cn/models/iceCream2025/whisper.cpp/resolve/master/{file}"),format!("https://www.modelscope.cn/models/viggocx/whisper.cpp/resolve/master/{file}"),format!("https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/{file}"),format!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{file}")],requirement:m.note.into(),downloaded:false,downloaded_bytes:0,file_path:String::new(),busy:false}}).collect()}
fn downloads()->&'static Mutex<HashMap<String,Value>>{static STATE:OnceLock<Mutex<HashMap<String,Value>>>=OnceLock::new();STATE.get_or_init(||Mutex::new(HashMap::new()))}
fn path(app:&tauri::AppHandle,m:&Model)->Result<PathBuf,String>{Ok(crate::api::components_dir(app)?.join(format!("ggml-{}.bin",m.id)))}
pub fn models(app:&tauri::AppHandle)->Value{
 let dir=match crate::api::components_dir(app){Ok(dir)=>dir,Err(error)=>return json!({"ready":false,"error":error,"models":[],"dir":null})};
 let rows:Vec<_>=MODELS.iter().map(|m|{let path=dir.join(format!("ggml-{}.bin",m.id));let ready=fs::metadata(&path).map(|v|v.is_file()&&v.len()==m.size).unwrap_or(false);let part=path.with_file_name(format!("ggml-{}.bin.part",m.id));let received=fs::metadata(part).map(|v|v.len()).unwrap_or(0);let mut state=downloads().lock().unwrap_or_else(|e|e.into_inner()).get(m.id).cloned();if crate::api::component_busy(&format!("whisper-{}",m.id)){state=Some(json!({"status":"downloading","error":null}));}if let Some(s)=state.as_mut(){s["received"]=json!(received);s["total"]=json!(m.size);}
 json!({"id":m.id,"label":m.label,"size":m.size,"note":m.note,"recommended":m.id=="base","downloaded":ready,"download":state})}).collect();
 let engine=owned_tasks::engine(app,"whisper").and_then(|_|owned_tasks::engine(app,"ffmpeg"));
 json!({"ready":engine.is_ok(),"error":engine.err(),"models":rows,"dir":dir.to_string_lossy()})
}
pub fn start_download(app:&tauri::AppHandle,id:&str)->Result<Value,String>{
 let m=model(id)?;let mut state=downloads().lock().map_err(|_|"下载状态异常")?;
 if state.get(id).map(|s|s["status"]=="downloading").unwrap_or(false){return Ok(json!({"ok":true,"message":"正在下载"}));}
 state.insert(id.into(),json!({"status":"downloading","received":0,"total":m.size,"error":null}));drop(state);
 let app=app.clone();let id=id.to_owned();std::thread::spawn(move||{let result=crate::api::download_component(&app,&format!("whisper-{id}"));downloads().lock().unwrap_or_else(|e|e.into_inner()).insert(id,match result{Ok(_)=>json!({"status":"done","error":null}),Err(error)=>json!({"status":"error","error":error})});});
 Ok(json!({"ok":true,"message":"真实模型下载已开始，可关闭此页面"}))
}
pub fn verify(file:&Path,model:&Model)->Result<(),String>{
 if fs::metadata(file).map_err(|e|e.to_string())?.len()!=model.size{return Err("语音模型大小不符，请在设置中重新下载".into());}
 if owned_tasks::digest(file)?!=model.sha{return Err("语音模型SHA-256校验失败，请在设置中重新下载".into());}Ok(())
}
pub fn start(app:&tauri::AppHandle,args:&Value)->Result<Value,String>{
 let selected=model(args["model"].as_str().unwrap_or("base"))?;
 let component_lease=crate::api::component_use(app,&["ffmpeg.exe","ffprobe.exe",&format!("ggml-{}.bin",selected.id)])?;
 let language=args["language"].as_str().unwrap_or("auto");if !["auto","zh","en","ja","ko","yue","fr","de","es","ru"].contains(&language){return Err("不支持的识别语言".into());}
 owned_tasks::engine(app,"whisper")?;owned_tasks::engine(app,"ffmpeg")?;
 if !path(app,selected)?.is_file(){return Err("请先下载所选语音模型".into());}
 let files=args["__files"].as_array().ok_or("请上传音频或视频文件")?;if files.len()!=1{return Err("一次请选择一个音频或视频文件".into());}
 let uploads=crate::jobs::save_request_uploads(app,&crate::jobs::new_job_id_public(),files)?;
 let source=uploads[0]["path"].as_str().ok_or("上传文件不可用")?;
 let payload=json!({"model":selected.id,"language":language,"output":args["output"].as_str().unwrap_or("txt"),"input":source});
 let job=crate::jobs::create_native_job(app,"audio-transcribe","whisper",payload.clone())?;let id=job["id"].as_str().ok_or("缺少任务编号")?.to_owned();

 let control=match owned_tasks::reserve(&id,"whisper"){Ok(c)=>c,Err(e)=>{let _=crate::jobs::update_job(app,&id,json!({"status":"failed","error":e}).as_object().unwrap().clone());return Err(e);}};
 let handle=app.clone();let tid=id.clone();let tc=control.clone();
 let spawned=std::thread::Builder::new().name("native-whisper".into()).spawn(move||{let(scope,outcome)=owned_tasks::resource_scope(&handle,&tid,&tc,component_lease);let result=std::panic::catch_unwind(std::panic::AssertUnwindSafe(||run(&handle,&tid,&payload,&tc,&scope))).unwrap_or_else(|_|Err("语音引擎异常".into()));owned_tasks::finish_scoped(&handle,&tid,result,scope,outcome);});
 if let Err(error)=spawned{let message=format!("无法启动转写任务 / Cannot start transcription: {error}");owned_tasks::finish(app,&id,&control,Err(message.clone()));return Err(message);}
 Ok(json!({"ok":true,"job":job}))
}
fn run(app:&tauri::AppHandle,id:&str,payload:&Value,control:&Arc<Control>,scope:&crate::task_custody::Scope)->Result<Value,String>{
 let dir=crate::jobs::storage_dir(app).join("results").join(id);fs::create_dir_all(&dir).map_err(|e|e.to_string())?;let dir=fs::canonicalize(dir).map_err(|e|e.to_string())?;
 let m=model(payload["model"].as_str().unwrap_or("base"))?;let model_path=path(app,m)?;
 owned_tasks::progress(app,id,control,json!({"status":"processing","progress":3,"message":"正在校验模型SHA-256…"}))?;verify(&model_path,m)?;
 if control.request.load(std::sync::atomic::Ordering::SeqCst)!=0{return Err("已停止".into());}
 let wav=dir.join("input.wav");let input=payload["input"].as_str().ok_or("缺少音频")?;
 owned_tasks::progress(app,id,control,json!({"status":"processing","progress":10,"message":"正在提取16kHz单声道音频…"}))?;
 {let args=vec!["-nostdin".into(),"-hide_banner".into(),"-loglevel".into(),"error".into(),"-y".into(),"-i".into(),input.into(),"-vn".into(),"-ac".into(),"1".into(),"-ar".into(),"16000".into(),"-c:a".into(),"pcm_s16le".into(),wav.to_string_lossy().into_owned()];let process=scope.own(OwnedProcess::spawn(&owned_tasks::engine(app,"ffmpeg")?,&args,&dir)?);owned_tasks::wait(&process,control,Duration::from_secs(7200))?;}
 owned_tasks::progress(app,id,control,json!({"status":"processing","progress":20,"message":"Whisper正在本机转写（阶段进度，长录音可能耗时较久）…"}))?;
 let output=dir.join("transcript");let threads=std::thread::available_parallelism().map(|n|n.get().min(8)).unwrap_or(2).to_string();
 {let args=vec!["-m".into(),model_path.to_string_lossy().into_owned(),"-f".into(),wav.to_string_lossy().into_owned(),"-l".into(),payload["language"].as_str().unwrap_or("auto").into(),"-t".into(),threads,"-otxt".into(),"-osrt".into(),"-oj".into(),"-of".into(),output.to_string_lossy().into_owned(),"-ng".into()];let process=scope.own(OwnedProcess::spawn(&owned_tasks::engine(app,"whisper")?,&args,&dir)?);owned_tasks::wait(&process,control,Duration::from_secs(86400))?;}
 let transcript=read_text(&dir.join("transcript.txt"))?;if transcript.trim().is_empty(){return Err("没有识别到有效语音，请检查音轨、语言或换更大的模型".into());}
 let _=fs::remove_file(&wav);let ext=if payload["output"]=="srt"{"srt"}else{"txt"};let result=dir.join(format!("transcript.{ext}"));let bytes=fs::metadata(&result).map_err(|e|e.to_string())?.len();
 Ok(json!({"status":"completed","progress":100,"message":"本机转写完成，TXT和SRT均已生成","resultPath":result.to_string_lossy(),"resultFilename":format!("语音转写.{ext}"),"resultMimeType":"text/plain; charset=utf-8","resultBytes":bytes}))
}
fn read_text(path:&Path)->Result<String,String>{if fs::metadata(path).map_err(|e|e.to_string())?.len()>32*1024*1024{return Err("转写结果过大，请直接保存文件查看".into());}fs::read_to_string(path).map_err(|e|e.to_string())}
pub fn result(app:&tauri::AppHandle,args:&Value)->Result<Value,String>{
 let id=args.get("job").or_else(||args.get("id")).or_else(||args.get("jobId")).and_then(Value::as_str).ok_or("缺少任务编号")?;
 if !crate::jobs::is_valid_job_id(id){return Err("任务编号无效".into());}
 let job=crate::jobs::read_job_public(app,id).ok_or("任务不存在")?;if job["status"]!="completed"||job["nativeEngine"]!="whisper"{return Err("转写尚未完成或任务类型不符".into());}
 let base=fs::canonicalize(crate::jobs::storage_dir(app).join("results")).map_err(|e|e.to_string())?;let dir=fs::canonicalize(base.join(id)).map_err(|e|e.to_string())?;if !dir.starts_with(&base){return Err("结果位置无效".into());}
 let download=args["download"].as_str().unwrap_or("");
 if !download.is_empty(){if !["txt","srt"].contains(&download){return Err("不支持的导出格式".into());}let text=read_text(&dir.join(format!("transcript.{download}")))?;return Ok(json!({"__binary":{"data":crate::jobs::b64_encode_public(text.as_bytes()),"name":format!("语音转写.{download}"),"mime":"text/plain; charset=utf-8","kind":"file"}}));}
 let text=read_text(&dir.join("transcript.txt"))?;let segments=read_text(&dir.join("transcript.json")).ok().and_then(|s|serde_json::from_str::<Value>(&s).ok()).and_then(|v|v.get("transcription").cloned()).unwrap_or(json!([]));
 Ok(json!({"text":text,"hasSrt":dir.join("transcript.srt").is_file(),"segments":segments,"job":job}))
}
