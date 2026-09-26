//! One request per process. Parent assigns a Job Object BEFORE writing stdin.
use std::{io::{Read,Write},path::PathBuf};
use serde::Deserialize;
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {protocol:u32,tool:String,args:serde_json::Value,input:PathBuf,output:PathBuf}
fn run()->Result<serde_json::Value,String>{
 let mut bytes=Vec::new();std::io::stdin().take(65537).read_to_end(&mut bytes).map_err(|e|e.to_string())?;
 if bytes.len()>65536{return Err("Worker request exceeds 64 KiB".into());}
 let request:Request=serde_json::from_slice(&bytes).map_err(|e|e.to_string())?;
 if request.protocol!=1{return Err("Unsupported worker protocol".into());}
 let tool=request.tool.as_str();if !matches!(tool,"image-format-convert"|"image-compress"|"image-to-jpg"|"image-to-png"|"image-to-ico"|"gif-compress"|"gif-crop"|"upscale-prepare"|"upscale-finish"){return Err("Unsupported worker tool".into());}
 if request.output.exists(){return Err("Worker refuses to overwrite an existing output".into());}
 let check=||Ok(());
 let result=if tool=="upscale-prepare"{furinakit_image_codecs::upscale_pixels::prepare(&request.input,&request.output,&request.args)}else if tool=="upscale-finish"{furinakit_image_codecs::upscale_pixels::finish(&request.input,&request.output,&request.args)}else if tool.starts_with("gif-"){furinakit_image_codecs::image_gif::encode(tool,&request.args,&request.input,&request.output,&check)}else{
  let ext=furinakit_image_codecs::image_basic::extension(tool,&request.args)?;
  furinakit_image_codecs::image_basic::encode(tool,&request.args,&request.input,&request.output,&ext,&check)
 };
 // The parent owns the private scratch directory and cleans failed outputs.
 // Do not unlink here: a failed create_new must never delete a concurrently created file.
 result
}
fn main(){
 let response=match run(){Ok(value)=>serde_json::json!({"protocol":1,"ok":true,"result":value}),Err(error)=>serde_json::json!({"protocol":1,"ok":false,"error":error})};
 let bytes=serde_json::to_vec(&response).unwrap_or_else(|_|br#"{"protocol":1,"ok":false,"error":"worker response failed"}"#.to_vec());
 if bytes.len()>65536{std::process::exit(3);}
 if std::io::stdout().write_all(&bytes).is_err(){std::process::exit(2);}
}
