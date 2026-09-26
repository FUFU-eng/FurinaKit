#[cfg(test)]
mod worker_contract_tests {
    use crate::artifact_store::{resolve, valid_worker_basename};
    use std::{fs, path::PathBuf};
    use serde_json::json;
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("fk-v48-artifact-{}", crate::jobs::new_job_id_public()));
            fs::create_dir_all(root.join("results")).unwrap(); Self(root)
        }
        fn output(&self, name: &str, bytes: &[u8]) -> PathBuf {
            let p = self.0.join("results").join(name); fs::write(&p, bytes).unwrap(); p
        }
    }
    impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
    #[test]
    fn worker_filename_only_reads_utf8_and_json() {
        let f = Fixture::new();
        for (name, text) in [("识别结果.txt", "FurinaKit 公共测试\n第二行"), ("ocr.json", "{\"text\":\"公开文字\",\"lines\":[]}")] {
            let p = f.output(&format!("abc-123-{name}"), text.as_bytes());
            let job = json!({"id":"abc-123", "status":"completed", "resultFilename":name});
            assert_eq!(resolve(&f.0, &job), Some(fs::canonicalize(p).unwrap()));
            assert_eq!(fs::read_to_string(resolve(&f.0, &job).unwrap()).unwrap(), text);
        }
    }
    #[test]
    fn worker_paths_are_not_guessed_or_taken_from_other_jobs() {
        let f = Fixture::new(); f.output("def-456-result.txt", b"other job");
        f.output("result.txt", b"unowned"); f.output("prefix-abc-123-result.txt", b"ambiguous");
        let job = json!({"id":"abc-123","status":"completed","resultFilename":"result.txt"});
        assert!(resolve(&f.0,&job).is_none());
        let owned = f.output("abc-123-result.txt", b"owned");
        assert!(resolve(&f.0,&job).is_some());
        for status in ["pending","processing","failed","cancelled"] {
            let mut bad=job.clone();bad["status"]=json!(status); assert!(resolve(&f.0,&bad).is_none());
        }
        for id in ["", "../abc", "abc/123", "abc:123"] {
            let mut bad=job.clone();bad["id"]=json!(id);assert!(resolve(&f.0,&bad).is_none());
        }
        fs::write(owned,b"").unwrap();assert!(resolve(&f.0,&job).is_none());
    }
    #[test]
    fn rejects_filename_traversal_ads_and_windows_aliases() {
        let f=Fixture::new();
        for name in ["", ".", "..", "../secret", "x/secret", "x\\secret", "C:\\secret", "C:secret", "/secret", "\\\\host\\share", "foo:stream", "foo.", "foo ", "x\0.txt", "x\n.txt", "*.txt", "?.txt", "CON", "nul.txt", "COM1.txt", "LPT9"] {
            let job=json!({"id":"abc-123","status":"completed","resultFilename":name});
            assert!(!valid_worker_basename(name), "{name:?}");
            assert!(resolve(&f.0,&job).is_none(), "{name:?}");
        }
    }
    #[test]
    fn explicit_invalid_path_never_falls_back_to_filename() {
        let f=Fixture::new();f.output("abc-123-result.txt",b"valid fallback must not be used");
        for value in [json!(""),json!("missing"),json!(123),json!(null)] {
            let job=json!({"id":"abc-123","status":"completed","resultFilename":"result.txt","resultPath":value});
            assert!(resolve(&f.0,&job).is_none());
        }
    }
    #[test]
    fn directory_is_not_a_result() {
        let f=Fixture::new();fs::create_dir(f.0.join("results/abc-123-folder")).unwrap();
        assert!(resolve(&f.0,&json!({"id":"abc-123","status":"completed","resultFilename":"folder"})).is_none());
    }
    #[test]
    #[cfg_attr(windows, ignore = "requires Windows symlink privilege; not counted as verified on this host")]
    fn symlink_cannot_escape_or_claim_another_result() {
        let f=Fixture::new();let other=f.output("def-456-private.txt",b"other job");
        let link=f.0.join("results/abc-123-result.txt");
        #[cfg(unix)] std::os::unix::fs::symlink(&other,&link).unwrap();
        #[cfg(windows)] {
            std::os::windows::fs::symlink_file(&other,&link).unwrap();
        }
        assert!(resolve(&f.0,&json!({"id":"abc-123","status":"completed","resultFilename":"result.txt"})).is_none());
    }
}
