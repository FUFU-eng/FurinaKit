//! On-demand proxy for the existing signature provider. No request on tool open.
use serde_json::{json,Value};
use std::{io::Read,process::{Command,Stdio}};
const PROVIDER:&str="https://www.yishuzi.com/";
fn request(url:&str,body:Option<&str>,limit:usize)->Result<Vec<u8>,String>{
 let attempt=|proxy:Option<&str>|->Result<Vec<u8>,String>{
  let mut cmd=Command::new("curl");
  cmd.args(["--silent","--show-error","--fail","--proto","=https","--connect-timeout","10","--max-time","25","--max-filesize",&limit.to_string(),"--referer",PROVIDER,"--user-agent","Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36"]);
  if let Some(p)=proxy{cmd.args(["--proxy",p]);}else{cmd.args(["--noproxy","*"]);}
  if let Some(data)=body {cmd.args(["--header","Content-Type: application/x-www-form-urlencoded","--data-raw",data]);}
  cmd.arg(url).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());crate::commands::no_window(&mut cmd);
  let mut child=cmd.spawn().map_err(|e|format!("无法调用签名网络服务：{e}"))?;
  let mut bytes=vec![];let result=child.stdout.take().ok_or("签名请求输出不可用")?.take(limit as u64+1).read_to_end(&mut bytes);
  if result.is_err()||bytes.len()>limit {let _=child.kill();let _=child.wait();return Err("签名服务响应过大或读取失败".into());}
  if !child.wait().map_err(|e|e.to_string())?.success(){return Err("在线签名服务请求失败或超时；可切换到本地字库或自由手写板".into());}
  Ok(bytes)
 };
 match attempt(None){Ok(v)=>Ok(v),Err(first)=>match crate::video::system_proxy(url){Some(proxy)=>attempt(Some(&proxy)).map_err(|_|first),None=>Err(first)}}
}
#[tauri::command]
pub async fn generate_signature(name:String,font_id:String,font_color:String)->Result<Value,String>{
 tauri::async_runtime::spawn_blocking(move||{
  let name=name.trim();if name.is_empty()||name.chars().count()>20{return Err("在线签名需要1至20个字符".into());}
  if font_id.is_empty()||font_id.len()>8||!font_id.bytes().all(|c|c.is_ascii_digit()){return Err("签名字体编号无效".into());}
  if font_color.len()!=7||!font_color.starts_with('#')||!font_color[1..].bytes().all(|c|c.is_ascii_hexdigit()){return Err("签名颜色无效".into());}
  let body=url::form_urlencoded::Serializer::new(String::new()).append_pair("id",name).append_pair("zhenbi","20191123").append_pair("id2",&font_id).append_pair("id4","#000000").append_pair("id5",&font_color).append_pair("id6","#FFFFFE").finish();
  let bytes=request("https://www.yishuzi.com/make.php?file=b13y&page=2309",Some(&body),512*1024)?;
  let value:Value=serde_json::from_slice(&bytes).map_err(|_|"签名服务返回了非JSON内容，接口可能已变化")?;
  let raw=value.pointer("/zhenbi/0/info/0").and_then(Value::as_str).ok_or("签名服务没有返回图片；请更换字体或使用本地字库")?;
  let mut url=url::Url::parse(PROVIDER).unwrap().join(raw).map_err(|_|"签名图片地址无效")?;
  let host=url.host_str().unwrap_or("");
  if !(host=="yishuzi.com"||host.ends_with(".yishuzi.com"))||!url.username().is_empty()||url.password().is_some()||url.port().is_some()||!["https","http"].contains(&url.scheme()){return Err("签名服务返回了未允许的图片来源".into());}
  url.set_scheme("https").map_err(|_|"图片地址协议无效")?;
  let bytes=request(url.as_str(),None,8*1024*1024)?;
  let (width,height)=image::ImageReader::new(std::io::Cursor::new(&bytes)).with_guessed_format().map_err(|_|"签名图片无效")?.into_dimensions().map_err(|_|"无法读取签名图片尺寸")?;
  if width==0||height==0||width>8192||height>8192||width as u64*height as u64>24_000_000{return Err("签名图片尺寸超出安全范围".into());}
  let mime=match image::guess_format(&bytes).map_err(|_|"签名服务没有返回有效图片")?{image::ImageFormat::Png=>"image/png",image::ImageFormat::Jpeg=>"image/jpeg",image::ImageFormat::Gif=>"image/gif",_=>return Err("签名图片格式不支持".into())};
  Ok(json!({"success":true,"dataUrl":format!("data:{mime};base64,{}",crate::jobs::b64_encode_public(&bytes))}))
 }).await.map_err(|e|e.to_string())?
}
