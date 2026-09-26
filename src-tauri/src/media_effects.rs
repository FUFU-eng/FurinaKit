//! Bounded-memory audio effects. PCM scratch belongs to the caller's retained task scope.
use std::{fs::{self,File,OpenOptions},io::{Read,Write,Seek,SeekFrom,BufWriter},path::{Path,PathBuf},time::Duration};
use serde_json::Value;
#[derive(Clone,Copy,Debug,PartialEq)]
pub(crate) enum Effect { None, Volume(f64), Reverse, Merge }
impl Effect {
    pub(crate) fn parse(tool:&str,args:&Value)->Result<Self,String>{
        match tool {
            "audio-reverse"=>Ok(Self::Reverse),
            "audio-merge"=>Ok(Self::Merge),
            "audio-volume"=>{
                let value=match args.get("volume") {
                    None=>Some(1.0),
                    Some(Value::Number(v))=>v.as_f64(),
                    Some(Value::String(v))=>v.trim().parse::<f64>().ok(),
                    _=>None,
                }.filter(|v|v.is_finite() && (0.1..=5.0).contains(v))
                 .ok_or("音量倍数必须为0.1–5.0的有限数字 / Volume must be a finite number from 0.1 to 5.0")?;
                Ok(Self::Volume(value))
            },
            _=>Ok(Self::None),
        }
    }
    pub(crate) fn name(self)->&'static str {match self {Self::None=>"convert",Self::Volume(_)=>"volume",Self::Reverse=>"reverse",Self::Merge=>"merge"}}
    pub(crate) fn suffix(self)->&'static str {match self {Self::None=>"",Self::Volume(_)=>"_volume",Self::Reverse=>"_reversed",Self::Merge=>"_merged"}}
}
/// Two 64KiB buffers, irrespective of the input duration. Reverse FRAMES, not channels.
/// Refuse an existing destination and incomplete frames; all I/O errors propagate.
pub(crate) fn reverse_pcm_frames(input:&Path,output:&Path,channels:u64,check:&dyn Fn()->Result<(),String>)->Result<u64,String>{
    check()?;
    if !(1..=64).contains(&channels){return Err("Unsupported PCM channel count".into());}
    let frame=(channels as usize)*4;
    let mut source=File::open(input).map_err(|e|e.to_string())?;
    let length=source.metadata().map_err(|e|e.to_string())?.len();
    if length==0 || length>super::MAX_OUTPUT || length%frame as u64!=0 {return Err("Invalid or oversized reverse PCM scratch".into());}
    let target=OpenOptions::new().write(true).create_new(true).open(output).map_err(|e|e.to_string())?;
    let mut target=BufWriter::with_capacity(65536,target);
    let mut buffer=vec![0u8;65536/frame*frame];
    let mut remaining=length;
    while remaining>0 {
        check()?;
        let count=remaining.min(buffer.len() as u64) as usize;
        remaining-=count as u64;
        source.seek(SeekFrom::Start(remaining)).map_err(|e|e.to_string())?;
        source.read_exact(&mut buffer[..count]).map_err(|e|e.to_string())?;
        for block in buffer[..count].chunks_exact(frame).rev(){target.write_all(block).map_err(|e|e.to_string())?;}
    }
    target.flush().map_err(|e|e.to_string())?;
    if source.metadata().map_err(|e|e.to_string())?.len()!=length {return Err("PCM scratch changed while reversing".into());}
    check()?;Ok(length)
}
/// Decode to f32 PCM, then reverse with bounded RAM. Avoid FFmpeg areverse's whole-file
/// memory buffering. Both temporary files stay under the retained task scratch directory.
pub(crate) fn prepare_reverse(ffmpeg:&Path,input:&Path,cwd:&Path,source:&super::AudioInfo,check:&dyn Fn()->Result<(),String>,scope:&crate::task_custody::Scope)->Result<(PathBuf,PathBuf),String>{
    if !(1..=64).contains(&source.channels) || !(1..=768000).contains(&source.sample_rate) {return Err("Unsupported reverse audio stream geometry".into());}
    let decoded=cwd.join("reverse-decoded.f32");let reversed=cwd.join("reverse-ordered.f32");
    let args=vec!["-v".into(),"error".into(),"-nostdin".into(),"-n".into(),"-max_alloc".into(),"268435456".into(),"-threads".into(),"2".into(),"-protocol_whitelist".into(),"file,pipe".into(),"-i".into(),super::argument(input)?,"-map".into(),"0:a:0".into(),"-vn".into(),"-sn".into(),"-dn".into(),"-c:a".into(),"pcm_f32le".into(),"-f".into(),"f32le".into(),"-fs".into(),super::MAX_OUTPUT.to_string(),super::argument(&decoded)?];
    super::command(ffmpeg,&args,cwd,Duration::from_secs(7200),Some(&decoded),check,scope)?;
    let bytes=fs::metadata(&decoded).map_err(|e|e.to_string())?.len();
    if bytes>=super::MAX_OUTPUT-1_000_000 {return Err("倒放临时PCM触及2 GB预算，未输出截断结果 / Reverse PCM reached the 2 GB scratch budget; no truncated result accepted".into());}
    reverse_pcm_frames(&decoded,&reversed,source.channels,check)?;
    Ok((decoded,reversed))
}

/// Only called after process-tree confirmation. On an unconfirmed stop, the caller
/// leaves these files in task-owned Scratch retained by the existing custody scope.
pub(crate) fn cleanup_reverse(cwd:&Path)->Result<(),String>{
 for name in ["reverse-decoded.f32","reverse-ordered.f32"] {
  match fs::remove_file(cwd.join(name)){Ok(())=>(),Err(e) if e.kind()==std::io::ErrorKind::NotFound=>(),Err(e)=>return Err(format!("Reverse scratch cleanup: {e}"))}
 }
 Ok(())
}
