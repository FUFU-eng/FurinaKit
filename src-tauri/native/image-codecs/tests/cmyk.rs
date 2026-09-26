use std::path::PathBuf;
use furinakit_image_codecs::decode;
fn root()->PathBuf{PathBuf::from(std::env::var_os("FURINAKIT_CMYK_FIXTURES").expect("CMYK fixture root required"))}
fn fixture(name:&str)->Vec<u8>{std::fs::read(root().join(name)).unwrap()}
#[test]fn independent_littlecms_cmyk_jpeg_tiff_oracles(){
 let mut manifest:serde_json::Value=serde_json::from_slice(&fixture("manifest.json")).unwrap();let extra:serde_json::Value=serde_json::from_slice(&fixture("manifest-extra.json")).unwrap();manifest["cases"].as_array_mut().unwrap().extend(extra["cases"].as_array().unwrap().iter().cloned());
 for case in manifest["cases"].as_array().unwrap(){let name=case["name"].as_str().unwrap();let actual=decode::decode(&fixture(name),&||Ok(())).unwrap_or_else(|e|panic!("{name}: {e}"));assert_eq!(actual.image.width()as u64,case["width"].as_u64().unwrap());assert_eq!(actual.image.height()as u64,case["height"].as_u64().unwrap());assert_eq!(actual.source_depth as u64,case["depth"].as_u64().unwrap());if actual.source_depth==16{assert_eq!(actual.image.color(),image::ColorType::Rgb16);}
 let expected=fixture(case["oracle"].as_str().unwrap());let pixels=actual.image.to_rgb8().into_raw();assert_eq!(pixels.len(),expected.len());let max=pixels.iter().zip(&expected).map(|(a,b)|a.abs_diff(*b)).max().unwrap();println!("CMYK_ORACLE {name} max_RGB8_error={max}; notes={:?}",actual.notes);assert!(u64::from(max)<=case["tolerance"].as_u64().unwrap(),"{name}: error {max}");assert!(actual.notes.iter().any(|n|n.contains("CMYK")));}
}
#[test]fn cmyk_invalid_profile_space_chunks_and_cancel_fail_closed(){
 for name in ["bad-icc.tiff","wrong-space.tiff"]{assert!(decode::decode(&fixture(name),&||Ok(())).is_err(),"{name}");}
 let mut jpeg=fixture("adobe-icc.jpg");let p=jpeg.windows(12).position(|w|w==b"ICC_PROFILE\0").unwrap();jpeg[p+12]=0;assert!(decode::decode(&jpeg,&||Ok(())).err().unwrap().contains("ICC chunks"));
 assert!(decode::decode(&fixture("cmyk16-o1.tiff"),&||Err("cancel".into())).err().unwrap().contains("cancel"));
}
#[test]fn cmyk_mid_transform_cancel_and_jpeg_icc_budget(){
 use std::sync::atomic::{AtomicUsize,Ordering};let checks=AtomicUsize::new(0);let input=fixture("gradient-icc.tiff");let error=decode::decode(&input,&||if checks.fetch_add(1,Ordering::Relaxed)>=5{Err("mid-row-cancel".into())}else{Ok(())}).err().unwrap();assert!(error.contains("mid-row-cancel"));assert!(checks.load(Ordering::Relaxed)>5);
 let mut excessive=vec![0xff,0xd8];for seq in 1..=65u8{excessive.extend([0xff,0xe2,0xff,0xff]);excessive.extend(b"ICC_PROFILE\0");excessive.extend([seq,65]);excessive.resize(excessive.len()+65519,0);}excessive.extend([0xff,0xda]);assert!(decode::decode(&excessive,&||Ok(())).err().unwrap().contains("ICC exceeds 4 MiB"));
}
#[test]fn isolated_cmyk_to_png_preserves_orientation_colour_and_depth(){
 use furinakit_image_codecs::image_process::execute;let base=PathBuf::from(std::env::var_os("FURINAKIT_IMAGE_TEST_ROOT").unwrap());std::fs::create_dir_all(&base).unwrap();let scratch=furinakit_image_codecs::image_artifacts::Scratch::create(&base,&format!("cmyk-export-{}",std::process::id())).unwrap();let output=scratch.0.join("result.png");
 let request=serde_json::json!({"protocol":1,"tool":"image-format-convert","args":{"format":"png"},"input":root().join("cmyk16-o6.tiff"),"output":output});let result=execute(&PathBuf::from(env!("CARGO_BIN_EXE_furinakit-image-worker")),&request,&||Ok(())).unwrap();assert_eq!(result["sourceDepth"],16);assert_eq!(result["isolatedWorker"],true);let image=image::open(&output).unwrap();assert_eq!((image.width(),image.height()),(32,64));assert!(matches!(image.color(),image::ColorType::Rgb16|image::ColorType::Rgba16));let reference=fixture("cmyk16-o6.tiff.rgb");let actual=image.to_rgb8().into_raw();assert!(actual.iter().zip(reference).all(|(a,b)|a.abs_diff(b)<=3));
}
