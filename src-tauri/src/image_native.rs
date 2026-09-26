//! Native basic-image jobs. Every supplied file is processed; multi-file results are isolated ZIPs.
use std::{path::{Path,PathBuf},fs,sync::{Mutex,OnceLock,TryLockError,atomic::Ordering},time::Duration};
use serde_json::{json,Value};
use crate::image_artifacts::{Scratch,copy_new};
pub fn enabled(app:&tauri::AppHandle)->bool{crate::runtime_layout::is_native_base(&crate::app_root_of(app))||std::env::var("FURINAKIT_NATIVE_IMAGES").as_deref()==Ok("1")}
pub fn supported(tool:&str)->bool{matches!(tool,"image-format-convert"|"image-compress"|"image-to-jpg"|"image-to-png"|"image-to-ico"|"gif-compress"|"gif-crop")}
fn run(app:&tauri::AppHandle,id:&str,control:&crate::owned_tasks::Control,tool:&str,args:&Value,inputs:&[(PathBuf,String)])->Result<Value,String>{
    let failed=std::cell::Cell::new(false);let check=||{if control.request.load(Ordering::SeqCst)!=0{Err("图片任务已取消 / Image task cancelled".into())}else if failed.get(){Err("无法保存图片任务进度 / Cannot persist image progress".into())}else{Ok(())}};
    let progress=|n:u32,message:&str|{if crate::owned_tasks::progress(app,id,control,json!({"status":"processing","progress":n,"message":message})).is_err(){failed.set(true);}};
    static GATE:OnceLock<Mutex<()>>=OnceLock::new();progress(1,"等待图像处理资源 / Waiting for image processing slot");
    let _lease=loop{check()?;match GATE.get_or_init(||Mutex::new(())).try_lock(){Ok(lock)=>break lock,Err(TryLockError::WouldBlock)=>std::thread::sleep(Duration::from_millis(40)),Err(_)=>return Err("图片资源锁异常 / Image processing lock poisoned".into())}};
    let storage=crate::jobs::storage_dir_of(app);let work=Scratch::create(&storage.join("tmp"),id)?;
    let animated=tool.starts_with("gif-");let ext=if animated{"gif".into()}else{crate::image_basic::extension(tool,args)?};
    let suffix=match tool{"image-compress"|"gif-compress"=>"_compressed","gif-crop"=>"_cropped",_=>""};
    let mut entries=Vec::new();let mut details=Vec::new();let mut total_source=0u64;let mut total_output=0u64;
    for (index,(input,name)) in inputs.iter().enumerate(){
        check()?;progress(3+(index*85/inputs.len()) as u32,&format!("正在处理 {}/{}：{name} / Processing {}/{}",index+1,inputs.len(),index+1,inputs.len()));
        let snapshot=work.0.join(format!("input-{index}.bin"));let original=copy_new(input,&snapshot,128_000_000,&check)?;total_source+=original;if total_source>512_000_000{return Err("批量输入超过 512 MB，请拆分批次 / Batch input exceeds 512 MB".into());}
        let mut stem=crate::ocr_native::safe_stem(name);let head=stem.split('.').next().unwrap_or("").to_ascii_uppercase();if matches!(head.as_str(),"CON"|"PRN"|"AUX"|"NUL")||(head.len()==4&&(head.starts_with("COM")||head.starts_with("LPT"))&&matches!(head.as_bytes()[3],b'1'..=b'9')){stem=format!("image_{stem}");}let base=format!("{stem}{suffix}.{ext}");let filename=if inputs.len()>1{format!("{:04}-{base}",index+1)}else{base};let output=work.0.join(&filename);
        let request=json!({"protocol":1,"tool":tool,"args":args,"input":snapshot,"output":output});
        let worker=crate::app_root_of(app).join("furinakit-image-worker.exe");
        let mut info=crate::image_process::execute(&worker,&request,&check).map_err(|e|format!("第 {} 个文件 {name}：{e} / File {} failed; batch not published",index+1,index+1))?;
        let path=if info["useOriginal"].as_bool()==Some(true){let _=fs::remove_file(&output);snapshot}else{output};
        let bytes=fs::metadata(&path).map_err(|e|e.to_string())?.len();if bytes==0{return Err("编码器未产生有效文件 / Empty image artifact".into());}total_output+=bytes;if total_output>1_900_000_000{return Err("批量结果超过 1.9 GB，请拆分批次 / Batch output too large".into());}
        info["sourceName"]=json!(name);info["filename"]=json!(filename);info["bytesBefore"]=json!(original);info["bytes"]=json!(bytes);details.push(info);entries.push((filename,path));
    }
    check()?;progress(91,"正在整理产物 / Preparing image artifacts");
    let (filename,source,mime)=if entries.len()==1{let (name,path)=entries.pop().ok_or("Missing image output")?;let mime=match ext.as_str(){"jpg"=>"image/jpeg","png"=>"image/png","gif"=>"image/gif","ico"=>"image/x-icon","webp"=>"image/webp","avif"=>"image/avif","tiff"=>"image/tiff",_=>"image/bmp"};(name,path,mime)}
    else{let path=work.0.join("batch.zip");crate::image_artifacts::zip(&entries,&path,&check)?;("batch_result.zip".into(),path,"application/zip")};
    let results=storage.join("results");fs::create_dir_all(&results).map_err(|e|e.to_string())?;let target=results.join(format!("{id}-{filename}"));
    check()?;let bytes=copy_new(&source,&target,2_000_000_000,&check)?;
    if let Err(error)=check(){let _=fs::remove_file(&target);return Err(error);}
    let mut notices=Vec::new();for detail in &details{for key in ["warning","message"]{if let Some(text)=detail[key].as_str().filter(|s|!s.is_empty()){if !notices.iter().any(|n|n==text){notices.push(text.to_owned());}}}}
    let note=notices.iter().take(8).cloned().collect::<Vec<_>>().join("; ");
    Ok(json!({"status":"completed","progress":100,"message":format!("已处理 {} 个文件 / Processed {} files. {note}",inputs.len(),inputs.len()),"resultPath":target.to_string_lossy(),"resultFilename":filename,"resultMimeType":mime,"resultBytes":bytes,"engine":"rust-image-worker","imageFileCount":inputs.len(),"imageResults":details,"sourceBytes":total_source,"encodedBytes":total_output}))
}
pub fn start(app:&tauri::AppHandle,tool:&str,args:&Value)->Result<Value,String>{
    if !supported(tool){return Err("Unsupported native image tool".into());}
    let inputs:Vec<(PathBuf,String)>=if let Some(files)=args.get("__files").and_then(Value::as_array){
        if files.is_empty()||files.len()>100{return Err("每批需要 1–100 个文件 / Select 1–100 files per batch".into());}
        let saved=crate::jobs::save_request_uploads(app,&crate::jobs::new_job_id_public(),files)?;
        saved.iter().map(|v|Ok((PathBuf::from(v["path"].as_str().ok_or("Missing image upload path")?),v["name"].as_str().unwrap_or("image").to_owned()))).collect::<Result<_,String>>()?
    }else{
        let paths=if let Some(files)=args.get("files").and_then(Value::as_array){if files.len()>100{return Err("Too many image files".into());}files.iter().map(|v|v.as_str().map(str::to_owned).ok_or("Invalid image path".to_string())).collect::<Result<Vec<_>,_>>()?}
        else{vec![args.get("file").or_else(||args.get("path")).and_then(Value::as_str).ok_or("请选择图片 / Select images")?.to_owned()]};
        paths.into_iter().map(|p|{let path=PathBuf::from(p);let name=path.file_name().and_then(|s|s.to_str()).unwrap_or("image").to_owned();(path,name)}).collect()
    };
    if inputs.is_empty(){return Err("请选择图片 / Select images".into());}
    let mut total=0u64;for (path,_) in &inputs{let m=fs::metadata(path).map_err(|e|e.to_string())?;if !m.is_file()||m.len()==0||m.len()>128_000_000{return Err("图片为空、不存在或超过 128 MB / Image missing, empty or over 128 MB".into());}total+=m.len();}if total>512_000_000{return Err("批量输入超过 512 MB / Batch input exceeds 512 MB".into());}
    let mut payload=Value::Object(args.as_object().ok_or("Invalid image parameters")?.iter().filter(|(k,_)|!matches!(k.as_str(),"__files"|"__path"|"__method")).map(|(k,v)|(k.clone(),v.clone())).collect());let object=payload.as_object_mut().ok_or("Invalid image parameters")?;object.remove("__files");object.remove("__path");object.remove("__method");object.insert("files".into(),json!(inputs.iter().map(|(p,_)|p.to_string_lossy().into_owned()).collect::<Vec<_>>()));
    if !tool.starts_with("gif-"){let _=crate::image_basic::extension(tool,&payload)?;if tool=="image-to-ico"{let _=crate::image_basic::sizes(&payload)?;}}
    let job=crate::jobs::create_native_job(app,tool,"image",payload.clone())?;let id=job["id"].as_str().ok_or("Missing image job ID")?.to_owned();
    let control=match crate::owned_tasks::reserve(&id,"image"){Ok(c)=>c,Err(error)=>{let _=crate::jobs::update_job(app,&id,json!({"status":"failed","message":"图片处理繁忙 / Image processing busy","error":error}).as_object().unwrap().clone());return Err(error);}};
    let handle=app.clone();let tid=id.clone();let tc=control.clone();let tool=tool.to_owned();
    let spawned=std::thread::Builder::new().name("native-images".into()).spawn(move||{
        let result=run(&handle,&tid,&tc,&tool,&payload,&inputs); // Codec faults are isolated by Job Object, not catch_unwind.
        let output=result.as_ref().ok().and_then(|r|r["resultPath"].as_str()).map(PathBuf::from);
        crate::owned_tasks::finish(&handle,&tid,&tc,result);
        if let Some(path)=output{if crate::jobs::read_job_public(&handle,&tid).map(|j|j["status"]!="completed").unwrap_or(true){let _=fs::remove_file(path);}}
    });
    if let Err(error)=spawned{crate::owned_tasks::finish(app,&id,&control,Err(error.to_string()));return Err(error.to_string());}
    Ok(json!({"ok":true,"job":crate::jobs::read_job_public(app,&id).unwrap_or(job),"engine":"rust-image-worker"}))
}
