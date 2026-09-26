//! Ordered audio concatenation using private manifests and the existing owned engine.
use std::{fs,io::{Read,Write},path::{Path,PathBuf},time::Duration};
use serde_json::json;
use super::{Batch,Plan,AudioInfo,MAX_OUTPUT,command,argument,probe};
fn concat_line(path:&Path)->Result<String,String>{
 let value=argument(path)?.replace('\\',"/");
 if value.chars().any(char::is_control){return Err("音频路径包含控制字符 / Control characters are not allowed in concat paths".into());}
 Ok(format!("file '{}'\n",value.replace('\'',"'\\''")))
}
pub(super) fn process(ffmpeg:&Path,ffprobe:&Path,inputs:&[(PathBuf,String)],work:&Path,p:&Plan,check:&dyn Fn()->Result<(),String>,progress:&dyn Fn(usize,usize)->Result<(),String>,scope:&crate::task_custody::Scope)->Result<Batch,String>{
 check()?;
 if !(2..=100).contains(&inputs.len()){return Err("请选择2–100个音频文件，按选择顺序合并 / Select 2–100 audio files in order".into());}
 let dir=work.join("merge");fs::create_dir(&dir).map_err(|e|e.to_string())?;
 let mut paths=Vec::new();let mut infos:Vec<AudioInfo>=Vec::new();
 for (index,(input,_)) in inputs.iter().enumerate(){
  check()?;progress(index,inputs.len())?;
  let input=fs::canonicalize(input).map_err(|e|e.to_string())?;
  let m=fs::metadata(&input).map_err(|e|e.to_string())?;
  if !m.is_file()||m.len()==0||m.len()>64*1024*1024*1024{return Err("Invalid or oversized merge input".into());}
  concat_line(&input)?;
  let info=probe(ffprobe,&input,&dir.join(format!("input-{index:03}.json")),check,scope)?;
  if info.channels==0||info.sample_rate==0{return Err("Cannot verify merge input audio geometry".into());}
  paths.push(input);infos.push(info);
 }
 // The concat demuxer is only valid for compatible streams. Normalize heterogeneous
 // clips sequentially to one bounded PCM scratch instead of opening 100 decoders at once.
 let first=&infos[0];
 let mixed=infos.iter().any(|v|v.codec!=first.codec||v.channels!=first.channels||v.sample_rate!=first.sample_rate||v.channel_layout!=first.channel_layout);
 let output=dir.join("merged_audio.mp3");
 let mut args:Vec<String>=vec!["-v".into(),"error".into(),"-nostdin".into(),"-n".into(),"-max_alloc".into(),"268435456".into(),"-threads".into(),"2".into(),"-protocol_whitelist".into(),"file,pipe".into()];
 let scratch;
 if mixed {
  let rate=*[8000u64,11025,12000,16000,22050,24000,32000,44100,48000].iter().min_by_key(|v|v.abs_diff(first.sample_rate)).unwrap();
  let channels=first.channels.min(2);scratch=normalize(ffmpeg,&paths,&dir,rate,channels,check,scope)?;
  args.extend(["-f".into(),"f32le".into(),"-ar".into(),rate.to_string(),"-ac".into(),channels.to_string(),"-i".into(),argument(&scratch)?,"-protocol_whitelist".into(),"file,pipe".into(),"-i".into(),argument(&paths[0])?,"-map_metadata".into(),"1".into()]);
 }else{
  scratch=dir.join("inputs.ffconcat");let mut manifest=crate::image_artifacts::LimitedFile::create(&scratch,1024*1024)?;
  manifest.write_all(b"ffconcat version 1.0\n").map_err(|e|e.to_string())?;
  for path in &paths{check()?;manifest.write_all(concat_line(path)?.as_bytes()).map_err(|e|e.to_string())?;}
  manifest.sync()?;drop(manifest);
  args.extend(["-f".into(),"concat".into(),"-safe".into(),"0".into(),"-i".into(),argument(&scratch)?]);
 }
 args.extend(["-map".into(),"0:a:0".into(),"-vn".into(),"-sn".into(),"-dn".into(),"-c:a".into(),"libmp3lame".into(),"-b:a".into(),"192k".into(),"-threads".into(),"2".into(),"-fs".into(),MAX_OUTPUT.to_string(),argument(&output)?]);
 command(ffmpeg,&args,&dir,Duration::from_secs(7200),Some(&output),check,scope)?;
 let bytes=fs::metadata(&output).map_err(|e|e.to_string())?.len();
 if bytes==0||bytes>=MAX_OUTPUT-1_000_000{return Err("Merge output is empty or reached its byte budget; no truncated output accepted".into());}
 let actual=probe(ffprobe,&output,&dir.join("output.json"),check,scope)?;
 if actual.codec!="mp3"||actual.channels==0||actual.sample_rate==0{return Err("Invalid merged audio stream".into());}
 let got=actual.duration.filter(|v|*v>0.0).ok_or("Cannot verify merged duration")?;
 let expected:Option<f64>=infos.iter().try_fold(0.0,|sum,v|v.duration.map(|d|sum+d));
 if let Some(expected)=expected{if (got-expected).abs()>0.25f64.max(expected*0.01){return Err(format!("合并时长不匹配 / Merged duration mismatch: {expected:.3}s -> {got:.3}s"));}}
 check()?;fs::remove_file(scratch).map_err(|e|e.to_string())?;
 let detail=json!({"success":true,"filename":"merged_audio.mp3","operation":"merge","inputCount":inputs.len(),"normalizedMixedInputs":mixed,"inputNames":inputs.iter().map(|(_,n)|n).collect::<Vec<_>>(),"bytes":bytes,"format":"mp3","codec":"mp3","codecLossless":false,"bitrateRequested":"192k","bitrateApplied":true,"duration":got,"sourceDuration":expected,"sampleRate":actual.sample_rate,"channels":actual.channels,"warning":p.notice,"engine":"rust-ffmpeg-owned"});
 Ok(Batch{entries:vec![("merged_audio.mp3".into(),output)],details:vec![detail],failures:0})
}
fn normalize(ffmpeg:&Path,paths:&[PathBuf],dir:&Path,rate:u64,channels:u64,check:&dyn Fn()->Result<(),String>,scope:&crate::task_custody::Scope)->Result<PathBuf,String>{
 let combined=dir.join("normalized.f32");let mut writer=crate::image_artifacts::LimitedFile::create(&combined,MAX_OUTPUT)?;
 let mut buffer=vec![0u8;65536];
 for (index,path) in paths.iter().enumerate(){
  check()?;let piece=dir.join(format!("piece-{index:03}.f32"));
  let args=vec!["-v".into(),"error".into(),"-nostdin".into(),"-n".into(),"-max_alloc".into(),"268435456".into(),"-threads".into(),"2".into(),"-protocol_whitelist".into(),"file,pipe".into(),"-i".into(),argument(path)?,"-map".into(),"0:a:0".into(),"-vn".into(),"-sn".into(),"-dn".into(),"-ar".into(),rate.to_string(),"-ac".into(),channels.to_string(),"-c:a".into(),"pcm_f32le".into(),"-f".into(),"f32le".into(),"-fs".into(),MAX_OUTPUT.to_string(),argument(&piece)?];
  command(ffmpeg,&args,dir,Duration::from_secs(7200),Some(&piece),check,scope)?;
  let length=fs::metadata(&piece).map_err(|e|e.to_string())?.len();
  if length==0||length>=MAX_OUTPUT-1_000_000||length%(channels*4)!=0{return Err("Mixed merge PCM reached its scratch budget or contains incomplete frames".into());}
  let mut reader=fs::File::open(&piece).map_err(|e|e.to_string())?;
  loop{check()?;let n=reader.read(&mut buffer).map_err(|e|e.to_string())?;if n==0{break;}writer.write_all(&buffer[..n]).map_err(|e|e.to_string())?;}
  drop(reader);fs::remove_file(piece).map_err(|e|e.to_string())?;
 }
 writer.sync()?;drop(writer);check()?;Ok(combined)
}
#[cfg(test)]mod tests{
 use super::*;
 #[test]fn concat_manifest_quotes_paths_without_directive_injection(){assert_eq!(concat_line(Path::new("E:/中文/a'b.wav")).unwrap(),"file 'E:/中文/a'\\''b.wav'\n");assert!(concat_line(Path::new("a\nfile secret")).is_err());assert!(concat_line(Path::new("a\rfile secret")).is_err());}
}
