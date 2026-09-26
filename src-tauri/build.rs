// 构建期把"构建时间"写进二进制。
//
// ★ 为什么需要它：作者和我被"到底跑的是哪一版"坑了很多轮 ——
//   这个应用有单实例保护，旧进程没关掉时，点快捷方式只会把旧窗口调到前台，
//   于是"明明改好了"却看不出变化。有了构建时间戳，界面上就能直接看到，
//   一眼就能确认跑的是哪一份，不用再猜。

fn main() {
    // Dynamic vendor libraries do not appear in ARCHPR's normal PE imports.
    // Fail closed before producing another installer which works only on a developer PC.
    for name in ["ARCHPR.exe", "elcom_reg.dll", "elcom_xml.dll", "elcom_lang.xml",
                 "elcom_partners.exml", "english.lng", "chinese_simp.lng", "english.dic",
                 "runtime-manifest.json", "BUNDLED-NOTICE.md"] {
        let resource = std::path::Path::new("tools/archpr").join(name);
        println!("cargo:rerun-if-changed={}", resource.display());
        assert!(std::fs::metadata(&resource).map(|m| m.is_file() && m.len() > 0).unwrap_or(false),
            "Missing required bundled ARCHPR resource: {}", resource.display());
    }
    println!("cargo:rerun-if-changed=../web/dist");
    println!("cargo:rerun-if-changed=../web/dist/index.html");

    // 构建时刻（本地时间，精确到秒）；同时给出一个更易读的短串
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    println!("cargo:rustc-env=FURINAKIT_BUILD_EPOCH={now}");

    // 用一条外部命令把 epoch 转成本地时间字符串（构建期生成，运行时不用管时区）
    let stamp = std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            &format!(
                "[DateTimeOffset]::FromUnixTimeSeconds({now}).ToLocalTime().ToString('yyyy-MM-dd HH:mm:ss')"
            ),
        ])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| now.to_string());
    println!("cargo:rustc-env=FURINAKIT_BUILD_TIME={stamp}");

    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/icon.png");
    tauri_build::build()
}
