//! Native converters and audio effects: native owned jobs, validated optional engines, every uploaded file processed.
use std::{fs,path::PathBuf,sync::{Arc,atomic::Ordering}};
use serde_json::{json,Value};
use crate::{owned_tasks::{self,Control},image_artifacts::{Scratch,copy_new},media_audio};
/// 去 Python 化：默认一律走 Rust 原生；仅排查问题时可设 FURINAKIT_NATIVE_MEDIA=0 退回旧的 Python 路线（精简安装布局始终原生）。
pub fn enabled(app:&tauri::AppHandle)->bool{crate::runtime_layout::is_native_base(&crate::app_root_of(app))||std::env::var("FURINAKIT_NATIVE_MEDIA").as_deref()!=Ok("0")}
fn run(app:&tauri::AppHandle,id:&str,control:&Control,plan:&media_audio::Plan,inputs:&[(PathBuf,String)],scope:&crate::task_custody::Scope)->Result<Value,String>{
 let check=||if control.request.load(Ordering::SeqCst)!=0{Err("音视频任务已取消 / Media task cancelled".into())}else{Ok(())};check()?;
 owned_tasks::progress(app,id,control,json!({"status":"processing","progress":2,"message":"正在校验可选音视频组件 / Verifying optional media engines"}))?;
 let(ffmpeg,ffprobe)=crate::ffmpeg_components::verified_pair(&crate::api::components_dir(app)?)?;check()?;
 let storage=crate::jobs::storage_dir_of(app);let scratch=Scratch::create(&storage.join("tmp"),&format!("media-{id}"))?;let work=fs::canonicalize(&scratch.0).map_err(|e|e.to_string())?;
 let resources=crate::task_custody::Scope::new((scratch,scope.retain()));
 let progress=|index:usize,count:usize|owned_tasks::progress(app,id,control,json!({"status":"processing","progress":5+85*index/count,"message":format!("正在处理第 {}/{} 个文件（阶段进度） / Processing file {}/{} (stage progress)",index+1,count,index+1,count)}));
 let batch=media_audio::process_batch(&ffmpeg,&ffprobe,inputs,&work,plan,&check,&progress,&resources)?;
 check()?;owned_tasks::progress(app,id,control,json!({"progress":92,"message":"正在保存处理结果 / Saving results"}))?;
 let (filename,source,mime)=media_audio::package_batch(&batch,if plan.is_merge(){1}else{inputs.len()},&work,&plan.format,&check)?;
 let succeeded=if plan.is_merge(){inputs.len()}else{batch.entries.len()};
 let results=storage.join("results");fs::create_dir_all(&results).map_err(|e|e.to_string())?;let target=results.join(format!("{id}-{filename}"));let bytes=copy_new(&source,&target,media_audio::MAX_OUTPUT,&check)?;if let Err(e)=check(){let _=fs::remove_file(&target);return Err(e);}
 let notice=if inputs.len()==1{batch.details.first().and_then(|v|v["warning"].as_str()).unwrap_or(&plan.notice)}else{&plan.notice};
 Ok(json!({"status":"completed","progress":100,"message":format!("成功 {}/{}，失败 {} / Succeeded {}/{}, failed {}. {}",succeeded,inputs.len(),batch.failures,succeeded,inputs.len(),batch.failures,notice),"resultPath":target.to_string_lossy(),"resultFilename":filename,"resultMimeType":mime,"resultBytes":bytes,"engine":"rust-ffmpeg-owned","mediaFileCount":inputs.len(),"mediaSucceededCount":succeeded,"mediaFailedCount":batch.failures,"partialFailure":batch.failures>0,"mediaResults":batch.details}))
}
pub fn start(app:&tauri::AppHandle,tool:&str,args:&Value)->Result<Value,String>{
 let plan=media_audio::plan(tool,args)?;let component_lease=crate::api::component_use(app,&["ffmpeg.exe","ffprobe.exe"])?;if !crate::ffmpeg_components::pair_present(&crate::api::components_dir(app)?){return Err("缺少完整FFmpeg / FFprobe组件，请前往「设置 → 组件管理」主动下载安装后重试 / Install the FFmpeg / FFprobe component from Settings → Components".into());}
 let mut payload=args.as_object().cloned().ok_or("Invalid media parameters")?;
 let inputs:Vec<(PathBuf,String)>=if let Some(files)=args["__files"].as_array(){if files.is_empty()||files.len()>100{return Err("每批请选择1–100个文件 / Select 1–100 files".into());}let saved=crate::jobs::save_request_uploads(app,&crate::jobs::new_job_id_public(),files)?;saved.iter().map(|s|Ok((PathBuf::from(s["path"].as_str().ok_or("Missing media upload")?),s["name"].as_str().unwrap_or("audio").to_owned()))).collect::<Result<_,String>>()?}else{let list=if let Some(paths)=args["files"].as_array(){if paths.len()>100{return Err("Too many media files".into());}paths.iter().map(|p|p.as_str().ok_or("Invalid media path")).collect::<Result<Vec<_>,_>>()?}else{vec![args["file"].as_str().ok_or("请选择音视频文件 / Select a media file")?]};list.iter().map(|s|{let p=PathBuf::from(s);let name=p.file_name().and_then(|s|s.to_str()).unwrap_or("audio").to_owned();(p,name)}).collect()};
 if inputs.is_empty(){return Err("Select a media file".into());}let mut bytes=0u64;for(p,_)in&inputs{let m=fs::metadata(p).map_err(|e|e.to_string())?;if !m.is_file()||m.len()==0||m.len()>64*1024*1024*1024{return Err("Media file is empty, missing or exceeds 64 GiB".into());}bytes+=m.len();}if bytes>128*1024*1024*1024{return Err("Media batch exceeds 128 GiB".into());}
 for key in["__files","__path","__method"]{payload.remove(key);}payload.insert("files".into(),json!(inputs.iter().map(|(p,_)|p.to_string_lossy()).collect::<Vec<_>>()));
 let job=crate::jobs::create_native_job(app,tool,"media",Value::Object(payload))?;let id=job["id"].as_str().ok_or("Missing media job ID")?.to_owned();let control=match owned_tasks::reserve(&id,"media"){Ok(c)=>c,Err(e)=>{let _=crate::jobs::update_job(app,&id,json!({"status":"failed","error":e}).as_object().unwrap().clone());return Err(e);}};
 let handle=app.clone();let tid=id.clone();let tc=Arc::clone(&control);let spawned=std::thread::Builder::new().name("native-media".into()).spawn(move||{let(scope,outcome)=owned_tasks::resource_scope(&handle,&tid,&tc,component_lease);let result=run(&handle,&tid,&tc,&plan,&inputs,&scope);owned_tasks::finish_scoped(&handle,&tid,result,scope,outcome);});
 if let Err(e)=spawned{let message=format!("Cannot start media task: {e}");owned_tasks::finish(app,&id,&control,Err(message.clone()));return Err(message);}Ok(json!({"ok":true,"job":job,"engine":"rust-ffmpeg-owned"}))
}
