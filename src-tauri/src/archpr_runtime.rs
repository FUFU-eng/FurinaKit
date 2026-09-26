//! Bundled ARCHPR runtime. No developer-machine paths, activation data or elevation.
use std::path::Path;

pub const REQUIRED_FILES: &[&str] = &[
    "ARCHPR.exe", "elcom_reg.dll", "elcom_xml.dll", "elcom_lang.xml",
    "elcom_partners.exml", "english.lng", "chinese_simp.lng", "english.dic",
];

pub fn validate_bundle(dir: &Path) -> Result<(), String> {
    let missing: Vec<_> = REQUIRED_FILES.iter().filter(|name| {
        !std::fs::metadata(dir.join(name)).map(|m| m.is_file() && m.len() > 0).unwrap_or(false)
    }).copied().collect();
    if missing.is_empty() { Ok(()) } else {
        Err(format!("内置压缩包恢复组件不完整，缺少：{}。请重新安装完整的 FurinaKit 安装包，不需要单独安装 ARCHPR。目录：{}", missing.join("、"), dir.display()))
    }
}

pub fn launch(exe: &Path) -> Result<u32, String> {
    let dir = exe.parent().ok_or("压缩包恢复组件路径无效")?;
    validate_bundle(dir)?;
    #[cfg(windows)]
    { win::launch(exe, dir) }
    #[cfg(not(windows))]
    { Err("ARCHPR 仅支持 Windows 桌面客户端".into()) }
}

#[cfg(windows)]
mod win {
    use super::*;
    use std::{ffi::c_void, os::windows::{ffi::OsStrExt, process::CommandExt}, path::PathBuf,
              process::Command, time::{Duration, Instant}};
    type Hwnd = *mut c_void;
    const HKCU: isize = -2147483647;
    const HKLM: isize = -2147483646;
    const COMMON_KEY: &str = r"Software\ElcomSoft\Common Files";

    #[link(name = "advapi32")]
    extern "system" {
        fn RegOpenKeyExW(key: isize, sub: *const u16, opt: u32, access: u32, result: *mut isize) -> i32;
        fn RegQueryValueExW(key: isize, name: *const u16, reserved: *mut u32, typ: *mut u32, data: *mut u8, size: *mut u32) -> i32;
        fn RegCreateKeyExW(key: isize, sub: *const u16, reserved: u32, class: *mut u16, options: u32, access: u32, security: *const c_void, result: *mut isize, disposition: *mut u32) -> i32;
        fn RegSetValueExW(key: isize, name: *const u16, reserved: u32, typ: u32, data: *const u8, size: u32) -> i32;
        fn RegCloseKey(key: isize) -> i32;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn ExpandEnvironmentStringsW(src: *const u16, dst: *mut u16, size: u32) -> u32;
    }
    #[link(name = "user32")]
    extern "system" {
        fn EnumWindows(callback: unsafe extern "system" fn(Hwnd, isize) -> i32, data: isize) -> i32;
        fn EnumChildWindows(hwnd: Hwnd, callback: unsafe extern "system" fn(Hwnd, isize) -> i32, data: isize) -> i32;
        fn GetWindowThreadProcessId(hwnd: Hwnd, pid: *mut u32) -> u32;
        fn GetClassNameW(hwnd: Hwnd, buf: *mut u16, size: i32) -> i32;
        fn GetWindowTextW(hwnd: Hwnd, buf: *mut u16, size: i32) -> i32;
        fn IsWindowVisible(hwnd: Hwnd) -> i32;
    }
    fn wide(s: &std::ffi::OsStr) -> Vec<u16> { s.encode_wide().chain(Some(0)).collect() }
    fn wz(s: &str) -> Vec<u16> { wide(std::ffi::OsStr::new(s)) }
    struct Key(isize);
    impl Drop for Key { fn drop(&mut self) { unsafe { RegCloseKey(self.0); } } }

    // Only the vendor's Location value is read. Never enumerate/copy registration or license keys.
    fn common_location(root: isize) -> Option<PathBuf> {
        unsafe {
            let mut h = 0;
            if RegOpenKeyExW(root, wz(COMMON_KEY).as_ptr(), 0, 0x20019 | 0x200, &mut h) != 0 { return None; }
            let h = Key(h);
            let mut kind = 0;
            let mut size = 0;
            if RegQueryValueExW(h.0, wz("Location").as_ptr(), std::ptr::null_mut(), &mut kind, std::ptr::null_mut(), &mut size) != 0
                || ![1, 2].contains(&kind) || size < 2 || size > 65536 { return None; }
            let mut text = vec![0u16; size as usize / 2 + 1];
            if RegQueryValueExW(h.0, wz("Location").as_ptr(), std::ptr::null_mut(), &mut kind, text.as_mut_ptr().cast(), &mut size) != 0 { return None; }
            if kind == 2 {
                let count = ExpandEnvironmentStringsW(text.as_ptr(), std::ptr::null_mut(), 0);
                if count == 0 || count > 32768 { return None; }
                let mut expanded = vec![0u16; count as usize];
                if ExpandEnvironmentStringsW(text.as_ptr(), expanded.as_mut_ptr(), count) == 0 { return None; }
                text = expanded;
            }
            text.truncate(text.iter().position(|&c| c == 0).unwrap_or(text.len()));
            use std::os::windows::ffi::OsStringExt;
            if text.is_empty() { None } else { Some(PathBuf::from(std::ffi::OsString::from_wide(&text))) }
        }
    }
    fn shared_present(dir: &Path) -> bool {
        ["elcom_reg.dll", "elcom_xml.dll", "elcom_lang.xml", "elcom_partners.exml"]
            .iter().all(|n| dir.join(n).is_file())
    }
    fn prepare_shared_location(dir: &Path) -> Result<(), String> {
        // Existing ElcomSoft installations belong to the user: do not replace a working
        // shared path with our older libraries. Clean machines use the bundled files via HKCU.
        if [HKLM, HKCU].iter().filter_map(|&root| common_location(root)).any(|p| shared_present(&p)) {
            return Ok(());
        }
        let full = std::fs::canonicalize(dir).map_err(|e| format!("无法定位内置组件：{e}"))?;
        // The old ANSI application cannot interpret the extended-length path prefix.
        let display = full.to_string_lossy();
        let path = display.strip_prefix(r"\\?\").unwrap_or(&display);
        if path.starts_with("UNC\\") { return Err("请将压缩包恢复组件放在本地磁盘后运行".into()); }
        unsafe {
            let mut h = 0;
            let rc = RegCreateKeyExW(HKCU, wz(COMMON_KEY).as_ptr(), 0, std::ptr::null_mut(), 0,
                0x0002 | 0x200, std::ptr::null(), &mut h, std::ptr::null_mut());
            if rc != 0 { return Err(format!("无法为当前用户配置内置组件路径（Windows 错误 {rc}），没有修改机器级设置。")); }
            let h = Key(h);
            let value = wz(path);
            let rc = RegSetValueExW(h.0, wz("Location").as_ptr(), 0, 1, value.as_ptr().cast(), (value.len() * 2) as u32);
            if rc != 0 { return Err(format!("保存当前用户组件路径失败（Windows 错误 {rc}）")); }
        }
        Ok(())
    }

    #[derive(Default)]
    struct Observation { pid: u32, main: bool, messages: Vec<String> }
    unsafe fn text(hwnd: Hwnd, class: bool) -> String {
        let mut buf = [0u16; 1024];
        let n = if class { GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as i32) }
            else { GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32) };
        String::from_utf16_lossy(&buf[..n.max(0) as usize])
    }
    unsafe extern "system" fn child_text(hwnd: Hwnd, data: isize) -> i32 {
        let obs = &mut *(data as *mut Observation);
        // Only static dialog messages, never password/edit controls or license input.
        if text(hwnd, true).eq_ignore_ascii_case("Static") {
            let s = text(hwnd, false);
            if !s.is_empty() { obs.messages.push(s); }
        }
        1
    }
    unsafe extern "system" fn window(hwnd: Hwnd, data: isize) -> i32 {
        let obs = &mut *(data as *mut Observation);
        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid != obs.pid || IsWindowVisible(hwnd) == 0 { return 1; }
        let class = text(hwnd, true);
        if class == "ARCHPRClass" { obs.main = true; }
        if class == "#32770" { EnumChildWindows(hwnd, child_text, data); }
        1
    }
    pub(super) fn launch(exe: &Path, dir: &Path) -> Result<u32, String> {
        prepare_shared_location(dir)?;
        let mut child = Command::new(exe).current_dir(dir).creation_flags(0x08000000)
            .stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null())
            .spawn().map_err(|e| format!("启动内置 ARCHPR 失败：{e}"))?;
        let deadline = Instant::now() + Duration::from_secs(12);
        let mut ready_observations = 0;
        loop {
            if let Some(status) = child.try_wait().map_err(|e| format!("读取启动状态失败：{e}"))? {
                return Err(format!("ARCHPR 在主窗口就绪前退出（{status}）。请重新安装完整安装包；程序未被判为启动成功。"));
            }
            let mut obs = Observation { pid: child.id(), ..Default::default() };
            unsafe { EnumWindows(window, &mut obs as *mut Observation as isize); }
            if let Some(error) = obs.messages.iter().find(|s| {
                let t = s.to_ascii_lowercase();
                t.contains("cannot load") || t.contains("cannot find file") || t.contains("installation is corrupted")
            }) {
                return Err(format!("ARCHPR 启动失败：{error}。内置组件目录：{}。若此电脑已安装其他 ElcomSoft 产品，请检查其共享组件安装；不要从 DLL 下载站补文件。", dir.display()));
            }
            if obs.main { ready_observations += 1; } else { ready_observations = 0; }
            if ready_observations >= 3 { return Ok(child.id()); }
            if Instant::now() >= deadline {
                return Err("已发出 ARCHPR 启动请求，但尚未确认主窗口就绪。请检查弹出的工具窗口，不要连续重复启动。".into());
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missing_bundle_is_not_a_success() {
        let p = std::env::temp_dir().join(format!("furinakit-archpr-test-{}", std::process::id()));
        assert!(!p.exists());
        std::fs::create_dir(&p).unwrap();
        let result = (|| {
            let error = validate_bundle(&p).unwrap_err();
            assert!(error.contains("elcom_reg.dll"));
            for n in REQUIRED_FILES { std::fs::write(p.join(n), b"test fixture, not executable").unwrap(); }
            assert!(validate_bundle(&p).is_ok());
            std::fs::write(p.join("elcom_xml.dll"), b"").unwrap();
            assert!(validate_bundle(&p).unwrap_err().contains("elcom_xml.dll"));
        })();
        std::fs::remove_dir_all(&p).unwrap();
        result
    }
}
