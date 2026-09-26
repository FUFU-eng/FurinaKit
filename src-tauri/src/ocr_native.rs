//! Image OCR task adapter. Keeps screenshot/text/translation consumers on the existing job protocol.
use std::{path::{Path,PathBuf},sync::atomic::Ordering};
use serde_json::{json,Value};

pub fn enabled(_app:&tauri::AppHandle)->bool{
    std::env::var("FURINAKIT_NATIVE_OCR").as_deref()!=Ok("0")
}
pub(crate) fn safe_stem(raw:&str)->String{
    let stem=Path::new(raw).file_stem().and_then(|s|s.to_str()).unwrap_or("image");
    let mut clean:String=stem.chars().take(80).map(|c|if c.is_control()||"<>:\"/\\|?*".contains(c){'_'}else{c}).collect();
    clean=clean.trim_matches(['.',' ']).to_string();if clean.is_empty(){clean="image".into();}clean
}
fn markdown(lines:&[Value])->String{
    let mut groups:Vec<Vec<&Value>>=Vec::new();
    for line in lines{
        if let Some(group)=groups.last_mut(){
            let bottom=group.iter().map(|l|l["box"][3].as_i64().unwrap_or(0)).max().unwrap_or(0);
            let height=(line["box"][3].as_i64().unwrap_or(0)-line["box"][1].as_i64().unwrap_or(0)).max(1) as f64;
            let gap=line["box"][1].as_i64().unwrap_or(0)-bottom;
            let offset=(line["box"][0].as_i64().unwrap_or(0)-group[0]["box"][0].as_i64().unwrap_or(0)).abs();
            if gap as f64<=height*0.8&&offset as f64<=height*0.6{group.push(line);continue;}
        }groups.push(vec![line]);
    }
    groups.iter().map(|g|g.iter().filter_map(|l|l["text"].as_str()).collect::<Vec<_>>().join("\n")).collect::<Vec<_>>().join("\n\n")
}
fn run(app:&tauri::AppHandle,id:&str,control:&crate::owned_tasks::Control,input:&Path,name:&str,format:&str,strict:bool)->Result<Value,String>{
    let failed_progress=std::cell::Cell::new(false);
    let check=||->Result<(),String>{
        if control.request.load(Ordering::SeqCst)!=0{return Err("已取消文字识别 / OCR cancelled".into());}
        if failed_progress.get(){return Err("无法保存 OCR 进度，请检查可用磁盘空间 / Cannot persist OCR progress; check disk space".into());}
        Ok(())
    };
    let progress=|value:u32,message:&str|{
        if crate::owned_tasks::progress(app,id,control,json!({"status":"processing","progress":value,"message":message})).is_err(){failed_progress.set(true);}
    };
    let models=crate::app_root_of(app).join("models/ocr-v3");
    let result=crate::ocr_engine::recognize(&models,input,if strict{0.65}else{0.5},&check,&progress)?;
    check()?;
    let lines=result["lines"].as_array().ok_or("OCR returned no line array")?;
    let text=result["text"].as_str().unwrap_or("");
    let mut content=match format{
        "json"=>serde_json::to_string_pretty(&json!({"text":text,"lines":lines,"averageScore":result["averageScore"]})).map_err(|e|e.to_string())?,
        "md"=>markdown(lines),_=>text.to_owned(),
    };
    // A whitespace-only TXT/MD represents zero detected text while remaining a downloadable artifact.
    if content.is_empty(){content.push('\n');}
    let filename=format!("{}_文字.{format}",safe_stem(name));
    let directory=crate::jobs::storage_dir_of(app).join("results");
    std::fs::create_dir_all(&directory).map_err(|e|e.to_string())?;
    let output=directory.join(format!("{id}-{filename}"));
    if output.exists(){return Err("OCR 输出路径已存在，未覆盖 / OCR output already exists; not overwritten".into());}
    check()?;crate::atomic_store::write(&output,content.as_bytes())?;
    if let Err(error)=check(){let _=std::fs::remove_file(&output);return Err(error);}
    let engine=format!("rust-onnx-{}",result["provider"].as_str().unwrap_or("cpu"));
    Ok(json!({"status":"completed","progress":100,
        "message":format!("识别出 {} 行 · 平均置信度 {} / Recognized {} lines · average confidence {}",lines.len(),result["averageScore"],lines.len(),result["averageScore"]),
        "resultPath":output.to_string_lossy(),"resultFilename":filename,"resultBytes":content.len(),
        "resultMimeType":if format=="json"{"application/json"}else{"text/plain; charset=utf-8"},
        "engine":engine,"ocrLines":lines.len(),"averageScore":result["averageScore"],"lowConfidence":result["lowConfidence"],
        "chars":text.chars().filter(|c|*c!='\n').count()}))
}

pub fn start(app:&tauri::AppHandle,args:&Value)->Result<Value,String>{
    let format=args.get("format").and_then(Value::as_str).unwrap_or("txt");
    let format=if matches!(format,"txt"|"md"|"json"){format}else{"txt"}.to_owned();
    let strict=args.get("strictness").and_then(Value::as_str)==Some("strict");
    let (input,name)=if let Some(files)=args.get("__files").and_then(Value::as_array){
        if files.len()!=1{return Err("图片 OCR 每次需要一张图片 / Image OCR requires one image per task".into());}
        let id=crate::jobs::new_job_id_public();let saved=crate::jobs::save_request_uploads(app,&id,files)?;
        let first=saved.first().ok_or("没有收到图片 / No image received")?;
        (PathBuf::from(first["path"].as_str().ok_or("Missing upload path")?),first["name"].as_str().unwrap_or("image.png").to_owned())
    }else{
        let raw=args.get("file").or_else(||args.get("path")).and_then(Value::as_str).ok_or("没有收到图片 / No image received")?;
        let path=PathBuf::from(raw);let name=path.file_name().and_then(|s|s.to_str()).unwrap_or("image.png").to_owned();(path,name)
    };
    if !input.is_file(){return Err("图片不存在 / Image does not exist".into());}
    let payload=json!({"file":input.to_string_lossy(),"format":format,"strictness":if strict{"strict"}else{"standard"}});
    let job=crate::jobs::create_native_job(app,"ocr-image","ocr",payload)?;
    let id=job["id"].as_str().ok_or("Missing OCR job id")?.to_owned();
    let control=match crate::owned_tasks::reserve(&id,"ocr"){
        Ok(control)=>control,
        Err(error)=>{let _=crate::jobs::update_job(app,&id,json!({"status":"failed","error":error,"message":"OCR 繁忙 / OCR busy"}).as_object().unwrap().clone());return Err(error);}
    };
    let app=app.clone();let response_id=id.clone();
    let thread_app=app.clone();let thread_id=id.clone();let thread_control=control.clone();
    let spawned=std::thread::Builder::new().name("native-ocr".into()).spawn(move||{
        let outcome=std::panic::catch_unwind(std::panic::AssertUnwindSafe(||run(&thread_app,&thread_id,&thread_control,&input,&name,&format,strict)))
            .unwrap_or_else(|_|Err("OCR 内核异常，任务已停止 / OCR engine panicked; task stopped".into()));
        let output=outcome.as_ref().ok().and_then(|r|r["resultPath"].as_str()).map(PathBuf::from);
        crate::owned_tasks::finish(&thread_app,&thread_id,&thread_control,outcome);
        // Only this task's newly generated output is discarded if cancellation won publication.
        if let Some(path)=output{if crate::jobs::read_job_public(&thread_app,&thread_id).map(|j|j["status"]!="completed").unwrap_or(true){let _=std::fs::remove_file(path);}}
    });
    if let Err(error)=spawned{let error=format!("无法启动 OCR 任务 / Could not start OCR task: {error}");crate::owned_tasks::finish(&app,&id,&control,Err(error.clone()));return Err(error);}
    Ok(json!({"ok":true,"job":crate::jobs::read_job_public(&app,&response_id).unwrap_or(job),"engine":"rust-onnx"}))
}
