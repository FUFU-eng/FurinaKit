//! Built-in screenshot and image upscaling share one native image task lifecycle.
use std::{path::PathBuf,fs,sync::{Arc,atomic::{AtomicBool,Ordering}},time::Duration};
use serde_json::{Value,json};
use crate::{owned_tasks::{self,Control},image_artifacts::{Scratch,copy_new},task_custody::Scope};
static GPU_BUSY:AtomicBool=AtomicBool::new(false);
struct GpuSlot;
impl Drop for GpuSlot{fn drop(&mut self){GPU_BUSY.store(false,Ordering::Release);}}
fn run(app:&tauri::AppHandle,id:&str,control:&Control,scale:u32,inputs:&[(PathBuf,String)],scope:&Scope)->Result<Value,String>{
 let check=||if control.request.load(Ordering::SeqCst)!=0{Err("超分已取消 / Upscale cancelled".into())}else{Ok(())};
 owned_tasks::progress(app,id,control,json!({"status":"processing","progress":1,"message":"等待本机超分资源 / Waiting for native upscale slot"}))?;
 loop{check()?;if GPU_BUSY.compare_exchange(false,true,Ordering::Acquire,Ordering::Relaxed).is_ok(){break;}std::thread::sleep(Duration::from_millis(40));}
 let slot=GpuSlot;
 let root=crate::app_root_of(app);let assets=crate::upscale_lite::acquire(&root,&check)?;
 let storage=crate::jobs::storage_dir_of(app);let scratch=Scratch::create(&storage.join("tmp"),&format!("upscale-{id}"))?;
 let work=fs::canonicalize(&scratch.0).map_err(|e|e.to_string())?;
 // Even an unconfirmed NCNN exit retains immutable resources, scratch, GPU slot and final-state callback.
 let assets=Arc::new(assets);let resources=Scope::new((scratch,assets.clone(),slot,scope.retain()));
 let mut entries=Vec::new();let mut details=Vec::new();let mut total=0u64;
 for(index,(input,name))in inputs.iter().enumerate(){
  check()?;owned_tasks::progress(app,id,control,json!({"progress":3+85*index/inputs.len(),"message":format!("本机超分 {}/{} / Native upscale {}/{}",index+1,inputs.len(),index+1,inputs.len())}))?;
  let dir=work.join(index.to_string());fs::create_dir(&dir).map_err(|e|e.to_string())?;
  let snapshot=dir.join("input.bin");copy_new(input,&snapshot,128_000_000,&check)?;
  let output=dir.join("output.png");
  let info=crate::upscale_lite::process(&assets,&root.join("furinakit-image-worker.exe"),&snapshot,&output,scale,&dir,&check,&resources)?;
  total+=fs::metadata(&output).map_err(|e|e.to_string())?.len();if total>1_900_000_000{return Err("Batch output exceeds 1.9 GB".into());}
  let stem=crate::ocr_native::safe_stem(name);let filename=format!("{:04}-{stem}_upscaled.png",index+1);
  details.push(info);entries.push((filename,output));
 }
 check()?;
 let(filename,source,mime)=if entries.len()==1{let(n,p)=entries.pop().ok_or("Missing result")?;(n,p,"image/png")}else{let p=work.join("batch.zip");crate::image_artifacts::zip(&entries,&p,&check)?;("upscaled-images.zip".into(),p,"application/zip")};
 let results=storage.join("results");fs::create_dir_all(&results).map_err(|e|e.to_string())?;
 let target=results.join(format!("{id}-{filename}"));let bytes=copy_new(&source,&target,2_000_000_000,&check)?;
 if let Err(e)=check(){let _=fs::remove_file(&target);return Err(e);}
 Ok(json!({"status":"completed","progress":100,"message":"本机超分完成 / Native upscale complete","resultPath":target,"resultFilename":filename,"resultMimeType":mime,"resultBytes":bytes,"engine":"bundled-ncnn-native","imageResults":details,"imageFileCount":inputs.len()}))
}
pub fn start(app:&tauri::AppHandle,args:&Value)->Result<Value,String>{
 let scale=crate::upscale_lite::scale(args)?;
 let inputs:Vec<(PathBuf,String)>=if let Some(files)=args["__files"].as_array(){
  if files.is_empty()||files.len()>50{return Err("请选择1–50张图片 / Select 1–50 images".into());}
  let saved=crate::jobs::save_request_uploads(app,&crate::jobs::new_job_id_public(),files)?;
  saved.iter().map(|v|Ok((PathBuf::from(v["path"].as_str().ok_or("Missing upload")?),v["name"].as_str().unwrap_or("image").to_owned()))).collect::<Result<_,String>>()?
 }else{
  let paths=if let Some(a)=args["files"].as_array(){if a.is_empty()||a.len()>50{return Err("Select 1–50 images".into());}a.iter().map(|v|v.as_str().ok_or("Invalid image path")).collect::<Result<Vec<_>,_>>()?}else{vec![args["file"].as_str().ok_or("Select an image")?]};
  paths.into_iter().map(|p|{let path=PathBuf::from(p);let name=path.file_name().and_then(|s|s.to_str()).unwrap_or("image").to_owned();(path,name)}).collect()
 };
 let mut total=0;for(p,_)in&inputs{let m=fs::metadata(p).map_err(|e|e.to_string())?;if !m.is_file()||m.len()==0||m.len()>128_000_000{return Err("Image empty, missing or over 128 MB".into());}total+=m.len();}if total>512_000_000{return Err("Batch input exceeds 512 MB".into());}
 let lease=crate::api::component_use(app,&["bundled-upscale-lite-v1"])?;
 let payload=json!({"model":format!("anime-x{scale}"),"scale":scale,"files":inputs.iter().map(|(p,_)|p).collect::<Vec<_>>()});
 let job=crate::jobs::create_native_job(app,"image-upscale","image",payload)?;let id=job["id"].as_str().ok_or("Missing job ID")?.to_owned();
 let control=match owned_tasks::reserve(&id,"image"){Ok(c)=>c,Err(e)=>{let _=crate::jobs::update_job(app,&id,json!({"status":"failed","error":e}).as_object().unwrap().clone());return Err(e);}};
 let handle=app.clone();let tid=id.clone();let tc=control.clone();
 let spawned=std::thread::Builder::new().name("native-upscale".into()).spawn(move||{
  let(scope,outcome)=owned_tasks::resource_scope(&handle,&tid,&tc,lease);let result=run(&handle,&tid,&tc,scale,&inputs,&scope);
  let output=result.as_ref().ok().and_then(|v|v["resultPath"].as_str()).map(PathBuf::from);
  owned_tasks::finish_scoped(&handle,&tid,result,scope,outcome);
  if let Some(p)=output{if crate::jobs::read_job_public(&handle,&tid).map(|v|v["status"]!="completed").unwrap_or(true){let _=fs::remove_file(p);}}
 });
 if let Err(e)=spawned{owned_tasks::finish(app,&id,&control,Err(e.to_string()));return Err(e.to_string());}
 Ok(json!({"ok":true,"job":job,"engine":"bundled-ncnn-native"}))
}
