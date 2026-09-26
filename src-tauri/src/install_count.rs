//! Anonymous first-install counters used by the author's existing dashboard.
//! No file contents, paths, identifiers, keys or document names are transmitted.
use std::{fs,path::Path,process::Command};
use serde::{Deserialize,Serialize};
use tauri::Manager;
#[derive(Default,Serialize,Deserialize)]
#[serde(default,rename_all="camelCase")]
struct State{abacus:bool,count_api:bool,migrated_from_previous_install:bool}
fn valid_counter(bytes:&[u8])->bool{
    serde_json::from_slice::<serde_json::Value>(bytes).ok()
        .and_then(|v|v.get("value").and_then(|n|n.as_u64())).is_some()
}
fn previously_reported(path:&Path)->bool{
    fs::read(path).ok().and_then(|b|serde_json::from_slice::<serde_json::Value>(&b).ok())
        .is_some_and(|v|v.get("installedReported").and_then(|x|x.as_bool())==Some(true))
}
// Installed Electron 2.0.6 used @furinakit/web; early/development builds used FurinaKit.
// Read only the previous installation marker, not profile contents or identifiers.
fn previous_install_reported(directory:&Path)->bool{
    if previously_reported(&directory.join("settings.json")){return true;}
    let Some(roaming)=directory.parent() else{return false;};
    [roaming.join("@furinakit").join("web"),roaming.join("FurinaKit")]
        .iter().any(|root|previously_reported(&root.join("furinakit-settings.json")))
}
#[tauri::command]
pub fn telemetry_enabled()->bool{crate::startup_policy::current().ancillary && std::env::var("FURINAKIT_DISABLE_TELEMETRY").as_deref()!=Ok("1")}
pub fn start(app:&tauri::AppHandle){
    if !telemetry_enabled(){return;}
    let Ok(directory)=app.path().app_data_dir() else{return;};
    std::thread::spawn(move ||{
        if fs::create_dir_all(&directory).is_err(){return;}
        let path=directory.join("installation-counters-v1.json");
        let mut state:State=fs::read(&path).ok().and_then(|b|serde_json::from_slice(&b).ok()).unwrap_or_default();
        if state.abacus&&state.count_api{return;}
        if previous_install_reported(&directory){
            state.abacus=true;state.count_api=true;state.migrated_from_previous_install=true;
            if let Ok(bytes)=serde_json::to_vec_pretty(&state){let _=crate::atomic_store::write(&path,&bytes);}return;
        }
        for (id,url) in [
            ("countApi","https://countapi.mileshilliard.com/api/v1/hit/furinakit_prod_installs_v2"),
            ("abacus","https://abacus.jasoncameron.dev/hit/furinakit_prod/installs")]{
            if (id=="countApi"&&state.count_api)||(id=="abacus"&&state.abacus){continue;}
            let mut command=Command::new("curl");
            command.args(["--disable","--silent","--show-error","--fail","--proto","=https","--connect-timeout","5","--max-time","10","--max-filesize","16384","--user-agent",concat!("FurinaKit/",env!("CARGO_PKG_VERSION")),url]);
            crate::commands::no_window(&mut command);
            if let Ok(output)=command.output(){
                if output.status.success()&&valid_counter(&output.stdout){
                    if id=="countApi"{state.count_api=true;}else{state.abacus=true;}
                    if let Ok(bytes)=serde_json::to_vec_pretty(&state){let _=crate::atomic_store::write(&path,&bytes);}
                }
            }
        }
    });
}
#[cfg(test)]mod tests{
    use super::*;
    #[test]fn only_valid_counter_responses_mark_success(){
        assert!(valid_counter(br#"{"value":12}"#));
        assert!(valid_counter(br#"{"value":0,"status":"success"}"#));
        assert!(!valid_counter(br#"{"error":"unavailable"}"#));
        assert!(!valid_counter(b"<html>gateway error</html>"));
    }
    #[test]fn old_install_marker_prevents_upgrade_double_count(){
        let root=std::env::temp_dir().join(format!("fk-count-test-{}",uuid::Uuid::new_v4()));fs::create_dir(&root).unwrap();let p=root.join("settings.json");
        assert!(!previously_reported(&p));fs::write(&p,br#"{"installedReported":true}"#).unwrap();assert!(previously_reported(&p));fs::remove_dir_all(root).unwrap();
    }
    #[test]fn both_electron_profile_locations_prevent_upgrade_double_count(){
        let root=std::env::temp_dir().join(format!("fk-count-migration-{}",uuid::Uuid::new_v4()));
        let native=root.join("com.furinakit.app");fs::create_dir_all(&native).unwrap();
        assert!(!previous_install_reported(&native));
        for legacy in [root.join("@furinakit/web"),root.join("FurinaKit")]{
            fs::create_dir_all(&legacy).unwrap();let marker=legacy.join("furinakit-settings.json");
            fs::write(&marker,br#"{"installedReported":false}"#).unwrap();assert!(!previous_install_reported(&native));
            fs::write(&marker,br#"{"installedReported":true}"#).unwrap();assert!(previous_install_reported(&native));
            fs::remove_file(marker).unwrap();
        }
        fs::write(native.join("settings.json"),br#"{"installedReported":true}"#).unwrap();
        assert!(previous_install_reported(&native));fs::remove_dir_all(root).unwrap();
    }

}
