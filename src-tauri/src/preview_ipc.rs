//! Narrow application-command policy for the isolated Settings validation profile.
//! Plugin IPC is separate: risky plugins must not be initialized in that profile.
use serde_json::Value;
pub fn command_allowed(isolated:bool,name:&str)->bool{
 !isolated || matches!(name,"app_is_ready"|"count_tools"|"get_build_info"|"get_ui_language"|"window_is_maximized"|"set_window_theme"|"window_frontend_ready"|"telemetry_enabled"|"application_updates_allowed"|"api_call"|"preview_activate_main"|"window_minimize"|"window_toggle_maximize"|"window_hide")
}
pub fn api_allowed(isolated:bool,path:&str,method:&str,args:&Value)->bool{
 if !isolated{return true;}
 let Some(obj)=args.as_object()else{return false;};
 match (path,method){
  ("/api/components"|"/api/tts/components"|"/api/worker-extension/catalog"|"/api/worker-extension/download","GET")=>obj.is_empty(),
  ("/api/worker-extension/download","POST")=>match obj.get("action").and_then(Value::as_str){
   Some("download")=>obj.len()==2&&obj.get("acknowledged")==Some(&Value::Bool(true)),
   Some("cancel")=>obj.len()==2&&obj.get("id").and_then(Value::as_str).is_some_and(|s|!s.is_empty()&&s.len()<=128),
   _=>false,
  },
  _=>false,
 }
}
#[cfg(test)]mod tests{
 use super::*;use serde_json::json;
 #[test]fn production_dispatch_remains_unrestricted(){assert!(command_allowed(false,"future-command"));assert!(api_allowed(false,"/arbitrary","POST",&Value::Null));}
 #[test]fn unknown_clipboard_files_shell_updates_and_floatball_denied(){for s in ["future-command","clipboard_read","clipboard_write","read_file_data_url","open_path","open_external","install_update","download_update","pick_file","begin_upload","sync_float_ball_preferences","set_float_ball_visible","open_utility_window","notes_command","save_global_shortcuts","recorder_start"]{assert!(!command_allowed(true,s),"{s}");}}
 #[test]fn reviewed_presentation_commands_admitted(){for s in ["app_is_ready","count_tools","get_build_info","get_ui_language","window_is_maximized","set_window_theme","window_frontend_ready","telemetry_enabled","application_updates_allowed","api_call","preview_activate_main","window_minimize","window_toggle_maximize","window_hide"]{assert!(command_allowed(true,s));}}
 #[test]fn command_aliases_not_normalized(){for s in ["API_CALL","api_call ","plugin:fs|read_file","plugin:shell|open","window_show"]{assert!(!command_allowed(true,s));}}
 #[test]fn only_reviewed_empty_gets_admitted(){for path in ["/api/components","/api/tts/components","/api/worker-extension/catalog","/api/worker-extension/download"]{assert!(api_allowed(true,path,"GET",&json!({})));assert!(!api_allowed(true,path,"GET",&json!({"action":"download"})));}}
 #[test]fn path_method_and_payload_ambiguity_rejected(){for path in ["/api/components/","/api/components?x=1","/api/tts/voices","/api/output-dir","/api/tools/pdf-to-word","/api/worker-extension/import"]{assert!(!api_allowed(true,path,"GET",&json!({})));}for method in ["get","HEAD","PUT","DELETE","POST"]{assert!(!api_allowed(true,"/api/components",method,&json!({})));}assert!(!api_allowed(true,"/api/components","GET",&Value::Null));}
 #[test]fn explicit_download_only_no_runtime_overrides(){let p="/api/worker-extension/download";assert!(api_allowed(true,p,"POST",&json!({"action":"download","acknowledged":true})));for a in [json!({"action":"download"}),json!({"action":"download","acknowledged":"true"}),json!({"action":"download","acknowledged":true,"url":"https://bad.invalid"}),json!({"action":"download","acknowledged":true,"destination":"elsewhere"})]{assert!(!api_allowed(true,p,"POST",&a));}}
 #[test]fn cancellation_must_reference_owned_controller_id(){let p="/api/worker-extension/download";assert!(api_allowed(true,p,"POST",&json!({"action":"cancel","id":"current-controller-id"})));for a in [json!({"action":"cancel","id":""}),json!({"action":"cancel"}),json!({"action":"delete","id":"x"}),json!({"action":"cancel","id":"x","root":"elsewhere"})]{assert!(!api_allowed(true,p,"POST",&a));}}
}
