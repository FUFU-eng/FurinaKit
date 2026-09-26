//! Shared image parameter validation; no codec runs in the host process.
use serde_json::Value;
pub fn number(args:&Value,key:&str,default:f64)->Result<f64,String>{
    let Some(value)=args.get(key).filter(|v|!v.is_null()&&v.as_str()!=Some("")) else{return Ok(default);};
    value.as_f64().or_else(||value.as_str().and_then(|s|s.parse().ok())).filter(|n|n.is_finite()).ok_or_else(||format!("无效参数 / Invalid parameter: {key}"))
}
pub fn sizes(args:&Value)->Result<Vec<u32>,String>{
    let value=args.get("sizes");let text=value.and_then(Value::as_str).unwrap_or("all");
    let mut values=if let Some(a)=value.and_then(Value::as_array){a.iter().map(|v|v.as_u64().or_else(||v.as_str().and_then(|s|s.parse().ok())).filter(|n|*n>0&&*n<=256).map(|n|n as u32).ok_or("ICO 尺寸必须为 1–256 / ICO size must be 1–256")).collect::<Result<Vec<_>,_>>()?}
    else if let Some(n)=value.and_then(Value::as_u64){if n==0||n>256{return Err("ICO size must be 1–256".into());}vec![n as u32]}
    else{match text{"all"|""=>vec![16,24,32,48,64,128,256],"favicon"=>vec![16,32],"desktop"=>vec![32,48,256],other=>other.split(',').map(|s|s.trim().parse::<u32>().ok().filter(|n|*n>0&&*n<=256).ok_or("无效 ICO 尺寸 / Invalid ICO sizes")).collect::<Result<Vec<_>,_>>()?}};
    values.sort_unstable();values.dedup();if values.is_empty()||values.len()>32{return Err("ICO 需要 1–32 个不同尺寸 / ICO requires 1–32 sizes".into());}Ok(values)
}
pub fn extension(tool:&str,args:&Value)->Result<String,String>{
    let raw=match tool{"image-to-ico"=>"ico","image-to-png"=>"png","image-to-jpg"=>"jpg",_=>args["format"].as_str().unwrap_or(if tool=="image-format-convert"{"webp"}else{"jpg"})};
    let value=raw.trim_start_matches('.').to_ascii_lowercase();let value=match value.as_str(){"jpeg"=>"jpg".into(),"tif"=>"tiff".into(),_=>value};
    if !matches!(value.as_str(),"ico"|"jpg"|"png"|"bmp"|"tiff"|"webp"|"avif"|"gif"){return Err("此入口不支持该输出格式，请使用格式转换工具 / Unsupported output format for this endpoint".into());}Ok(value)
}
