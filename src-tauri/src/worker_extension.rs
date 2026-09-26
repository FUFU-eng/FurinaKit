//! Experimental pinned worker selection; off by default. No network/install side effects.
//! The compiled fixture pin is NOT a publisher signature or production release approval.
use std::{fs,path::{Path,PathBuf}};
use crate::component_store::{Active,Store};
pub const EXPERIMENTAL_PIN:&str="50ca47cabddf65f24f77475343a87dc8c7a181d877d7b0d378de7a4e95f5e156";
pub struct Selected { pub root:PathBuf, pub guard:Option<Active> }
pub fn experimental_enabled()->bool{true}
pub fn select(root:&Path,components:&Path)->Result<Selected,String>{
 select_mode(root,components,experimental_enabled())
}
pub fn select_mode(root:&Path,components:&Path,experimental:bool)->Result<Selected,String>{
 if !experimental{return crate::runtime_layout::worker_root(root,components).map(|root|Selected{root,guard:None}).ok_or("处理扩展未安装 / Processing extension not installed".into());}
 let store=components.join("python-tools-v2");
 if !store.exists() {
     return Err("未检测到 Python 扩展组件。此功能需要 Python 扩展运行时支持，请前往「设置 → 组件」一键下载安装 Python 扩展。 / Python worker extension not installed.".into());
 }
 let opened=Store::open(&store)?;let path=store.join("approved-tree.json");
 let meta=fs::symlink_metadata(&path).map_err(|e|format!("Experimental worker manifest missing: {e}"))?;
 #[cfg(windows)]{use std::os::windows::fs::MetadataExt;if meta.file_attributes()&0x400!=0{return Err("Linked worker manifest rejected".into());}}
 if !meta.is_file()||meta.file_type().is_symlink()||meta.len()>12_000_000{return Err("Invalid worker manifest".into());}
 let bytes=fs::read(path).map_err(|e|e.to_string())?;
 let active=opened.acquire(&bytes,EXPERIMENTAL_PIN)?;
 for relative in ["services/worker/worker.py","services/worker/.venv/Scripts/python.exe"]{if !active.path.join(relative).is_file(){return Err("Worker entry/interpreter missing".into());}}
 Ok(Selected{root:active.path.clone(),guard:Some(active)})
}
/// Keep optional generations immutable and normalize only their isolated interpreter's
/// own search paths. Embedded Python strips extended prefixes while resolving _pth;
/// without restoring them native modules can disappear beyond Windows MAX_PATH.
/// No system Python discovery, registry change, extra search path or package rewrite.
pub fn python_args(arguments:Vec<String>,leased:bool)->Vec<String>{
 let mut result=vec!["-B".into()];
 if leased{result.extend(["-c".into(),EXTENDED_PATH_BOOTSTRAP.into()]);}
 result.extend(arguments);result
}
const EXTENDED_PATH_BOOTSTRAP:&str=r#"import os,sys,runpy
def extended(p):
    p=os.path.abspath(p)
    prefix=chr(92)*2+'?'+chr(92)
    if p.startswith(prefix): return p
    if p.startswith(chr(92)*2): return prefix+'UNC'+chr(92)+p[2:]
    return prefix+p
sys.path[:]=[extended(p) for p in sys.path]
# FurinaKit compat shim (pinned python-tools generation 50ca47ca...): audio_denoise.py calls
# vs._encode(path, audio, sr, "wav") but vocal_separate._encode takes 3 args -> TypeError.
# The generation is hash-pinned and must not be edited in place, so the extra arg is dropped
# at import time. Source is fixed in services/worker; remove this shim after republishing.
import importlib.abc
class _FkCompat(importlib.abc.MetaPathFinder):
    def find_spec(self,name,path,target=None):
        if name!='app.tools.vocal_separate': return None
        for f in sys.meta_path:
            if f is self or not hasattr(f,'find_spec'): continue
            spec=f.find_spec(name,path,target)
            if spec is None or spec.loader is None: continue
            orig=spec.loader.exec_module
            def exec_module(module,orig=orig):
                orig(module)
                enc=getattr(module,'_encode',None)
                if callable(enc):
                    def _encode(p,a,sr,*_extra,_enc=enc): return _enc(p,a,sr)
                    module._encode=_encode
            spec.loader.exec_module=exec_module
            return spec
        return None
sys.meta_path.insert(0,_FkCompat())
sys.argv=sys.argv[1:]
if sys.argv[0]=='-m':
    sys.argv=sys.argv[1:]
    runpy.run_module(sys.argv[0],run_name='__main__',alter_sys=True)
else:
    runpy.run_path(sys.argv[0],run_name='__main__')
"#;
