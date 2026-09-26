//! Native audio trimming: preserve source extension, stream-copy with explicit fallback.
use std::{fs,path::Path,time::Duration};
use serde_json::{json,Value};
#[derive(Clone,Copy,Debug)]pub(crate) struct Options{pub start:f64,pub end:Option<f64>,pub precise:bool}
pub(crate) fn time(value:&Value)->Result<Option<f64>,String>{
 let invalid=||"时间格式不正确，请用秒数、MM:SS或HH:MM:SS / Invalid time; use seconds, MM:SS or HH:MM:SS".to_string();
 if value.is_null(){return Ok(None);}
 if let Some(n)=value.as_f64(){return if n.is_finite()&&n>=0.0{Ok(Some(n))}else{Err(invalid())};}
 let raw=value.as_str().ok_or_else(invalid)?.trim();if raw.is_empty(){return Ok(None);}
 if raw.len()>128{return Err(invalid());}
 let raw=raw.replace(',',".");let parts:Vec<_>=raw.split(':').collect();if parts.len()>3{return Err(invalid());}
 let mut total=0.0;
 for(i,part)in parts.iter().enumerate(){
  let last=i+1==parts.len();let pieces:Vec<_>=part.split('.').collect();
  if pieces.len()>2||(!last&&pieces.len()!=1)||pieces.iter().any(|s|s.is_empty()||!s.bytes().all(|c|c.is_ascii_digit())){return Err(invalid());}
  if parts.len()>1&&((i==0&&pieces[0].len()>3)||(i>0&&pieces[0].len()>2)){return Err(invalid());}
  let n=part.parse::<f64>().map_err(|_|invalid())?;if !n.is_finite()||(parts.len()>1&&i>0&&n>=60.0){return Err(invalid());}
  total=total*60.0+n;
 }
 if !total.is_finite(){return Err(invalid());}Ok(Some(total))
}
impl Options{
 pub(crate) fn parse(args:&Value)->Result<Self,String>{
  let start=time(&args["start"])?.unwrap_or(0.0);let end=time(&args["end"])?;
  if end.map(|e|e<=start).unwrap_or(false){return Err("结束时间必须晚于开始时间 / End must be after start".into());}
  let mode=match args.get("mode"){None|Some(Value::Null)=>"",Some(v)=>v.as_str().ok_or("Invalid trim mode")?}.trim();
  if mode.len()>32{return Err("Trim mode is too long".into());}
  let mode=mode.to_lowercase();
  let precise=match mode.as_str(){""|"fast"|"copy"|"quick"|"stream"|"快速"|"流复制"=>false,"precise"|"accurate"|"accurate-cut"|"reencode"|"re-encode"|"精确"|"重编码"=>true,_=>return Err("只支持快速流复制或精确重编码 / Unsupported trim mode".into())};
  Ok(Self{start,end,precise})
 }
 fn range(self,duration:Option<f64>)->Result<(Option<f64>,bool),String>{
  let known=duration.filter(|v|v.is_finite()&&*v>0.0);
  if known.map(|d|self.start>=d-0.01).unwrap_or(false){return Err("开始时间超出音频长度 / Trim start exceeds audio duration".into());}
  let clamped=match(self.end,known){(Some(e),Some(d))=>e>d,_=>false};
  let end=match(self.end,known){(Some(e),Some(d))=>Some(e.min(d)),(e,_)=>e};
  Ok((end.map(|e|(e-self.start).max(0.05)),clamped))
 }
}
pub(crate) fn output_name(name:&str,index:usize,single:bool)->Result<String,String>{
 let ext=Path::new(name).extension().and_then(|v|v.to_str()).filter(|s|!s.is_empty()).unwrap_or("mp3").to_ascii_lowercase();
 if ext.len()>16||!ext.bytes().all(|c|c.is_ascii_alphanumeric()){return Err("Unsupported audio filename extension".into());}
 let safe=super::output_name(name,index,&ext);let tail=format!(".{ext}");let stem=safe.strip_suffix(&tail).unwrap_or(&safe);let stem=if single{stem.strip_prefix("001_").unwrap_or(stem)}else{stem};Ok(format!("{stem}-trimmed.{ext}"))
}
fn encoder(ext:&str)->Vec<String>{
 let args:&[&str]=match ext{
  "mp3"=>&["-c:a","libmp3lame","-b:a","192k"],"wav"=>&["-c:a","pcm_s16le"],"m4a"|"mp4"|"aac"=>&["-c:a","aac","-b:a","192k"],"flac"=>&["-c:a","flac"],"ogg"|"oga"=>&["-c:a","libvorbis","-b:a","192k"],"opus"|"webm"=>&["-c:a","libopus","-b:a","128k"],"wma"=>&["-c:a","wmav2","-b:a","192k"],"aif"|"aiff"=>&["-c:a","pcm_s16be"],"amr"=>&["-c:a","libopencore_amrnb","-b:a","12.2k","-ar","8000","-ac","1"],_=>&[]};args.iter().map(|s|s.to_string()).collect()
}
fn verify(probe:&Path,output:&Path,json:&Path,expected:Option<f64>,fast:bool,check:&dyn Fn()->Result<(),String>,scope:&crate::task_custody::Scope)->Result<(u64,super::AudioInfo),String>{
 let bytes=fs::metadata(output).map_err(|e|e.to_string())?.len();if bytes<=64||bytes>=super::MAX_OUTPUT-1_000_000{return Err("裁剪产物无效或触及预算 / Invalid trim output or byte budget reached".into());}
 let info=super::probe(probe,output,json,check,scope)?;let got=info.duration.filter(|v|*v>if fast{0.05}else{0.0}).ok_or("Trim output has no valid duration")?;
 if info.channels==0||info.sample_rate==0||info.codec.is_empty(){return Err("Trim output has no valid audio stream".into());}
 if let Some(want)=expected{let tolerance=if fast{1.0f64.max(want*0.25)}else{0.15f64.max(want*0.01)};if (got-want).abs()>tolerance{return Err(format!("裁剪时长不匹配 / Trim duration mismatch: {want:.3}s -> {got:.3}s"));}}
 Ok((bytes,info))
}
pub(crate) fn run(ffmpeg:&Path,ffprobe:&Path,input:&Path,output:&Path,opt:Options,check:&dyn Fn()->Result<(),String>,scope:&crate::task_custody::Scope)->Result<Value,String>{
 check()?;if fs::symlink_metadata(output).is_ok(){return Err("Refusing to overwrite existing trim output".into());}
 let meta=fs::metadata(input).map_err(|e|e.to_string())?;if !meta.is_file()||meta.len()==0||meta.len()>64*1024*1024*1024{return Err("Invalid or oversized trim input".into());}
 let dir=output.parent().ok_or("Missing trim output directory")?;let source=super::probe(ffprobe,input,&dir.join("trim-input.json"),check,scope)?;
 let (length,clamped)=opt.range(source.duration)?;let expected=length.or_else(||source.duration.map(|d|d-opt.start));
 let ext=output.extension().and_then(|s|s.to_str()).unwrap_or("mp3");let mut precise=opt.precise;let mut fallback=None;
 loop{
  check()?;let mut args:Vec<String>=vec!["-v".into(),"error".into(),"-nostdin".into(),"-n".into(),"-max_alloc".into(),"268435456".into(),"-threads".into(),"2".into(),"-protocol_whitelist".into(),"file,pipe".into(),"-ss".into(),format!("{:.3}",opt.start)];
  if let Some(length)=length{args.extend(["-t".into(),format!("{length:.3}")]);}
  args.extend(["-i".into(),super::argument(input)?,"-map".into(),"0:a:0".into(),"-vn".into(),"-sn".into(),"-dn".into()]);
  if precise{args.extend(encoder(ext));}else{args.extend(["-c".into(),"copy".into(),"-avoid_negative_ts".into(),"make_zero".into()]);}
  args.extend(["-threads".into(),"2".into(),"-fs".into(),super::MAX_OUTPUT.to_string(),super::argument(output)?]);
  let result=super::command(ffmpeg,&args,dir,Duration::from_secs(900),Some(output),check,scope).and_then(|_|verify(ffprobe,output,&dir.join(if precise{"trim-precise.json"}else{"trim-copy.json"}),expected,!precise,check,scope));
  match result{
   Ok((bytes,info))=>{
    let mut warning=if precise{format!("精确裁剪，按.{ext}重编码；有损编码会产生代际损失。 / Precise trim re-encodes; lossy codecs introduce generation loss.")}else{"快速裁剪，流复制切点对齐音频帧。 / Fast trim copies audio packets; cuts align to audio frames.".to_string()};
    if precise&&matches!(ext,"wav"|"aiff"|"aif"){warning.push_str(" WAV/AIFF采用16位PCM，高位深或浮点源会量化。 / WAV/AIFF use 16-bit PCM; higher-depth or float sources are quantized.");}
    if clamped{warning.push_str(" 结束时间已裁到源文件结尾。 / End clamped to source duration.");}
    if fallback.is_some(){warning.push_str(" 流复制失败或结果异常，已自动改用重编码。 / Stream copy failed validation; re-encoded instead.");}
    check()?;return Ok(json!({"bytes":bytes,"format":ext,"codecLossless":info.codec=="flac"||info.codec.starts_with("pcm_"),"codec":info.codec,"duration":info.duration,"sourceDuration":source.duration,"sampleRate":info.sample_rate,"channels":info.channels,"mode":if precise{"precise"}else{"fast"},"streamCopied":!precise,"endClamped":clamped,"fallbackReason":fallback,"warning":warning,"operation":"trim","engine":"rust-ffmpeg-owned"}));
   },
   Err(error)=>{
    if scope.has_retained_users(){return Err(error);}check()?;
    if precise{return Err(error);}
    match fs::remove_file(output){Ok(())=>(),Err(e)if e.kind()==std::io::ErrorKind::NotFound=>(),Err(e)=>return Err(e.to_string())}
    fallback=Some(error);precise=true;
   }
  }
 }
}
#[cfg(test)]mod tests{
 use super::*;
 #[test]fn time_formats_and_invalid_values(){for(v,want)in[(json!(12.5),12.5),(json!("00:12,5"),12.5),(json!("001:02:03.25"),3723.25),(json!("999:59"),59999.0)]{assert_eq!(time(&v).unwrap(),Some(want));}for v in[json!(true),json!(-1),json!("-1"),json!("1e3"),json!("NaN"),json!("00:60"),json!("1000:00"),json!("1:"),json!("1.2:03"),json!("0;amovie=x"),json!({})]{assert!(time(&v).is_err(),"{v}");}assert_eq!(time(&json!(" ")).unwrap(),None);assert!(time(&json!("0".repeat(129))).is_err());assert!(Options::parse(&json!({"mode":"x".repeat(33)})).is_err());}
 #[test]fn range_modes_clamping_and_names(){let o=Options::parse(&json!({"start":"00:01","end":"99","mode":"流复制"})).unwrap();assert!(!o.precise);assert_eq!(o.range(Some(3.0)).unwrap(),(Some(2.0),true));assert!(o.range(Some(1.0)).is_err());assert!(Options::parse(&json!({"start":3,"end":2})).is_err());assert!(Options::parse(&json!({"mode":"unsafe"})).is_err());assert_eq!(output_name("中文.MP3",0,true).unwrap(),"中文-trimmed.mp3");assert_eq!(output_name("a.aiff",2,false).unwrap(),"003_a-trimmed.aiff");assert!(encoder("caf").is_empty());}
}
