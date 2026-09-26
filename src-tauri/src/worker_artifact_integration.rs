use super::*;
use std::{fs, path::PathBuf};
use serde_json::Value;

#[test]
#[ignore = "requires freshly generated public worker fixtures; run explicitly with FK_V48_FIXTURE"]
fn real_worker_artifacts_resolve_preview_and_export() {
    let root=PathBuf::from(std::env::var("FK_V48_FIXTURE").expect("explicit isolated fixture root"));
    for id in ["abc04801-0000-4000-8000-000000000001", "abc04802-0000-4000-8000-000000000002"] {
        let job:Value=serde_json::from_slice(&fs::read(root.join("jobs").join(format!("{id}.json"))).unwrap()).unwrap();
        assert_eq!(job["status"], "completed");assert!(job.get("resultPath").is_none());
        let path=crate::artifact_store::resolve(&root,&job).expect("real filename-only worker artifact must resolve");
        let original=fs::read(&path).unwrap();
        if id.ends_with('1') {
            let ocr:Value=serde_json::from_slice(&original).unwrap();
            assert!(ocr["text"].as_str().unwrap().contains("2026"));
            assert!(ocr["text"].as_str().unwrap().contains("12345"));
            assert!(!ocr["lines"].as_array().unwrap().is_empty());
        } else {
            assert_eq!(mime(&path),Some("video/mp4"));
            let request=|method:&str,range:Option<&str>| {
                let mut b=Request::builder().method(method);
                if let Some(r)=range {b=b.header("Range",r);} b.body(vec![]).unwrap()
            };
            let head=serve(File::open(&path).unwrap(),"video/mp4",&request("HEAD",None));
            assert_eq!(head.status(),200);assert!(head.body().is_empty());
            assert_eq!(head.headers()["Content-Length"],original.len().to_string());
            let full=serve(File::open(&path).unwrap(),"video/mp4",&request("GET",None));
            assert_eq!(full.status(),200);assert_eq!(full.body(),&original);
            for (range,start,end) in [("bytes=0-31",0,32),("bytes=-32",original.len()-32,original.len()),("bytes=1000-1999",1000,2000)] {
                let response=serve(File::open(&path).unwrap(),"video/mp4",&request("GET",Some(range)));
                assert_eq!(response.status(),206);assert_eq!(response.body(),&original[start..end]);
            }
            let bad=serve(File::open(&path).unwrap(),"video/mp4",&request("GET",Some("bytes=999999999-")));
            assert_eq!(bad.status(),416);
        }
        let destination=root.join(format!("export-{}",job["resultFilename"].as_str().unwrap()));
        crate::job_export::copy_result(&path,&destination).unwrap();
        assert_eq!(fs::read(&destination).unwrap(),original);
        assert_eq!(fs::read(&path).unwrap(),original);
        assert!(crate::job_export::copy_result(&path,&path).is_err());
    }
}
