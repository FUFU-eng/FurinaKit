//! One local video frame through the verified, task-owned optional engine.
use std::{fs,io::Read,path::Path,time::Duration};
use serde_json::{json,Value};
#[derive(Clone,Copy,Debug)]pub(crate) struct Options{pub time:f64,pub width:Option<u32>,pub jpg:bool}
impl Options{
 pub(crate) fn parse(args:&Value)->Result<Self,String>{
  let fmt=match args.get("format"){None|Some(Value::Null)=>"png",Some(v)=>v.as_str().ok_or("Invalid frame format")?}.trim().trim_start_matches('.').to_ascii_lowercase();
  let jpg=match fmt.as_str(){""|"png"=>false,"jpg"|"jpeg"|"jpe"=>true,_=>return Err("仅支持PNG/JPG / Frame format must be PNG or JPG".into())};
  let width=match args.get("width"){
   None|Some(Value::Null)=>None,
   Some(Value::String(s))if s.trim().is_empty()=>None,
   Some(v)=>{let n=match v{Value::Number(n)=>n.as_f64(),Value::String(s)if s.len()<=128=>s.trim().parse::<f64>().ok(),_=>None}.filter(|n|n.is_finite()).ok_or("Invalid frame width")?;
    let n=n.trunc();if !(2.0..=16384.0).contains(&n){return Err("宽度需为2–16384像素 / Width must be 2–16384 pixels".into());}Some(n as u32)}
  };
  Ok(Self{time:super::trim::time(&args["time"])?.unwrap_or(0.0),width,jpg})
 }
 pub(crate) fn format(self)->&'static str{if self.jpg{"jpg"}else{"png"}}
 pub(crate) fn filename(self,name:&str,index:usize,single:bool)->String{let safe=super::output_name(name,index,self.format()).replace('%',"_");let suffix=format!(".{}",self.format());let stem=safe.strip_suffix(&suffix).unwrap_or(&safe);let stem=if single{stem.strip_prefix("001_").unwrap_or(stem)}else{stem};format!("{stem}-frame{}",suffix)}
}
struct Video{index:u64,width:u64,height:u64,codec:String,duration:Option<f64>,swap:bool}
fn probe(program:&Path,input:&Path,output:&Path,check:&dyn Fn()->Result<(),String>,scope:&crate::task_custody::Scope)->Result<Video,String>{
 fs::OpenOptions::new().create_new(true).write(true).open(output).map_err(|e|e.to_string())?;
 let args=vec!["-v".into(),"error".into(),"-protocol_whitelist".into(),"file,pipe".into(),"-show_entries".into(),"stream=index,codec_type,codec_name,width,height,duration:stream_disposition=attached_pic,default:stream_tags=DURATION,rotate:stream_side_data=rotation:format=duration".into(),"-of".into(),"json".into(),"-o".into(),super::argument(output)?,super::argument(input)?];
 super::command(program,&args,output.parent().ok_or("Missing frame probe directory")?,Duration::from_secs(30),None,check,scope)?;
 let mut bytes=Vec::new();fs::File::open(output).map_err(|e|e.to_string())?.take(65537).read_to_end(&mut bytes).map_err(|e|e.to_string())?;if bytes.len()>65536{return Err("Frame probe exceeds 64 KiB".into());}
 let value:Value=serde_json::from_slice(&bytes).map_err(|e|e.to_string())?;
 let video=value["streams"].as_array().ok_or("Missing streams")?.iter().rev().filter(|s|s["codec_type"]=="video"&&s["disposition"]["attached_pic"].as_u64().unwrap_or(0)==0)
  .max_by_key(|s|(s["disposition"]["default"].as_u64().unwrap_or(0),s["width"].as_u64().unwrap_or(0).saturating_mul(s["height"].as_u64().unwrap_or(0))))
  .ok_or("文件没有视频画面（嵌入封面不算视频） / No video picture; attached cover art is not video")?;
 let width=video["width"].as_u64().unwrap_or(0);let height=video["height"].as_u64().unwrap_or(0);if width==0||height==0{return Err("Invalid video dimensions".into());}
 Ok(Video{swap:super::budget::swaps_axes(video),index:video["index"].as_u64().ok_or("Missing video stream index")?,width,height,codec:video["codec_name"].as_str().unwrap_or("").into(),duration:super::numeric(&value["format"]["duration"]).or_else(||super::numeric(&video["duration"])).or_else(||super::timestamp(&video["tags"]["DURATION"]))})
}
pub(crate) fn run(ffmpeg:&Path,ffprobe:&Path,input:&Path,output:&Path,opt:Options,check:&dyn Fn()->Result<(),String>,scope:&crate::task_custody::Scope)->Result<Value,String>{
 check()?;if fs::symlink_metadata(output).is_ok(){return Err("Refusing to overwrite an existing frame".into());}
 let m=fs::metadata(input).map_err(|e|e.to_string())?;if !m.is_file()||m.len()==0||m.len()>64*1024*1024*1024{return Err("Invalid or oversized frame input".into());}
 let dir=output.parent().ok_or("Missing frame directory")?;let source=probe(ffprobe,input,&dir.join("frame-input.json"),check,scope)?;
 if source.duration.filter(|d|*d>0.0).map(|d|opt.time>d).unwrap_or(false){return Err("截图时间超出视频长度 / Requested frame exceeds video duration".into());}
 let mut attempts=vec![opt.time];if let Some(duration)=source.duration.filter(|d|*d>0.0){let near_end=opt.time.min((duration-0.2).max(0.0));if (near_end-opt.time).abs()>1e-6{attempts.push(near_end);}}
 let mut last="No frame generated".to_string();
 for (index,time) in attempts.into_iter().enumerate(){
  check()?;let budget=super::budget::frame(source.width,source.height,opt.width,source.swap)?;let mut args:Vec<String>=vec!["-v".into(),"error".into(),"-nostdin".into(),"-n".into(),"-max_alloc".into(),budget.allocation.to_string(),"-threads".into(),"2".into(),"-protocol_whitelist".into(),"file,pipe".into(),"-ss".into(),format!("{time:.3}"),"-i".into(),super::argument(input)?,"-map".into(),format!("0:{}",source.index),"-frames:v".into(),"1".into(),"-an".into(),"-sn".into(),"-dn".into()];
  if let Some(width)=opt.width{args.extend(["-vf".into(),format!("scale={width}:-2:flags=lanczos")]);}if opt.jpg{args.extend(["-q:v".into(),"2".into(),"-huffman".into(),"default".into()]);}
  args.extend(["-threads".into(),"2".into(),"-fs".into(),super::MAX_OUTPUT.to_string(),super::argument(output)?]);
  let result=super::command_budget(ffmpeg,&args,dir,Duration::from_secs(900),Some(output),check,scope,budget.memory).and_then(|_|{
   let bytes=fs::metadata(output).map_err(|e|e.to_string())?.len();if bytes<=64||bytes>=super::MAX_OUTPUT-1_000_000{return Err("Invalid frame output or byte budget reached".into());}
   let mut head=[0u8;8];fs::File::open(output).map_err(|e|e.to_string())?.read_exact(&mut head).map_err(|e|e.to_string())?;
   if (opt.jpg&&!head.starts_with(&[255,216,255]))||(!opt.jpg&&head!=[137,80,78,71,13,10,26,10]){return Err("Frame signature does not match requested format".into());}
   let actual=probe(ffprobe,output,&dir.join(format!("frame-output-{index}.json")),check,scope)?;
   if actual.codec!=if opt.jpg{"mjpeg"}else{"png"}||opt.width.map(|w|actual.width!=w as u64).unwrap_or(false){return Err("Frame codec or width verification failed".into());}Ok((bytes,actual))
  });
  match result{
   Ok((bytes,actual))=>{check()?;let mut warning=if (time-opt.time).abs()>1e-6{format!("片尾无画面，已从{:.3}秒退到{time:.3}秒抽帧。 / No frame at requested end; used {time:.3}s instead.",opt.time)}else{format!("已抽取第{time:.3}秒画面。 / Frame extracted at {time:.3}s.")};if opt.jpg{warning.push_str(" JPG使用标准Huffman表以减少编码内存；量化质量仍为q2，文件大小可能增加。 / JPEG uses standard Huffman tables to reduce encoder memory; q2 quantization is unchanged, file size may increase.");}return Ok(json!({"bytes":bytes,"format":opt.format(),"operation":"frame-extract","time":time,"requestedTime":opt.time,"usedEndFallback":index>0,"width":actual.width,"height":actual.height,"codec":actual.codec,"warning":warning,"engine":"rust-ffmpeg-owned","memoryBudgetBytes":budget.memory,"maxAllocationBytes":budget.allocation}));},
   Err(error)=>{if scope.has_retained_users(){return Err(error);}check()?;last=error;match fs::remove_file(output){Ok(())=>(),Err(e)if e.kind()==std::io::ErrorKind::NotFound=>(),Err(e)=>return Err(e.to_string())}}
  }
 }
 Err(last)
}
#[cfg(test)]mod tests{use super::*;
 #[test]fn formats_width_time_and_safe_names(){let o=Options::parse(&json!({"format":"JPEG","time":"00:01,5","width":"320.9"})).unwrap();assert_eq!(o.format(),"jpg");assert_eq!(o.width,Some(320));assert_eq!(o.time,1.5);assert_eq!(o.filename("中文.mp4",0,true),"中文-frame.jpg");for v in [json!(true),json!("NaN"),json!("1"),json!(16385),json!("320,evil")]{assert!(Options::parse(&json!({"width":v})).is_err());}assert!(Options::parse(&json!({"format":"../png"})).is_err());assert!(Options::parse(&json!({"time":-1})).is_err());assert_eq!(Options::parse(&json!({})).unwrap().width,None);}
}
