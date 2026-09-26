//! Native PDF OCR job, using OS rasterization and the shared pinned OCR sessions.
use std::{fs,path::{Path,PathBuf},io::{Read,Write},sync::{Mutex,OnceLock,TryLockError,atomic::Ordering},time::Duration};
use serde_json::{json,Value};
struct Workspace(PathBuf);
impl Drop for Workspace{fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}
struct Outputs{paths:Vec<PathBuf>,keep:bool}
impl Drop for Outputs{fn drop(&mut self){if !self.keep{for path in &self.paths{let _=fs::remove_file(path);}}}}
fn copy_new(source:&Path,target:&Path,limit:u64,check:&dyn Fn()->Result<(),String>)->Result<(),String>{
    let mut src=fs::File::open(source).map_err(|e|e.to_string())?;
    let mut dst=fs::OpenOptions::new().write(true).create_new(true).open(target).map_err(|e|e.to_string())?;
    let mut bytes=0u64;let mut buffer=vec![0;1024*1024];
    let result=(||{loop{check()?;let n=src.read(&mut buffer).map_err(|e|e.to_string())?;if n==0{break;}bytes+=n as u64;if bytes>limit{return Err("PDF 文件超出处理大小限制 / PDF exceeds processing size limit".into());}dst.write_all(&buffer[..n]).map_err(|e|e.to_string())?;}dst.sync_all().map_err(|e|e.to_string())})();
    drop(dst);if result.is_err(){let _=fs::remove_file(target);}result
}
fn run(app:&tauri::AppHandle,id:&str,control:&crate::owned_tasks::Control,input:&Path,name:&str,dpi:u32,strict:bool,export:bool)->Result<Value,String>{
    let failed=std::cell::Cell::new(false);
    let check=||{if control.request.load(Ordering::SeqCst)!=0{Err("已取消 PDF OCR / PDF OCR cancelled".into())}else if failed.get(){Err("无法保存任务进度 / Cannot persist task progress".into())}else{Ok(())}};
    let progress=|value:u32,message:&str|{if crate::owned_tasks::progress(app,id,control,json!({"status":"processing","progress":value,"message":message})).is_err(){failed.set(true);}};
    static GATE:OnceLock<Mutex<()>>=OnceLock::new();progress(1,"等待 PDF OCR 资源 / Waiting for PDF OCR slot");
    let _lease=loop{check()?;match GATE.get_or_init(||Mutex::new(())).try_lock(){Ok(lock)=>break lock,Err(TryLockError::WouldBlock)=>std::thread::sleep(Duration::from_millis(40)),Err(_)=>return Err("PDF OCR 资源锁异常 / PDF OCR lock poisoned".into())}};
    let storage=crate::jobs::storage_dir_of(app);let parent=storage.join("tmp");fs::create_dir_all(&parent).map_err(|e|e.to_string())?;
    let work=parent.join(format!("native-pdf-ocr-{id}"));fs::create_dir(&work).map_err(|e|format!("无法创建独立临时目录 / Cannot create private workspace: {e}"))?;let _workspace=Workspace(work.clone());
    let snapshot=work.join("source.pdf");copy_new(input,&snapshot,256_000_000,&check)?;check()?;
    let mut layer=crate::pdf_ocr_layer::Layer::load(&snapshot)?;check()?;
    let renderer=crate::pdf_render::Renderer::open(&snapshot)?;
    let count=layer.count();if renderer.count()? as usize!=count{return Err("PDF 页面计数不一致 / PDF parser and renderer disagree on page count".into());}
    let models=crate::app_root_of(app).join("models/ocr-v3");let page_image=work.join("page.png");
    let mut texts=Vec::new();let mut text_bytes=0usize;let mut lines=0usize;let mut chars=0usize;let mut low=0u64;let mut scores=Vec::new();let mut providers=std::collections::BTreeSet::new();
    for page in 0..count{
        check()?;progress(3+(page*91/count) as u32,&format!("正在处理第 {}/{} 页 / Processing page {}/{}",page+1,count,page+1,count));
        let (w,h,ratio)=renderer.render(page as u32,dpi,&page_image,&check)?;check()?;
        let update=|value:u32,message:&str|progress(3+((page as f64+value.min(100) as f64/100.0)*91.0/count as f64) as u32,&format!("{}/{} · {message}",page+1,count));
        let result=crate::ocr_engine::recognize(&models,&page_image,if strict{0.65}else{0.5},&check,&update)?;check()?;
        let recognized=result["lines"].as_array().ok_or("Missing OCR lines")?;
        layer.append(page,w,h,ratio,recognized)?;lines+=recognized.len();
        let text=result["text"].as_str().unwrap_or("");chars+=text.chars().filter(|c|*c!='\n').count();text_bytes+=text.len();
        if text_bytes>32_000_000{return Err("OCR 文本超出大小限制，请拆分 PDF / OCR text too large; split the PDF".into());}
        if export{texts.push(text.to_owned());}
        low+=result["lowConfidence"].as_u64().unwrap_or(0);let score=result["averageScore"].as_f64().unwrap_or(0.0);if score>0.0{scores.push(score);}
        if let Some(provider)=result["provider"].as_str(){providers.insert(provider.to_owned());}
    }
    check()?;progress(96,"正在写入可搜索文字层 / Saving searchable text layer");
    let staged=work.join("searchable.pdf");layer.save(&staged)?;check()?;
    let results=storage.join("results");fs::create_dir_all(&results).map_err(|e|e.to_string())?;
    let stem=crate::ocr_native::safe_stem(name);let filename=format!("{stem}_可搜索.pdf");let output=results.join(format!("{id}-{filename}"));
    let mut outputs=Outputs{paths:Vec::new(),keep:false};copy_new(&staged,&output,512_000_000,&check)?;outputs.paths.push(output.clone());
    let text_name=if export{Some(format!("{stem}_文字.txt"))}else{None};let mut text_output=None;
    if let Some(name)=&text_name{let path=results.join(format!("{id}-{name}"));let text_file=work.join("text.txt");let mut text=texts.join("\n\n");if text.is_empty(){text.push('\n');}crate::atomic_store::write(&text_file,text.as_bytes())?;copy_new(&text_file,&path,33_000_000,&check)?;outputs.paths.push(path.clone());text_output=Some(path.to_string_lossy().into_owned());}
    check()?;let average=if scores.is_empty(){0.0}else{(scores.iter().sum::<f64>()/scores.len() as f64*10000.0).round()/10000.0};
    let bytes=fs::metadata(&output).map_err(|e|e.to_string())?.len();
    let result=json!({"status":"completed","progress":100,"message":format!("已为 {count} 页叠加文字层 · {lines} 行 / Searchable layer added to {count} pages · {lines} lines"),"resultPath":output.to_string_lossy(),"resultFilename":filename,"resultBytes":bytes,"resultMimeType":"application/pdf","textOutput":text_output,"textResultFilename":text_name,"ocrPages":count,"ocrLines":lines,"averageScore":average,"lowConfidence":low,"chars":chars,"engine":"rust-onnx-windows-pdf","ocrProviders":providers});
    outputs.keep=true;Ok(result)
}
pub fn start(app:&tauri::AppHandle,args:&Value)->Result<Value,String>{
    let dpi=args.get("dpi").map(|v|v.as_f64().or_else(||v.as_str().and_then(|s|s.parse::<f64>().ok())).filter(|v|v.is_finite()).ok_or("无效 DPI / Invalid DPI")).transpose()?.unwrap_or(200.0).clamp(96.0,400.0) as u32;
    let strict=args["strictness"].as_str()==Some("strict");let export=args.get("export_text").and_then(Value::as_str).unwrap_or("yes")=="yes";
    let (input,name)=if let Some(files)=args.get("__files").and_then(Value::as_array){
        if files.len()!=1{return Err("每次请选择一个 PDF / Select one PDF per task".into());}
        let upload=crate::jobs::new_job_id_public();let saved=crate::jobs::save_request_uploads(app,&upload,files)?;let file=saved.first().ok_or("No PDF received")?;
        (PathBuf::from(file["path"].as_str().ok_or("Missing PDF upload")?),file["name"].as_str().unwrap_or("document.pdf").to_owned())
    }else{let input=PathBuf::from(args.get("file").or_else(||args.get("path")).and_then(Value::as_str).ok_or("请选择 PDF / Select a PDF")?);let name=input.file_name().and_then(|s|s.to_str()).unwrap_or("document.pdf").to_owned();(input,name)};
    if !input.is_file()||fs::metadata(&input).map_err(|e|e.to_string())?.len()>256_000_000{return Err("PDF 不存在或超过 256 MB；请先拆分 / PDF missing or over 256 MB".into());}
    let job=crate::jobs::create_native_job(app,"ocr-pdf","ocr",json!({"file":input.to_string_lossy(),"dpi":dpi,"strictness":if strict{"strict"}else{"standard"},"export_text":if export{"yes"}else{"no"}}))?;
    let id=job["id"].as_str().ok_or("Missing job ID")?.to_owned();
    let control=match crate::owned_tasks::reserve(&id,"ocr"){Ok(c)=>c,Err(error)=>{let _=crate::jobs::update_job(app,&id,json!({"status":"failed","error":error,"message":"OCR 繁忙 / OCR busy"}).as_object().unwrap().clone());return Err(error);}};
    let handle=app.clone();let tid=id.clone();let tc=control.clone();
    let spawned=std::thread::Builder::new().name("native-pdf-ocr".into()).spawn(move||{
        let result=std::panic::catch_unwind(std::panic::AssertUnwindSafe(||run(&handle,&tid,&tc,&input,&name,dpi,strict,export))).unwrap_or_else(|_|Err("PDF OCR 内核异常 / PDF OCR panicked".into()));
        let paths:Vec<PathBuf>=result.as_ref().ok().map(|r|["resultPath","textOutput"].iter().filter_map(|key|r[*key].as_str().map(PathBuf::from)).collect()).unwrap_or_default();
        crate::owned_tasks::finish(&handle,&tid,&tc,result);
        if crate::jobs::read_job_public(&handle,&tid).map(|j|j["status"]!="completed").unwrap_or(true){for path in paths{let _=fs::remove_file(path);}}
    });
    if let Err(error)=spawned{crate::owned_tasks::finish(app,&id,&control,Err(error.to_string()));return Err(error.to_string());}
    Ok(json!({"ok":true,"job":crate::jobs::read_job_public(app,&id).unwrap_or(job),"engine":"rust-onnx-windows-pdf"}))
}
