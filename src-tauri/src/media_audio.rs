//! Pure native orchestration for real FFmpeg audio encoding. No shell and no Python.
use std::{fs,io::Read,path::{Path,PathBuf},time::{Duration,Instant}};
use serde_json::{json,Value};
use crate::download_process::OwnedProcess;
#[path="media_effects.rs"] pub(crate) mod effects;
use effects::Effect;
#[path="media_join.rs"] mod join;
#[path="media_trim.rs"] pub(crate) mod trim;
#[path="media_frame.rs"] pub(crate) mod frame;
#[path="media_video_trim.rs"] pub(crate) mod video_trim;
#[path="media_budget.rs"] pub(crate) mod budget;
pub const MAX_OUTPUT:u64=2_000_000_000;
pub const MEMORY_LIMIT:usize=512*1024*1024;
#[derive(Clone)]pub struct Plan{pub format:String,pub bitrate:String,pub codec_lossless:bool,pub notice:String,codec:&'static str,encoder:Vec<String>,effect:Effect,trim:Option<trim::Options>,frame:Option<frame::Options>,video_trim:Option<video_trim::Options>}
impl Plan{pub fn is_merge(&self)->bool{self.effect==Effect::Merge}}
pub fn supported(tool:&str)->bool{matches!(tool,"audio-format-convert"|"video-to-audio"|"audio-volume"|"audio-reverse"|"audio-merge"|"audio-trim"|"video-frame-extract"|"video-trim")}
fn text<'a>(args:&'a Value,key:&str,default:&'a str)->Result<&'a str,String>{match args.get(key){None|Some(Value::Null)=>Ok(default),Some(v)=>v.as_str().ok_or_else(||format!("Invalid {key}"))}}
pub fn plan(tool:&str,args:&Value)->Result<Plan,String>{
 if !supported(tool){return Err("Unsupported native audio tool".into());}
 if tool=="video-trim"{return Ok(Plan{format:"video-source".into(),bitrate:"source".into(),codec_lossless:false,notice:"视频裁剪的实际模式和容器见处理结果。 / See actual trim mode and container in results.".into(),codec:"",encoder:vec![],effect:Effect::None,trim:None,frame:None,video_trim:Some(video_trim::Options::parse(args)?)});}
 if tool=="video-frame-extract"{let opt=frame::Options::parse(args)?;return Ok(Plan{format:opt.format().into(),bitrate:"none".into(),codec_lossless:false,notice:"抽帧结果将显示实际取帧时间。 / Result includes the actual frame time.".into(),codec:"",encoder:vec![],effect:Effect::None,trim:None,frame:Some(opt),video_trim:None});}
 if tool=="audio-trim"{return Ok(Plan{format:"source".into(),bitrate:"source".into(),codec_lossless:false,notice:"按源格式裁剪；实际模式与自动回退见各文件结果。 / Trim preserves source container; see per-file mode and fallback notice.".into(),codec:"",encoder:vec![],effect:Effect::None,trim:Some(trim::Options::parse(args)?),frame:None,video_trim:None});}
 let effect=Effect::parse(tool,args)?;
 if effect==Effect::Merge{return Ok(Plan{format:"mp3".into(),bitrate:"192k".into(),codec_lossless:false,notice:"按选择顺序合并为有损MP3；混合格式先逐个归一化。 / Ordered lossy MP3 merge; mixed formats are normalized sequentially.".into(),codec:"mp3",encoder:vec![],effect,trim:None,frame:None,video_trim:None});}
 if effect!=Effect::None {
  // Legacy effect UI exposes no codec setting: keep MP3 and FFmpeg's default bitrate.
  let mut encoder=Vec::new();
  if let Effect::Volume(value)=effect {encoder.extend(["-af".into(),format!("volume={value}")]);}
  encoder.extend(["-c:a".into(),"libmp3lame".into()]);
  let notice=if effect==Effect::Reverse {"MP3为有损输出。倒放使用有界内存和临时磁盘，PCM上限2 GB。 / Lossy MP3 output; bounded-memory reversal uses PCM scratch up to 2 GB."} else {"MP3为有损输出；增大音量可能削波失真。 / Lossy MP3 output; amplification may cause clipping."};
  return Ok(Plan{format:"mp3".into(),bitrate:"auto".into(),codec_lossless:false,notice:notice.into(),codec:"mp3",encoder,effect,trim:None,frame:None,video_trim:None});
 }
 let format=text(args,"format","mp3")?.trim().trim_start_matches('.').to_ascii_lowercase();let bitrate=text(args,"bitrate","192k")?.trim().to_ascii_lowercase();
 if !["128k","192k","256k","320k","lossless"].contains(&bitrate.as_str()){return Err("不支持的比特率 / Unsupported audio bitrate".into());}
 let (encoder,codec)=match format.as_str(){"mp3"=>("libmp3lame","mp3"),"wav"=>("pcm_s16le","pcm_s16le"),"flac"=>("flac","flac"),"aac"|"m4a"=>("aac","aac"),"ogg"=>("libvorbis","vorbis"),"opus"=>("libopus","opus"),"wma" if tool=="audio-format-convert"=>("wmav2","wmav2"),_=>return Err("不支持的输出格式 / Unsupported audio output format".into())};
 let codec_lossless=matches!(format.as_str(),"wav"|"flac");let mut options=vec!["-c:a".into(),encoder.into()];
 let notice=if format=="wav"{"WAV 输出为16位PCM；高位深/浮点输入会量化。 / WAV uses 16-bit PCM; higher-depth/float inputs are quantized.".into()}else if codec_lossless{"FLAC 为无损编码格式，但不能恢复源文件已丢失的信息。 / FLAC is a lossless codec, not recovery of information lost in the source.".into()}else if bitrate=="lossless"{"最高质量仍为有损编码，不是无损。 / Highest-quality mode remains lossy, not lossless.".into()}else{String::new()};
 if !codec_lossless{if bitrate=="lossless"&&matches!(format.as_str(),"mp3"|"ogg"){options.extend(["-q:a".into(),if format=="mp3"{"0"}else{"10"}.into()]);}else{options.extend(["-b:a".into(),if bitrate=="lossless"{"320k".into()}else{bitrate.clone()}]);}}
 if format=="m4a"{options.extend(["-movflags".into(),"+faststart".into()]);}
 Ok(Plan{format,bitrate,codec_lossless,notice,codec,encoder:options,effect,trim:None,frame:None,video_trim:None})
}
pub fn mime(format:&str)->&'static str{match format{"png"=>"image/png","jpg"|"jpeg"=>"image/jpeg","mp3"|"mp2"=>"audio/mpeg","wav"=>"audio/wav","flac"=>"audio/flac","aac"=>"audio/aac","m4a"|"mp4"=>"audio/mp4","ogg"|"oga"=>"audio/ogg","opus"=>"audio/opus","wma"=>"audio/x-ms-wma","aif"|"aiff"=>"audio/aiff","amr"=>"audio/amr","ac3"=>"audio/ac3","webm"=>"audio/webm","caf"=>"audio/x-caf",_=>"application/octet-stream"}}
fn argument(path:&Path)->Result<String,String>{let s=path.to_str().ok_or("Non-Unicode media path")?;if let Some(rest)=s.strip_prefix(r"\\?\UNC\"){Ok(format!(r"\\{rest}"))}else{Ok(s.strip_prefix(r"\\?\").unwrap_or(s).to_owned())}}
pub fn command(program:&Path,args:&[String],cwd:&Path,timeout:Duration,output:Option<&Path>,check:&dyn Fn()->Result<(),String>,scope:&crate::task_custody::Scope)->Result<(),String>{
 command_budget(program,args,cwd,timeout,output,check,scope,MEMORY_LIMIT)
}
pub(crate) fn command_budget(program:&Path,args:&[String],cwd:&Path,timeout:Duration,output:Option<&Path>,check:&dyn Fn()->Result<(),String>,scope:&crate::task_custody::Scope,memory:usize)->Result<(),String>{
 check()?;let child=scope.own(OwnedProcess::spawn_bounded(program,args,cwd,memory)?);let start=Instant::now();
 let outcome=(||->Result<(),String>{
 loop{
  if let Err(e)=check(){child.terminate(Duration::from_secs(5))?;return Err(e);}
  if output.and_then(|p|fs::metadata(p).ok()).map(|m|m.len()>MAX_OUTPUT).unwrap_or(false){child.terminate(Duration::from_secs(5))?;return Err("媒体产物超过2 GB限制 / Media output exceeds 2 GB".into());}
  if let Some(code)=child.try_exit()?{if code==0{check()?;return Ok(());}return Err(format!("音视频引擎退出码 {code}，请检查编码参数或{} MiB内存预算 / Media engine failed; check encoding options or the {} MiB committed-memory budget",memory/(1024*1024),memory/(1024*1024)));}
  if start.elapsed()>timeout{child.terminate(Duration::from_secs(5))?;return Err("音视频处理超时，已停止自有进程 / Media processing timed out; owned process stopped".into());}
  std::thread::sleep(Duration::from_millis(40));
 }
 })();
 child.after_exit(outcome)?
}
#[derive(Debug)]pub struct AudioInfo{pub codec:String,pub duration:Option<f64>,pub channels:u64,pub sample_rate:u64,pub channel_layout:String}
fn numeric(v:&Value)->Option<f64>{v.as_f64().or_else(||v.as_str().and_then(|s|s.parse().ok())).filter(|n|n.is_finite()&&*n>=0.0)}
fn timestamp(v:&Value)->Option<f64>{let parts=v.as_str()?.split(':').map(str::parse::<f64>).collect::<Result<Vec<_>,_>>().ok()?;if parts.len()!=3||parts.iter().any(|n|!n.is_finite()||*n<0.0){return None;}Some(parts[0]*3600.0+parts[1]*60.0+parts[2])}
fn probe(program:&Path,input:&Path,json_path:&Path,check:&dyn Fn()->Result<(),String>,scope:&crate::task_custody::Scope)->Result<AudioInfo,String>{
 fs::OpenOptions::new().create_new(true).write(true).open(json_path).map_err(|e|e.to_string())?;
 let args=vec!["-v".into(),"error".into(),"-protocol_whitelist".into(),"file,pipe".into(),"-show_entries".into(),"stream=codec_type,codec_name,duration,sample_rate,channels,channel_layout:stream_tags=DURATION:format=duration,size".into(),"-of".into(),"json".into(),"-o".into(),argument(json_path)?,argument(input)?];
 command(program,&args,json_path.parent().ok_or("Missing probe directory")?,Duration::from_secs(30),None,check,scope)?;
 let mut data=Vec::new();fs::File::open(json_path).map_err(|e|e.to_string())?.take(65537).read_to_end(&mut data).map_err(|e|e.to_string())?;if data.len()>65536{return Err("Media probe exceeds 64 KiB".into());}
 let v:Value=serde_json::from_slice(&data).map_err(|e|format!("Invalid media probe: {e}"))?;let streams=v["streams"].as_array().ok_or("Media has no streams")?;let audio=streams.iter().find(|s|s["codec_type"]=="audio").ok_or("文件没有音频轨道 / File has no audio stream")?;
 let has_video=streams.iter().any(|s|s["codec_type"]=="video");let duration=numeric(&audio["duration"]).or_else(||timestamp(&audio["tags"]["DURATION"])).or_else(||if has_video{None}else{numeric(&v["format"]["duration"])});
 Ok(AudioInfo{codec:audio["codec_name"].as_str().unwrap_or("").into(),duration,channels:audio["channels"].as_u64().unwrap_or(0),sample_rate:numeric(&audio["sample_rate"]).unwrap_or(0.0)as u64,channel_layout:audio["channel_layout"].as_str().unwrap_or("").to_owned()})
}
pub fn convert(ffmpeg:&Path,ffprobe:&Path,input:&Path,output:&Path,p:&Plan,check:&dyn Fn()->Result<(),String>,scope:&crate::task_custody::Scope)->Result<Value,String>{
 check()?;if p.video_trim.is_some(){return Err("Video trim may change container; use process_batch".into());}if let Some(options)=p.frame{return frame::run(ffmpeg,ffprobe,input,output,options,check,scope);}if let Some(options)=p.trim{return trim::run(ffmpeg,ffprobe,input,output,options,check,scope);}if p.is_merge(){return Err("Merge requires multiple inputs; use process_batch".into());}if fs::symlink_metadata(output).is_ok(){return Err("不会覆盖已有音频文件 / Refusing to overwrite existing audio output".into());}
 let size=fs::metadata(input).map_err(|e|e.to_string())?;if !size.is_file()||size.len()==0||size.len()>64*1024*1024*1024{return Err("输入为空、不是文件或超过64 GiB / Input is empty, not a file or over 64 GiB".into());}
 let cwd=output.parent().ok_or("Missing output directory")?;let source=probe(ffprobe,input,&cwd.join("probe-input.json"),check,scope)?;
 let reverse=if p.effect==Effect::Reverse {Some(effects::prepare_reverse(ffmpeg,input,cwd,&source,check,scope)?)}else{None};
 let mut args:Vec<String>=vec!["-nostdin".into(),"-hide_banner".into(),"-loglevel".into(),"error".into(),"-n".into(),"-max_alloc".into(),"268435456".into(),"-filter_threads".into(),"2".into(),"-threads".into(),"2".into(),"-protocol_whitelist".into(),"file,pipe".into()];
 if let Some((_,raw))=&reverse {
  args.extend(["-f".into(),"f32le".into(),"-ar".into(),source.sample_rate.to_string(),"-ac".into(),source.channels.to_string()]);
  if !source.channel_layout.is_empty(){args.extend(["-channel_layout".into(),source.channel_layout.clone()]);}
  args.extend(["-i".into(),argument(raw)?,"-protocol_whitelist".into(),"file,pipe".into(),"-i".into(),argument(input)?,"-map_metadata".into(),"1".into()]);
 }else{args.extend(["-i".into(),argument(input)?]);}
 args.extend(["-map".into(),"0:a:0".into(),"-vn".into(),"-sn".into(),"-dn".into()]);
 args.extend(p.encoder.iter().cloned());args.extend(["-threads".into(),"2".into(),"-fs".into(),MAX_OUTPUT.to_string(),argument(output)?]);
 command(ffmpeg,&args,cwd,Duration::from_secs(7200),Some(output),check,scope)?;
 if reverse.is_some(){effects::cleanup_reverse(cwd)?;}
 let bytes=fs::metadata(output).map_err(|e|e.to_string())?.len();if bytes==0||bytes>=MAX_OUTPUT-1_000_000{return Err("音频为空或触及输出预算，未作为完整结果保存 / Empty audio or output budget reached; not accepted as complete".into());}
 let actual=probe(ffprobe,output,&cwd.join("probe-output.json"),check,scope)?;
 if actual.codec!=p.codec||actual.channels==0||actual.sample_rate==0{return Err("输出编码/音轨检查失败 / Output codec or audio-stream verification failed".into());}
 if let Some(got)=actual.duration{if got<=0.0{return Err("Output has no audio duration".into());}if let Some(expected)=source.duration{if (got-expected).abs()>0.15f64.max(expected*0.01){return Err(format!("音频时长不匹配 / Audio duration mismatch: {expected:.3}s → {got:.3}s"));}}}else{return Err("无法确认音频产物时长 / Cannot verify output audio duration".into());}
 check()?;Ok(json!({"bytes":bytes,"format":p.format,"codec":actual.codec,"codecLossless":p.codec_lossless,"bitrateRequested":p.bitrate,"bitrateApplied":!p.codec_lossless&&p.bitrate!="lossless"&&p.bitrate!="auto","highestQualityApplied":!p.codec_lossless&&p.bitrate=="lossless","duration":actual.duration,"sourceDuration":source.duration,"sampleRate":actual.sample_rate,"channels":actual.channels,"warning":p.notice,"operation":p.effect.name(),"volumeMultiplier":match p.effect{Effect::Volume(v)=>Some(v),_=>None},"engine":"rust-ffmpeg-owned"}))
}
pub fn output_name(name:&str,index:usize,format:&str)->String{let stem=Path::new(name).file_stem().and_then(|s|s.to_str()).unwrap_or("audio");let cleaned:String=stem.chars().take(80).map(|c|if c.is_control()||"<>:\"/\\|?*".contains(c){'_'}else{c}).collect();let cleaned=cleaned.trim_matches([' ','.']);format!("{:03}_{}.{}",index+1,if cleaned.is_empty(){"audio"}else{cleaned},format)}
#[cfg(test)]mod tests{
 use super::*;
 #[test]fn effect_names_preserve_repeated_extensions_and_safe_batch_collisions(){let p=plan("audio-volume",&json!({})).unwrap();assert_eq!(batch_name("repeat.mp3.mp3.wav",0,&p,true),"repeat.mp3.mp3_volume.mp3");assert_eq!(batch_name("CON.wav",0,&p,true),"CON_volume.mp3");assert_eq!(batch_name("中文.wav",2,&p,false),"003_中文_volume.mp3");let p=plan("audio-reverse",&json!({})).unwrap();assert_eq!(batch_name("song.wav",0,&p,true),"song_reversed.mp3");}
 #[test]fn explicit_format_quality_and_no_fake_lossless(){for f in["mp3","wav","flac","aac","ogg","m4a","wma","opus"]{let p=plan("audio-format-convert",&json!({"format":f,"bitrate":"lossless"})).unwrap();assert_eq!(p.codec_lossless,matches!(f,"wav"|"flac"));if !p.codec_lossless{assert!(p.notice.contains("lossy"));}assert!(!p.encoder.iter().any(|s|s=="lossless"));}assert!(plan("video-to-audio",&json!({"format":"wma"})).is_err());assert!(plan("audio-format-convert",&json!({"format":"../mp3"})).is_err());assert!(plan("audio-format-convert",&json!({"bitrate":"192k -y"})).is_err());}
 #[test]fn safe_names_and_extended_windows_paths(){assert_eq!(output_name("CON.wav",0,"mp3"),"001_CON.mp3");let s=output_name("a\n<bad>.wav",2,"flac");assert!(!s.contains(['\n','<','>']));assert_eq!(argument(Path::new(r"\\?\E:\media\音频.wav")).unwrap(),r"E:\media\音频.wav");assert_eq!(argument(Path::new(r"\\?\UNC\server\share\a.wav")).unwrap(),r"\\server\share\a.wav");}
}
fn batch_name(name:&str,index:usize,p:&Plan,single:bool)->String{
 if p.effect==Effect::None{return output_name(name,index,&p.format);}
 let safe=output_name(name,index,"mp3");let stem=safe.strip_suffix(".mp3").unwrap_or(&safe);
 let stem=if single{stem.strip_prefix("001_").unwrap_or(stem)}else{stem};format!("{stem}{}.mp3",p.effect.suffix())
}
pub struct Batch {pub entries:Vec<(String,PathBuf)>,pub details:Vec<Value>,pub failures:usize}
/// Preserve legacy partial-batch success, while making every failure explicit and names collision-safe.
pub fn process_batch(ffmpeg:&Path,ffprobe:&Path,inputs:&[(PathBuf,String)],work:&Path,p:&Plan,check:&dyn Fn()->Result<(),String>,progress:&dyn Fn(usize,usize)->Result<(),String>,scope:&crate::task_custody::Scope)->Result<Batch,String>{
 if let Some(options)=p.video_trim{return video_trim::process(ffmpeg,ffprobe,inputs,work,options,check,progress,scope);}
 if p.is_merge(){return join::process(ffmpeg,ffprobe,inputs,work,p,check,progress,scope);}
 if inputs.is_empty()||inputs.len()>100{return Err("Select 1–100 media files".into());}
 let mut batch=Batch{entries:Vec::new(),details:Vec::new(),failures:0};let mut total=0u64;
 for(index,(input,name))in inputs.iter().enumerate(){
  check()?;progress(index,inputs.len())?;let directory=work.join(format!("file-{index:03}"));fs::create_dir(&directory).map_err(|e|e.to_string())?;
  let filename=if let Some(frame)=p.frame{frame.filename(name,index,inputs.len()==1)}else if p.trim.is_some(){trim::output_name(name,index,inputs.len()==1)?}else{batch_name(name,index,p,inputs.len()==1)};let output=directory.join(&filename);
  let result=(||{let input=fs::canonicalize(input).map_err(|e|e.to_string())?;let detail=convert(ffmpeg,ffprobe,&input,&output,p,check,scope)?;if total+detail["bytes"].as_u64().unwrap_or(0)>1_950_000_000{return Err("本批音频产物超过1.95 GB预算 / Batch audio outputs exceed 1.95 GB".into());}Ok(detail)})();
  match result{Ok(mut detail)=>{total+=detail["bytes"].as_u64().unwrap_or(0);detail["success"]=json!(true);detail["inputName"]=json!(name);detail["filename"]=json!(filename);batch.details.push(detail);batch.entries.push((filename,output));},Err(error)=>{if scope.has_retained_users(){return Err(error);}if p.effect==Effect::Reverse{effects::cleanup_reverse(&directory)?;}check()?;if inputs.len()==1{return Err(error);}let _=fs::remove_file(&output);batch.failures+=1;batch.details.push(json!({"success":false,"inputName":name,"error":error}));}}
 }
 check()?;if batch.entries.is_empty(){let errors=batch.details.iter().take(3).filter_map(|v|v["error"].as_str()).collect::<Vec<_>>().join("; ");return Err(format!("所有音频文件处理失败 / All media files failed: {errors}"));}Ok(batch)
}
pub fn package_batch(batch:&Batch,input_count:usize,work:&Path,format:&str,check:&dyn Fn()->Result<(),String>)->Result<(String,PathBuf,&'static str),String>{
 check()?;if input_count==1{let(n,p)=batch.entries.first().ok_or("Missing audio output")?;return Ok((n.clone(),p.clone(),if format=="video-source"{video_trim::mime(Path::new(n).extension().and_then(|s|s.to_str()).unwrap_or(""))}else{mime(if format=="source"{Path::new(n).extension().and_then(|s|s.to_str()).unwrap_or("")}else{format})}));}
 use std::io::Write;let report=work.join("conversion-report.json");let bytes=serde_json::to_vec_pretty(&json!({"inputCount":input_count,"successCount":batch.entries.len(),"failedCount":batch.failures,"results":batch.details})).map_err(|e|e.to_string())?;
 let mut file=crate::image_artifacts::LimitedFile::create(&report,1024*1024)?;file.write_all(&bytes).map_err(|e|e.to_string())?;file.sync()?;drop(file);
 let mut entries=batch.entries.clone();entries.push(("conversion-report.json".into(),report));let archive_name=if format=="video-source"{"video-batch.zip"}else{"audio-batch.zip"};let archive=work.join(archive_name);crate::image_artifacts::zip(&entries,&archive,check)?;Ok((archive_name.into(),archive,"application/zip"))
}
