//! Explicit user-requested OpenAI-compatible connection and model discovery.
use serde_json::{json,Value};
use std::io::Write;
use std::process::{Command,Stdio};

pub fn validate(ai:&Value)->Result<(),String>{
    if ai["provider"].as_str().unwrap_or("").trim().is_empty(){return Err("请填写服务商名称".into());}
    let url=url::Url::parse(ai["baseUrl"].as_str().unwrap_or("").trim()).map_err(|_|"接口地址格式错误，请输入完整的 http:// 或 https:// 地址")?;
    if !["http","https"].contains(&url.scheme()) || url.host_str().is_none() || !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some(){return Err("接口地址需为 HTTP(S) Base URL，不能含用户名、密码、查询参数或片段".into());}
    if ai["model"].as_str().unwrap_or("").trim().is_empty(){return Err("请填写模型 ID".into());}
    Ok(())
}
fn failure(code:u16,body:&Value)->String{
    let tag=body.pointer("/error/code").and_then(Value::as_str).unwrap_or("").to_lowercase();
    let text=body.pointer("/error/message").and_then(Value::as_str).unwrap_or("").to_lowercase();
    if code==401{return "API Key 无效或已过期（HTTP 401），不是服务商名称错误".into();}
    if code==403{return "没有访问权限或当前地区被限制（HTTP 403），请检查账户权限".into();}
    if code==429{return "请求限流或账户额度不足（HTTP 429），请检查余额后重试".into();}
    if code>=500{return format!("服务商暂时不可用（HTTP {code}），请稍后重试");}
    if [400,404,422].contains(&code) && (tag=="model_not_found"||tag=="invalid_model"||text.contains("model does not exist")||text.contains("model not found")||text.contains("invalid model")||text.contains("模型不存在")){
        return "模型名称输入有误或该账户没有此模型权限，请核对服务商提供的模型 ID".into();
    }
    if code==404{return "接口路径不存在（HTTP 404），请核对 Base URL；不能据此判断服务商名称错误".into();}
    format!("接口请求失败（HTTP {code}），请检查接口是否兼容 OpenAI Chat Completions 协议及请求参数")
}
pub fn request(ai:Value,models:bool)->Result<Value,String>{
    validate(&ai)?;
    let base=ai["baseUrl"].as_str().unwrap().trim().trim_end_matches('/');
    let key=ai["apiKey"].as_str().unwrap_or("").trim();
    let endpoint=format!("{base}/{}",if models{"models"}else{"chat/completions"});
    let quote=|s:&str|serde_json::to_string(s).unwrap();
    // Credentials go through stdin, never process arguments or temporary files. No redirects.
    let mut config=format!("url = {}\nheader = {}\n",quote(&endpoint),quote("Content-Type: application/json"));
    if !key.is_empty(){config.push_str(&format!("header = {}\n",quote(&format!("Authorization: Bearer {key}"))));}
    if !models {
        let body=json!({"model":ai["model"].as_str().unwrap().trim(),"messages":[{"role":"user","content":"Reply OK."}],"stream":false});
        config.push_str(&format!("request = \"POST\"\ndata = {}\n",quote(&body.to_string())));
    }
    let mut cmd=Command::new("curl");crate::commands::no_window(&mut cmd);
    let mut child=cmd.args(["--silent","--show-error","--connect-timeout","10","--max-time","60","--max-filesize","2097152","--write-out","\n%{http_code}","--config","-"])
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|_|"无法启动系统网络请求组件 curl")?;
    if let Some(mut input)=child.stdin.take(){if input.write_all(config.as_bytes()).is_err(){let _=child.kill();let _=child.wait();return Err("网络请求启动失败".into());}}
    let output=child.wait_with_output().map_err(|_|"读取网络响应失败")?;
    if !output.status.success(){return Err("无法连接服务商：请检查网络、代理、TLS 证书或接口地址；请求可能已超时".into());}
    let raw=String::from_utf8_lossy(&output.stdout);
    let (body,code)=raw.rsplit_once('\n').ok_or("接口响应不完整")?;
    let code=code.trim().parse::<u16>().unwrap_or(0);
    let body:Value=serde_json::from_str(body).unwrap_or(Value::Null);
    if !(200..300).contains(&code){return Err(failure(code,&body));}
    if models {
        let list=body["data"].as_array().ok_or("接口未提供 OpenAI 格式模型列表；仍可手动输入模型 ID 后验证")?;
        let ids:Vec<&str>=list.iter().filter_map(|m|m["id"].as_str()).collect();
        return Ok(json!({"models":ids,"source":"remote"}));
    }
    if !body["choices"].as_array().map(|a|!a.is_empty()).unwrap_or(false){return Err("接口已响应，但未返回有效的 Chat Completions 结果，不能确认模型可用".into());}
    Ok(json!({"ok":true,"message":"连接正常，当前模型已真实响应。此操作可能消耗API 费用。"}))
}
