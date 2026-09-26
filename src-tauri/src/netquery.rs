// 联网查询类工具的后端：天气、公网 IP、手机号归属地、快递单号、域名可用性。
//
// ── 为什么必须放 Rust 而不是前端直接 fetch ─────────────────────────────────
// 这些接口（open-meteo、ipip.net、360、快递100、阿里 DoH）**都没有给浏览器用的 CORS 头**，
// 网页里直接 fetch 会被同源策略拦掉；而且它们全是国内可直连的服务（已实测），
// 所以统一由 Rust 侧用 curl 取回来再交给界面。
//
// ── 接口可用性是实测挑出来的（见 _verify/test_net_apis.py）─────────────────
//   通：t.weather.itboy.net（中国天气）· open-meteo（含城市检索）· myip.ipip.net ·
//       cx.shouji.360.cn · www.kuaidi100.com · dns.alidns.com（DoH）· rdap.verisign.com
//   不通：api.vvhan.com（DNS 解析不了）· api.oioweb.cn（TLS 失败）· api.ipify.org ·
//       ip.useragentinfo.com · uomg 等
// 所以工具只用了"通"的那批 —— 否则用户那边就是打不开。

use serde_json::{json, Value};

/// 取一个 URL 的文本（先直连，失败再用系统代理重试一次）
pub(crate) fn http_get(url: &str, timeout: u32) -> Result<String, String> {
    let attempt = |proxy: Option<&str>| -> Result<String, String> {
        let mut cmd = std::process::Command::new("curl");
        cmd.args(["-sS", "-L", "--max-time", &timeout.to_string()]);
        // 有些接口只认浏览器 UA / 会拦空 UA
        cmd.args(["-A", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"]);
        if let Some(p) = proxy {
            cmd.args(["--proxy", p]);
        }
        cmd.arg(url);
        crate::commands::no_window(&mut cmd);
        let out = cmd.output().map_err(|e| format!("调用 curl 失败：{e}"))?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
        }
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    };
    match attempt(None) {
        Ok(s) => Ok(s),
        Err(first) => match crate::video::system_proxy(url) {
            Some(p) => attempt(Some(&p)).map_err(|_| first),
            None => Err(first),
        },
    }
}

fn http_json(url: &str, timeout: u32) -> Result<Value, String> {
    let text = http_get(url, timeout)?;
    serde_json::from_str(&text).map_err(|e| format!("返回的不是有效 JSON：{e}"))
}

/// URL 编码（只用于查询参数里的中文与特殊字符）
pub(crate) fn url_encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.as_bytes() {
        match *b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(*b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

// ══════════════════════════════════════════════════════════════════════
// 天气（open-meteo：免密钥、支持全球任意城市）
// ══════════════════════════════════════════════════════════════════════

/// WMO 天气代码 → 中文描述（open-meteo 用的是这套代码）
fn weather_text(code: i64) -> (&'static str, &'static str) {
    match code {
        0 => ("晴", "☀️"),
        1 => ("晴间多云", "🌤️"),
        2 => ("多云", "⛅"),
        3 => ("阴", "☁️"),
        45 | 48 => ("雾", "🌫️"),
        51 | 53 | 55 => ("毛毛雨", "🌦️"),
        56 | 57 => ("冻毛毛雨", "🌧️"),
        61 => ("小雨", "🌦️"),
        63 => ("中雨", "🌧️"),
        65 => ("大雨", "🌧️"),
        66 | 67 => ("冻雨", "🌧️"),
        71 => ("小雪", "🌨️"),
        73 => ("中雪", "🌨️"),
        75 => ("大雪", "❄️"),
        77 => ("米雪", "🌨️"),
        80 | 81 | 82 => ("阵雨", "🌦️"),
        85 | 86 => ("阵雪", "🌨️"),
        95 => ("雷阵雨", "⛈️"),
        96 | 99 => ("雷阵雨伴冰雹", "⛈️"),
        _ => ("未知", "❓"),
    }
}

pub fn geocode(keyword: &str) -> Result<Value, String> {
    let kw = keyword.trim();
    if kw.is_empty() {
        return Err("请输入城市名".into());
    }
    let url = format!(
        "https://geocoding-api.open-meteo.com/v1/search?name={}&count=8&language=zh&format=json",
        url_encode(kw)
    );
    let v = http_json(&url, 20)?;
    let list = v
        .get("results")
        .and_then(|r| r.as_array())
        .map(|arr| {
            arr.iter()
                .map(|x| {
                    json!({
                        "name": x.get("name").and_then(|s| s.as_str()).unwrap_or(""),
                        "country": x.get("country").and_then(|s| s.as_str()).unwrap_or(""),
                        "admin": x.get("admin1").and_then(|s| s.as_str()).unwrap_or(""),
                        "lat": x.get("latitude").and_then(|s| s.as_f64()).unwrap_or(0.0),
                        "lon": x.get("longitude").and_then(|s| s.as_f64()).unwrap_or(0.0),
                        "timezone": x.get("timezone").and_then(|s| s.as_str()).unwrap_or("auto"),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if list.is_empty() {
        return Err(format!("没找到叫「{kw}」的城市，换个写法试试（例如用英文或去掉市/省）"));
    }
    Ok(json!({ "success": true, "results": list }))
}

pub fn weather(lat: f64, lon: f64, timezone: &str) -> Result<Value, String> {
    let tz = if timezone.trim().is_empty() { "auto" } else { timezone.trim() };
    // ★ 注意：Rust 的字符串续行 `\` 只会吃掉换行符，**不会**吃掉下一行前面的空格，
    //   拼出来的 URL 里会夹一堆空格 → 接口直接报错、返回对象里没有 current（踩过）。
    //   所以这里老实用单行拼，别为了好看换行。
    let url = format!(
        "https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,pressure_msl&hourly=temperature_2m,weather_code,precipitation_probability&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max,wind_speed_10m_max&timezone={}&forecast_days=7",
        url_encode(tz)
    );
    let v = http_json(&url, 20)?;
    if v.get("error").and_then(|e| e.as_bool()).unwrap_or(false) {
        return Err(format!(
            "天气接口返回错误：{}",
            v.get("reason").and_then(|r| r.as_str()).unwrap_or("未知原因")
        ));
    }

    let cur = v.get("current").cloned().unwrap_or(json!({}));
    let code = cur.get("weather_code").and_then(|x| x.as_i64()).unwrap_or(-1);
    let (desc, icon) = weather_text(code);

    // 逐小时：只取未来 24 小时
    let hourly = v.get("hourly").cloned().unwrap_or(json!({}));
    let times = hourly.get("time").and_then(|x| x.as_array()).cloned().unwrap_or_default();
    let temps = hourly.get("temperature_2m").and_then(|x| x.as_array()).cloned().unwrap_or_default();
    let codes = hourly.get("weather_code").and_then(|x| x.as_array()).cloned().unwrap_or_default();
    let pops = hourly.get("precipitation_probability").and_then(|x| x.as_array()).cloned().unwrap_or_default();
    let now = cur.get("time").and_then(|x| x.as_str()).unwrap_or("");
    let start = times
        .iter()
        .position(|t| t.as_str().map(|s| s >= now).unwrap_or(false))
        .unwrap_or(0);
    let hours: Vec<Value> = (start..times.len().min(start + 24))
        .map(|i| {
            let c = codes.get(i).and_then(|x| x.as_i64()).unwrap_or(-1);
            json!({
                "time": times[i],
                "temp": temps.get(i).cloned().unwrap_or(json!(null)),
                "code": c,
                "desc": weather_text(c).0,
                "icon": weather_text(c).1,
                "pop": pops.get(i).cloned().unwrap_or(json!(null)),
            })
        })
        .collect();

    // 未来 7 天
    let daily = v.get("daily").cloned().unwrap_or(json!({}));
    let dtime = daily.get("time").and_then(|x| x.as_array()).cloned().unwrap_or_default();
    let days: Vec<Value> = dtime
        .iter()
        .enumerate()
        .map(|(i, t)| {
            let c = daily.get("weather_code").and_then(|x| x.as_array()).and_then(|a| a.get(i)).and_then(|x| x.as_i64()).unwrap_or(-1);
            json!({
                "date": t,
                "code": c,
                "desc": weather_text(c).0,
                "icon": weather_text(c).1,
                "max": daily.get("temperature_2m_max").and_then(|x| x.as_array()).and_then(|a| a.get(i)).cloned().unwrap_or(json!(null)),
                "min": daily.get("temperature_2m_min").and_then(|x| x.as_array()).and_then(|a| a.get(i)).cloned().unwrap_or(json!(null)),
                "sunrise": daily.get("sunrise").and_then(|x| x.as_array()).and_then(|a| a.get(i)).cloned().unwrap_or(json!(null)),
                "sunset": daily.get("sunset").and_then(|x| x.as_array()).and_then(|a| a.get(i)).cloned().unwrap_or(json!(null)),
                "pop": daily.get("precipitation_probability_max").and_then(|x| x.as_array()).and_then(|a| a.get(i)).cloned().unwrap_or(json!(null)),
                "wind": daily.get("wind_speed_10m_max").and_then(|x| x.as_array()).and_then(|a| a.get(i)).cloned().unwrap_or(json!(null)),
            })
        })
        .collect();

    Ok(json!({
        "success": true,
        "source": "open-meteo",
        "current": {
            "time": cur.get("time").cloned().unwrap_or(json!("")),
            "temp": cur.get("temperature_2m").cloned().unwrap_or(json!(null)),
            "feels": cur.get("apparent_temperature").cloned().unwrap_or(json!(null)),
            "humidity": cur.get("relative_humidity_2m").cloned().unwrap_or(json!(null)),
            "precip": cur.get("precipitation").cloned().unwrap_or(json!(null)),
            "wind": cur.get("wind_speed_10m").cloned().unwrap_or(json!(null)),
            "windDir": cur.get("wind_direction_10m").cloned().unwrap_or(json!(null)),
            "pressure": cur.get("pressure_msl").cloned().unwrap_or(json!(null)),
            "code": code, "desc": desc, "icon": icon,
        },
        "hours": hours,
        "days": days,
    }))
}

// ══════════════════════════════════════════════════════════════════════
// 公网 IP（ipip.net：返回一行文本，含归属地）
// ══════════════════════════════════════════════════════════════════════

pub fn public_ip() -> Result<Value, String> {
    let text = http_get("https://myip.ipip.net", 15)?;
    // 形如：当前 IP：1.2.3.4  来自于：中国 吉林 长春  电信
    let ip = text
        .split("IP：")
        .nth(1)
        .and_then(|s| s.split_whitespace().next())
        .unwrap_or("")
        .trim()
        .to_string();
    let location = text
        .split("来自于：")
        .nth(1)
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    if ip.is_empty() {
        return Err("没能从返回内容里解析出 IP".into());
    }
    let is_v6 = ip.contains(':');
    // 归属地拆成 国家/省/市/运营商
    let parts: Vec<&str> = location.split_whitespace().collect();
    Ok(json!({
        "success": true,
        "ip": ip,
        "version": if is_v6 { "IPv6" } else { "IPv4" },
        "location": location,
        "country": parts.first().copied().unwrap_or(""),
        "region": parts.get(1).copied().unwrap_or(""),
        "city": parts.get(2).copied().unwrap_or(""),
        "isp": parts.last().copied().unwrap_or(""),
        "raw": text.trim(),
    }))
}

// ══════════════════════════════════════════════════════════════════════
// 手机号归属地（360：省 / 运营商）
// ══════════════════════════════════════════════════════════════════════

pub fn phone(number: &str) -> Result<Value, String> {
    let n: String = number.chars().filter(|c| c.is_ascii_digit()).collect();
    if n.len() != 11 || !n.starts_with('1') {
        return Err("请填 11 位中国大陆手机号（1 开头）".into());
    }
    let url = format!("https://cx.shouji.360.cn/phonearea.php?number={n}");
    let v = http_json(&url, 15)?;
    let data = v.get("data").cloned().unwrap_or(json!({}));
    let province = data.get("province").and_then(|x| x.as_str()).unwrap_or("");
    let city = data.get("city").and_then(|x| x.as_str()).unwrap_or("");
    let sp = data.get("sp").and_then(|x| x.as_str()).unwrap_or("");
    if province.is_empty() && sp.is_empty() {
        return Err("查询不到这个号段的归属地（可能是虚拟号段或新号段）".into());
    }
    // 号段信息：前 3 位是运营商号段，前 7 位定位到城市
    Ok(json!({
        "success": true,
        "number": n,
        "segment": &n[..3],
        "prefix": &n[..7],
        "province": province,
        "city": city,
        "isp": sp,
        "region": format!("{province}{city}"),
    }))
}

// ══════════════════════════════════════════════════════════════════════
// 快递单号（快递100：先自动识别快递公司，再查轨迹）
// ══════════════════════════════════════════════════════════════════════

fn carrier_name(code: &str) -> &'static str {
    match code {
        "shunfeng" => "顺丰速运",
        "yuantong" => "圆通速递",
        "zhongtong" => "中通快递",
        "shentong" => "申通快递",
        "yunda" => "韵达速递",
        "jd" => "京东物流",
        "jtexpress" => "极兔速递",
        "youzhengguonei" => "邮政快递包裹",
        "ems" => "EMS",
        "debangkuaidi" => "德邦快递",
        "huitongkuaidi" => "百世快递",
        "tiantian" => "天天快递",
        "zhaijisong" => "宅急送",
        "youshuwuliu" => "优速快递",
        "annengwuliu" => "安能物流",
        "quanfengkuaidi" => "全峰快递",
        "zhongyouwuliu" => "中邮物流",
        "suer" => "速尔快递",
        "yuefengwuliu" => "越丰物流",
        "dhl" => "DHL",
        "fedex" => "FedEx",
        "ups" => "UPS",
        "usps" => "USPS",
        _ => "",
    }
}

fn express_scalar(v:&Value,key:&str)->String {match v.get(key){Some(Value::String(s))=>s.clone(),Some(Value::Number(n))=>n.to_string(),_=>String::new()}}
fn express_time(value: &str) -> Option<Vec<u32>> {
 let parts:Vec<u32>=value.split(|c:char|!c.is_ascii_digit()).filter(|s|!s.is_empty()).map(str::parse).collect::<Result<_,_>>().ok()?;
 if parts.len()!=6 || parts[0]<1900 || !(1..=12).contains(&parts[1]) || parts[3]>23 || parts[4]>59 || parts[5]>59 { return None; }
 let leap = parts[0]%4==0 && (parts[0]%100!=0 || parts[0]%400==0);
 let days = match parts[1] { 2 => if leap {29} else {28}, 4|6|9|11 => 30, _ => 31 };
 if parts[2]==0 || parts[2]>days { return None; }
 Some(parts)
}
// Dedicated live request: no curl configuration, cache reuse, HTTP downgrade or successful error pages.
fn express_json(url: &str) -> Result<Value, String> {
 let mut cmd = std::process::Command::new("curl");
 cmd.args(["--disable", "--silent", "--show-error", "--fail", "--proto", "=https", "--connect-timeout", "10", "--max-time", "25", "--max-filesize", "2097152",
   "--header", "Accept: application/json, text/javascript, */*; q=0.01",
   "--header", "X-Requested-With: XMLHttpRequest",
   "--header", "Cache-Control: no-cache, no-store",
   "--header", "Pragma: no-cache",
   "--header", "Sec-Fetch-Site: same-origin",
   "--header", "Sec-Fetch-Mode: cors",
   "--header", "Sec-Fetch-Dest: empty",
   "--referer", "https://www.kuaidi100.com/",
   "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"]);
 if let Some(proxy) = crate::video::system_proxy(url) { cmd.args(["--proxy", &proxy]); }
 cmd.arg(url);
 crate::commands::no_window(&mut cmd);
 let output = cmd.output().map_err(|_| "无法连接物流服务 / Unable to connect to tracking service".to_string())?;
 if !output.status.success() { return Err("物流服务拒绝查询或连接失败，请点击下方前往官方或网页版查询 / Tracking service connection failed".into()); }
 if output.stdout.len()>2*1024*1024 { return Err("物流响应过大 / Tracking response is too large".into()); }
 serde_json::from_slice(&output.stdout).map_err(|_| "物流服务返回了验证页面或非JSON数据，请直接在网页版或官网查看 / Tracking service returned non-JSON data".into())
}
pub fn express(number: &str, company_hint: &str, phone_hint:&str) -> Result<Value, String> {
 let n:String=number.chars().filter(|c|!c.is_whitespace()).collect();
 if !(6..=64).contains(&n.len())||!n.chars().all(|c|c.is_ascii_alphanumeric()||c=='-'){return Err("请检查快递单号，仅支持6至64位字母、数字和连字符 / Check the tracking number format".into());}
 let phone=phone_hint.trim();
 if !phone.is_empty()&&(phone.len()!=4||!phone.chars().all(|c|c.is_ascii_digit())){return Err("手机号后四位格式有误，请输入4位纯数字 / Enter the last four phone digits".into());}
 let company=company_hint.trim().to_ascii_lowercase();let auto_detected=company.is_empty();
 if auto_detected {
  let auto=express_json(&format!("https://www.kuaidi100.com/autonumber/autoComNum?text={}",url_encode(&n)))?;
  let mut codes=Vec::<String>::new();
  if let Some(list)=auto.get("auto").and_then(Value::as_array){for item in list {if let Some(code)=item.get("comCode").and_then(Value::as_str){let code=code.trim().to_ascii_lowercase();if !code.is_empty()&&!codes.contains(&code){codes.push(code);}}}}
  {
   let candidates:Vec<Value>=codes.iter().map(|code|{let name=carrier_name(code);json!({"code":code,"name":if name.is_empty(){code.as_str()}else{name}})}).collect();
   return Ok(json!({"success":false,"error":if codes.is_empty(){"无法识别快递公司，请手动选择 / Carrier not identified; select it manually"}else{"请确认识别到的快递公司后再次查询，识别结果不是轨迹归属证明 / Confirm the suggested carrier before querying"},"candidates":candidates}));
  }
 }
 if company.len()>64||!company.chars().all(|c|c.is_ascii_alphanumeric()||c=='_'){return Err("快递公司编码无效 / Invalid carrier code".into());}
 
 let rand_nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d|d.as_nanos()).unwrap_or(888_888_888);
 let rand_float = (rand_nanos % 1_000_000_000) as f64 / 1_000_000_000.0;
 let temp_str = format!("{:.16}", rand_float);
 let query_url = format!("https://www.kuaidi100.com/query?type={}&postid={}&temp={}&phone={}",url_encode(&company),url_encode(&n),temp_str,url_encode(phone));
 let v=express_json(&query_url)?;
 let status=express_scalar(&v,"status");
 if status!="200" {
  let msg = v.get("message").and_then(Value::as_str).unwrap_or("");
  let friendly_msg = if msg.contains("验证码") || status == "408" {
   "需要验证手机号后四位，请在左侧填写后重试，或直接点击下方前往官网查询"
  } else if !msg.is_empty() {
   msg
  } else {
   "查询服务未返回有效轨迹，请核对单号或点击下方直接前往官网/网页版查询"
  };
  return Err(format!("{}（服务状态：{}）", friendly_msg, if status.is_empty(){"缺失"}else{&status}));
 }
 if v.get("result").is_some() && express_scalar(&v,"result") != "1" { return Err("服务没有确认本次查询成功，未展示不确定轨迹 / The provider did not confirm a successful query".into()); }
 let returned_number=express_scalar(&v,"nu");let returned_company=express_scalar(&v,"com");
 if returned_number.is_empty()||!returned_number.eq_ignore_ascii_case(&n)||returned_company.is_empty()||!returned_company.eq_ignore_ascii_case(&company){return Err("服务返回的单号或快递公司不匹配，已拒绝展示 / Response tracking number or carrier does not match".into());}
 
 let is_dummy_context = |ctx: &str| -> bool {
  let c = ctx.trim();
  c.is_empty()
   || c.contains("查无结果")
   || c.contains("暂无结果")
   || c.contains("无轨迹")
   || c.contains("未查到")
   || c.contains("单号不存在")
   || c.contains("不是有效的快递单号")
   || c.contains("无物流信息")
 };

 let mut list:Vec<Value>=v.get("data").and_then(Value::as_array).map(|arr|arr.iter().filter_map(|x|{
  let context=x.get("context").and_then(Value::as_str)?;
  if is_dummy_context(context) { return None; }
  let time=x.get("time").and_then(Value::as_str).filter(|s|!s.trim().is_empty()).or_else(||x.get("ftime").and_then(Value::as_str)).unwrap_or("");
  Some(json!({"time":time,"context":context,"providerStatus":x.get("status"),"areaName":x.get("areaName")}))
 }).collect()).unwrap_or_default();
 
 if list.is_empty(){
  return Err("暂未查询到公开物流轨迹（第三方接口返回查无结果）。顺丰/中通等部分包裹受官方反爬与隐私保护限制，请直接点击下方链接前往官网或快递100网页查看完整物流。".into());
 }
 let order_verified=list.iter().all(|x|express_time(x["time"].as_str().unwrap_or("")).is_some());
 if order_verified {list.sort_by(|a,b|express_time(b["time"].as_str().unwrap_or("")).cmp(&express_time(a["time"].as_str().unwrap_or(""))));}
 
 let state=express_scalar(&v,"state");
 let mut state_text=match state.as_str(){"0"=>"在途中","1"=>"已揽收","2"=>"疑难件","3"=>"已签收","4"=>"已退签","5"=>"派送中","6"=>"退回中","7"=>"转单","10"=>"待清关","11"=>"清关中","12"=>"已清关","13"=>"清关异常","14"=>"已拒签",_=>"在途中"};
 
 // 防止第三方接口返回虚假 state: "3"（已签收）
 if state == "3" {
  let latest_context = list.first()
   .and_then(|item| item.get("context"))
   .and_then(Value::as_str)
   .unwrap_or("");
  let has_signed_kw = latest_context.contains("签收")
   || latest_context.contains("送达")
   || latest_context.contains("代收")
   || latest_context.contains("自提")
   || latest_context.contains("取件");
  if !has_signed_kw {
   if latest_context.contains("派送") || latest_context.contains("派件") {
    state_text = "派送中";
   } else if latest_context.contains("揽收") || latest_context.contains("收取") {
    state_text = "已揽收";
   } else {
    state_text = "在途中";
   }
  }
 }
 
 let signed = express_scalar(&v,"ischeck");
 let company_name=carrier_name(&company);
 let stamp_ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d|d.as_millis()).unwrap_or(0);
 Ok(json!({"success":true,"number":returned_number,"company":if company_name.is_empty(){company.as_str()}else{company_name},"companyName":company_name,"companyCode":company,"autoDetected":auto_detected,"state":state,"stateText":state_text,"traces":list,"source":"kuaidi100","orderVerified":order_verified,"verification":"provider-fields-only","providerStatus":status,"providerResult":express_scalar(&v,"result"),"providerChecked":signed,"queriedAtMs":stamp_ms}))
}

// ══════════════════════════════════════════════════════════════════════
// 域名可用性（阿里 DoH 查 NS 记录 + Verisign RDAP 查注册信息）
// ══════════════════════════════════════════════════════════════════════

pub fn domain(name: &str) -> Result<Value, String> {
    let d = name
        .trim()
        .trim_start_matches("http://")
        .trim_start_matches("https://")
        .trim_end_matches('/')
        .to_lowercase();
    let d = d.split('/').next().unwrap_or("").to_string();
    if !d.contains('.') || d.starts_with('.') || d.ends_with('.') {
        return Err("请输入完整域名，例如 example.com".into());
    }
    if d.contains(' ') {
        return Err("域名里不能有空格".into());
    }

    // ① DoH 查 NS：有 NS = 已被注册；NXDOMAIN = 很可能还没被注册
    let doh = format!("https://dns.alidns.com/resolve?name={}&type=NS", url_encode(&d));
    let v = http_json(&doh, 15)?;
    let status = v.get("Status").and_then(|x| x.as_i64()).unwrap_or(-1);
    let ns: Vec<String> = v
        .get("Answer")
        .and_then(|a| a.as_array())
        .map(|arr| {
            arr.iter()
                .filter(|x| x.get("type").and_then(|t| t.as_i64()) == Some(2))
                .filter_map(|x| x.get("data").and_then(|s| s.as_str()).map(|s| s.trim_end_matches('.').to_string()))
                .collect()
        })
        .unwrap_or_default();

    // NXDOMAIN(3) 或没有 NS 记录 → 未注册
    let registered = status == 0 && !ns.is_empty();
    let available = !registered;

    // ② 顺带查 A 记录（有没有在解析）
    let a_url = format!("https://dns.alidns.com/resolve?name={}&type=A", url_encode(&d));
    let a_records: Vec<String> = http_json(&a_url, 15)
        .ok()
        .and_then(|av| {
            av.get("Answer").and_then(|a| a.as_array()).map(|arr| {
                arr.iter()
                    .filter(|x| x.get("type").and_then(|t| t.as_i64()) == Some(1))
                    .filter_map(|x| x.get("data").and_then(|s| s.as_str()).map(|s| s.to_string()))
                    .collect::<Vec<_>>()
            })
        })
        .unwrap_or_default();

    // ③ .com/.net 再查 Verisign RDAP，能拿到注册与到期时间
    let mut rdap: Option<Value> = None;
    if d.ends_with(".com") {
        let url = format!("https://rdap.verisign.com/com/v1/domain/{}", url_encode(&d));
        if let Ok(r) = http_json(&url, 20) {
            let events: Vec<Value> = r
                .get("events")
                .and_then(|e| e.as_array())
                .map(|arr| {
                    arr.iter()
                        .map(|x| {
                            json!({
                                "action": x.get("eventAction").and_then(|s| s.as_str()).unwrap_or(""),
                                "date": x.get("eventDate").and_then(|s| s.as_str()).unwrap_or(""),
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();
            let registrar = r
                .get("entities")
                .and_then(|e| e.as_array())
                .and_then(|arr| {
                    arr.iter()
                        .filter(|x| {
                            x.get("roles")
                                .and_then(|ro| ro.as_array())
                                .map(|ro| ro.iter().any(|v| v.as_str() == Some("registrar")))
                                .unwrap_or(false)
                        })
                        .find_map(|x| {
                            x.get("vcardArray")
                                .and_then(|v| v.as_array())
                                .and_then(|a| a.get(1))
                                .and_then(|b| b.as_array())
                                .and_then(|cards| {
                                    cards.iter().find_map(|c| {
                                        let c = c.as_array()?;
                                        if c.first()?.as_str() == Some("fn") {
                                            c.get(3)?.as_str().map(|s| s.to_string())
                                        } else {
                                            None
                                        }
                                    })
                                })
                        })
                })
                .unwrap_or_default();
            let status: Vec<String> = r
                .get("status")
                .and_then(|s| s.as_array())
                .map(|arr| arr.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect())
                .unwrap_or_default();
            rdap = Some(json!({ "events": events, "registrar": registrar, "status": status }));
        }
    }

    Ok(json!({
        "success": true,
        "domain": d,
        "available": available,
        "registered": registered,
        "dnsStatus": status,
        "nameservers": ns,
        "aRecords": a_records,
        "rdap": rdap,
        "note": if available {
            "DNS 里查不到这个域名的 NS 记录，通常表示还没被注册 —— 但**最终以注册局的实时结果为准**，建议点下面的按钮去注册商那里确认一下。"
        } else {
            "这个域名已经被注册（有 NS 记录）。"
        },
    }))
}
