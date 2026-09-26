//! Local notes and owned attachment copies, shared by embedded and independent views.
use rusqlite::{Connection,params,OptionalExtension};
use serde_json::{json,Value};
use std::{fs,path::{Path,PathBuf},time::{SystemTime,UNIX_EPOCH}};
use tauri::Emitter;
fn error(e:impl std::fmt::Display)->String{e.to_string()}
fn now()->i64{SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as i64}
fn root(app:&tauri::AppHandle)->PathBuf{crate::jobs::storage_dir(app).join("notes")}
fn db(app:&tauri::AppHandle)->Result<Connection,String>{
    let root=root(app);fs::create_dir_all(&root).map_err(error)?;
    let db=Connection::open(root.join("notes.sqlite3")).map_err(error)?;db.busy_timeout(std::time::Duration::from_secs(5)).map_err(error)?;
    db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON;
    CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY,title TEXT NOT NULL,body TEXT NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL,revision INTEGER NOT NULL DEFAULT 1,pinned INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS note_layout(note_id TEXT PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,group_name TEXT NOT NULL DEFAULT '',position INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,name TEXT NOT NULL,path TEXT NOT NULL,size INTEGER NOT NULL,mime TEXT NOT NULL);").map_err(error)?;Ok(db)
}
fn id(args:&Value,key:&str)->Result<String,String>{let id=args[key].as_str().unwrap_or("");if !crate::jobs::is_valid_job_id(id){return Err("无效便签或附件编号".into());}Ok(id.into())}
fn detail(db:&Connection,id:&str)->Result<Value,String>{
    let mut note=db.query_row("SELECT id,title,body,created,updated,revision,pinned FROM notes WHERE id=?",[id],|r|Ok(json!({"id":r.get::<_,String>(0)?,"title":r.get::<_,String>(1)?,"body":r.get::<_,String>(2)?,"created":r.get::<_,i64>(3)?,"updated":r.get::<_,i64>(4)?,"revision":r.get::<_,i64>(5)?,"pinned":r.get::<_,bool>(6)?}))).optional().map_err(error)?.ok_or("便签已不存在")?;
    let mut stmt=db.prepare("SELECT id,name,size,mime FROM assets WHERE note_id=? ORDER BY rowid").map_err(error)?;
    let rows=stmt.query_map([id],|r|Ok(json!({"id":r.get::<_,String>(0)?,"name":r.get::<_,String>(1)?,"size":r.get::<_,i64>(2)?,"mime":r.get::<_,String>(3)?}))).map_err(error)?;
    let layout:Option<(String,i64)>=db.query_row("SELECT group_name,position FROM note_layout WHERE note_id=?",[id],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(error)?;
    note["group"]=json!(layout.as_ref().map(|v|v.0.clone()).unwrap_or_default());note["position"]=json!(layout.map(|v|v.1).unwrap_or(0));
    note["assets"]=json!(rows.collect::<Result<Vec<_>,_>>().map_err(error)?);Ok(note)
}
fn asset(app:&tauri::AppHandle,db:&Connection,id:&str)->Result<(PathBuf,String,String),String>{
    let (path,name,mime):(String,String,String)=db.query_row("SELECT path,name,mime FROM assets WHERE id=?",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(error)?.ok_or("附件已不存在")?;
    let base=fs::canonicalize(root(app).join("assets")).map_err(error)?;
    let path=fs::canonicalize(path).map_err(|_|"附件文件不可用")?;
    if !path.starts_with(&base)||!path.is_file(){return Err("附件位置无效".into());}Ok((path,name,mime))
}
#[tauri::command]
pub async fn notes_command(app:tauri::AppHandle,webview:tauri::Webview,action:String,args:Value)->Result<Value,String>{
    if !["main","utility-notes"].contains(&webview.label()){return Err("此窗口不能访问便签".into());}
    tauri::async_runtime::spawn_blocking(move||dispatch(&app,&action,&args)).await.map_err(error)?
}
fn dispatch(app:&tauri::AppHandle,action:&str,args:&Value)->Result<Value,String>{
    let mut db=db(app)?;
    let result=match action {
        "list"=>{
            let query=args["query"].as_str().unwrap_or("").chars().take(200).collect::<String>();
            let mut stmt=db.prepare("SELECT id,title,substr(body,1,180),created,updated,revision,pinned,(SELECT COUNT(*) FROM assets WHERE note_id=notes.id),COALESCE((SELECT group_name FROM note_layout WHERE note_id=notes.id),''),COALESCE((SELECT position FROM note_layout WHERE note_id=notes.id),0) FROM notes WHERE instr(lower(title||char(10)||body),lower(?))>0 ORDER BY pinned DESC,updated DESC LIMIT 500").map_err(error)?;
            let rows=stmt.query_map([query],|r|Ok(json!({"id":r.get::<_,String>(0)?,"title":r.get::<_,String>(1)?,"body":r.get::<_,String>(2)?,"created":r.get::<_,i64>(3)?,"updated":r.get::<_,i64>(4)?,"revision":r.get::<_,i64>(5)?,"pinned":r.get::<_,bool>(6)?,"attachments":r.get::<_,i64>(7)?,"group":r.get::<_,String>(8)?,"position":r.get::<_,i64>(9)?}))).map_err(error)?;
            Ok(json!({"notes":rows.collect::<Result<Vec<_>,_>>().map_err(error)?}))
        },
        "arrange"=>{
            let note=id(args,"id")?;detail(&db,&note)?;
            let group=args["group"].as_str().unwrap_or("").chars().take(40).collect::<String>();
            let tx=db.transaction().map_err(error)?;
            tx.execute("INSERT INTO note_layout(note_id,group_name,position) VALUES(?,?,0) ON CONFLICT(note_id) DO UPDATE SET group_name=excluded.group_name",params![note,group]).map_err(error)?;
            if let Some(order)=args["order"].as_array(){for (position,key) in order.iter().take(500).enumerate(){let key=key.as_str().ok_or("无效排序")?;if !crate::jobs::is_valid_job_id(key){return Err("无效便签编号".into());}tx.execute("INSERT INTO note_layout(note_id,group_name,position) SELECT id,?,? FROM notes WHERE id=? ON CONFLICT(note_id) DO UPDATE SET position=excluded.position",params!["",position as i64+1,key]).map_err(error)?;}}
            tx.commit().map_err(error)?;Ok(json!({"ok":true}))
        },
        "get"=>detail(&db,&id(args,"id")?),
        "save"=>{
            let title=args["title"].as_str().unwrap_or("").chars().take(200).collect::<String>();let body=args["body"].as_str().unwrap_or("");
            if body.len()>2*1024*1024{return Err("单条便签文字请控制在2 MiB以内；大文档请作为附件保存".into());}
            let pinned=args["pinned"].as_bool().unwrap_or(false);let now=now();
            let id=if args["id"].as_str().unwrap_or("").is_empty(){
                let id=crate::jobs::new_job_id_public();db.execute("INSERT INTO notes(id,title,body,created,updated,pinned) VALUES(?,?,?,?,?,?)",params![id,title,body,now,now,pinned]).map_err(error)?;id
            }else{
                let id=id(args,"id")?;let revision=args["revision"].as_i64().ok_or("缺少便签版本，请重新载入")?;
                if db.execute("UPDATE notes SET title=?,body=?,updated=?,pinned=?,revision=revision+1 WHERE id=? AND revision=?",params![title,body,now,pinned,id,revision]).map_err(error)?!=1{return Err("另一窗口已修改或删除此便签；当前草稿已保留，请复制草稿后重新载入，避免覆盖".into());}id
            };detail(&db,&id)
        },
        "attach"=>{
            let note=id(args,"id")?;detail(&db,&note)?;
            let count:i64=db.query_row("SELECT count(*) FROM assets WHERE note_id=?",[&note],|r|r.get(0)).map_err(error)?;if count>=200{return Err("每条便签最多200个附件".into());}
            let token=args["token"].as_str().ok_or("没有附件上传令牌")?;let asset_id=crate::jobs::new_job_id_public();
            let received=crate::upload_stream::claim(app,token,&asset_id,"attachment")?;
            let source=PathBuf::from(received["path"].as_str().ok_or("附件接收失败")?);
            let name=received["name"].as_str().unwrap_or("附件.bin").to_owned();let size=received["size"].as_u64().unwrap_or(0);
            let dir=root(app).join("assets").join(&note).join(&asset_id);
            let mut committed=false;let result=(||{
                fs::create_dir_all(&dir).map_err(error)?;
                let destination=crate::default_output::copy_to_directory(&source,&dir,&name)?;
                let mime=args["mime"].as_str().unwrap_or("application/octet-stream");
                let tx=db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(error)?;
                let count:i64=tx.query_row("SELECT count(*) FROM assets WHERE note_id=?",[&note],|r|r.get(0)).map_err(error)?;
                if count>=200{return Err("每条便签最多200个附件".into());}
                tx.execute("INSERT INTO assets(id,note_id,name,path,size,mime) VALUES(?,?,?,?,?,?)",params![asset_id,note,name,destination.to_string_lossy(),size as i64,mime]).map_err(error)?;
                tx.execute("UPDATE notes SET updated=? WHERE id=?",params![now(),note]).map_err(error)?;tx.commit().map_err(error)?;committed=true;
                detail(&db,&note)
            })();
            // This is a unique incoming copy obtained by consuming our own token, not an original input.
            let _=fs::remove_file(&source);if result.is_err()&&!committed{let _=fs::remove_dir_all(&dir);}result
        },
        "asset-open"|"asset-save"|"asset-preview"=>{
            let (path,name,_mime)=asset(app,&db,&id(args,"id")?)?;
            if action=="asset-open"{crate::commands::open_path(app.clone(),path.to_string_lossy().into_owned())?;Ok(json!({"ok":true}))}
            else if action=="asset-save"{let path=crate::default_output::save_file(app,&path,&name)?;Ok(json!({"path":path.to_string_lossy()}))}
            else {
                if fs::metadata(&path).map_err(error)?.len()>12*1024*1024{return Err("大图请点击打开查看原文件".into());}
                let dims=image::ImageReader::open(&path).map_err(error)?.with_guessed_format().map_err(error)?.into_dimensions().map_err(error)?;
                if u64::from(dims.0)*u64::from(dims.1)>30_000_000{return Err("大图请点击打开查看".into());}
                let image=image::open(&path).map_err(error)?.thumbnail(800,600);let mut bytes=std::io::Cursor::new(Vec::new());image.write_to(&mut bytes,image::ImageFormat::Png).map_err(error)?;
                Ok(json!({"url":format!("data:image/png;base64,{}",crate::jobs::b64_encode_public(bytes.get_ref()))}))
            }
        },
        "delete"=>{
            let note=id(args,"id")?;let revision=args["revision"].as_i64().ok_or("缺少版本")?;
            if db.execute("DELETE FROM notes WHERE id=? AND revision=?",params![note,revision]).map_err(error)?!=1{return Err("便签已被修改，请刷新后确认删除".into());}
            let dir=root(app).join("assets").join(&note);
            if let (Ok(actual),Ok(base))=(fs::canonicalize(&dir),fs::canonicalize(root(app).join("assets"))){if actual.starts_with(&base){let _=fs::remove_dir_all(actual);}}
            Ok(json!({"ok":true}))
        },
        _=>Err("未知便签操作".into())
    }?;
    if matches!(action,"save"|"attach"|"delete"|"arrange"){let _=app.emit("notes-changed",());}
    Ok(result)
}
