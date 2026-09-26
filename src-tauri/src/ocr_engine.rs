// Portions adapted from RapidOCR (SWHL) and PaddleOCR, Apache-2.0.
// Copyright (c) 2020 PaddlePaddle Authors. All Rights Reserved.
// See licenses/ocr-NOTICE.md and licenses/ocr-Apache-2.0-LICENSE.txt.
//! Native PP-OCRv3 detection/recognition and v2 direction classification.
//! Pipeline parameters follow the existing RapidOCR release, not a model upgrade.
use std::{path::{Path,PathBuf},sync::{Mutex,OnceLock,TryLockError},time::{Duration,SystemTime}};
use image::RgbImage;
use ort::{session::{Session,builder::GraphOptimizationLevel},value::Tensor};
use serde::Deserialize;
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use super::{ocr_geometry::{self,Point,Quad},ocr_pixels};

#[derive(Deserialize)]
struct Model {name:String,bytes:u64,sha256:String}
#[derive(Deserialize)]
struct Manifest {files:Vec<Model>}
fn manifest()->Result<Manifest,String>{serde_json::from_str(include_str!("../models/ocr-v3/manifest.json")).map_err(|e|format!("OCR model manifest: {e}"))}
#[derive(PartialEq,Eq)]
struct Key {root:PathBuf,requested:String,files:Vec<(u64,Option<SystemTime>)>}
struct Cached {key:Key,engine:Engine}
struct Engine {det:Session,cls:Session,rec:Session,characters:Vec<String>,provider:&'static str}
fn cache()->&'static Mutex<Option<Cached>>{static CACHE:OnceLock<Mutex<Option<Cached>>>=OnceLock::new();CACHE.get_or_init(||Mutex::new(None))}
fn err(e:impl std::fmt::Display)->String{format!("OCR 推理引擎错误 / OCR inference engine error: {e}")}

fn session(bytes:&[u8],gpu:bool)->Result<Session,String>{
    let threads=std::thread::available_parallelism().map(|n|n.get()).unwrap_or(1).min(4);
    let mut builder=Session::builder().map_err(err)?
        .with_optimization_level(GraphOptimizationLevel::All).map_err(err)?
        .with_intra_threads(threads).map_err(err)?
        .with_parallel_execution(false).map_err(err)?
        .with_memory_pattern(false).map_err(err)?;
    if gpu{
        builder=builder.with_execution_providers([ort::ep::DirectML::default().build().error_on_failure()]).map_err(err)?;
    }else{
        builder=builder.with_execution_providers([ort::ep::CPU::default().build().error_on_failure()]).map_err(err)?;
    }
    builder.commit_from_memory(bytes).map_err(err)
}
impl Engine{
    fn load(root:&Path,gpu:bool,check:&dyn Fn()->Result<(),String>)->Result<Self,String>{
        let mut load=|name:&str|->Result<Session,String>{
            check()?;
            let m=manifest()?.files.into_iter().find(|m|m.name==name).ok_or("OCR model missing from manifest")?;
            let path=root.join(&m.name);let bytes=std::fs::read(&path).map_err(|e|format!("OCR 模型缺失，请修复原生安装包 / OCR model missing; repair the native package: {}: {e}",m.name))?;
            if bytes.len() as u64!=m.bytes||format!("{:x}",Sha256::digest(&bytes))!=m.sha256{return Err(format!("OCR 模型校验失败 / OCR model integrity check failed: {}",m.name));}
            session(&bytes,gpu)
        };
        let det=load("ch_PP-OCRv3_det_infer.onnx")?;
        let cls=load("ch_ppocr_mobile_v2.0_cls_infer.onnx")?;
        let rec=load("ch_PP-OCRv3_rec_infer.onnx")?;
        let dictionary=rec.metadata().map_err(err)?.custom("character").ok_or("OCR 模型缺少字符字典 / OCR model has no character dictionary")?;
        let mut characters=vec![String::new()];characters.extend(dictionary.lines().map(str::to_owned));characters.push(" ".into());
        if characters.len()<3{return Err("OCR character dictionary is empty".into());}
        Ok(Self{det,cls,rec,characters,provider:if gpu{"directml"}else{"cpu"}})
    }
    fn infer(session:&mut Session,n:usize,h:usize,w:usize,data:Vec<f32>)->Result<(Vec<usize>,Vec<f32>),String>{
        let name=session.inputs().first().ok_or("OCR model has no input")?.name().to_owned();
        let tensor=Tensor::from_array(([n,3,h,w],data)).map_err(err)?;
        let outputs=session.run(ort::inputs![name.as_str()=>tensor]).map_err(err)?;
        let output=outputs.iter().next().ok_or("OCR model has no output")?.1;
        let (shape,values)=output.try_extract_tensor::<f32>().map_err(err)?;
        let shape=shape.iter().map(|d|usize::try_from(*d).map_err(err)).collect::<Result<Vec<_>,_>>()?;
        if values.iter().any(|x|!x.is_finite()){return Err("OCR 输出含非有限值 / OCR returned non-finite output".into());}
        Ok((shape,values.to_vec()))
    }
    fn recognize(&mut self,img:&RgbImage,low:f64,check:&dyn Fn()->Result<(),String>,progress:&dyn Fn(u32,&str))->Result<Value,String>{
        check()?;progress(15,"正在检测文字区域 / Detecting text regions");
        let (w,h)=(img.width(),img.height());
        let boxes:Vec<Quad>=if h<=30||w as f64/h as f64>8.{
            vec![[Point{x:0.,y:0.},Point{x:w as f64,y:0.},Point{x:w as f64,y:h as f64},Point{x:0.,y:h as f64}]]
        }else{
            let (data,dh,dw)=ocr_pixels::detection_tensor(img,check)?;
            let (shape,map)=Self::infer(&mut self.det,1,dh,dw,data)?;check()?;
            if shape.len()!=4||shape[0]!=1||shape[1]!=1||shape[2]==0||shape[3]==0||shape[2].saturating_mul(shape[3])!=map.len(){return Err("OCR 检测输出形状不兼容 / Incompatible OCR detection output".into());}
            ocr_geometry::boxes(&map,shape[3],shape[2],w,h,check)?
        };
        let mut crops=Vec::with_capacity(boxes.len());let mut crop_pixels=0u64;
        for q in &boxes{
            check()?;
            let crop=if h<=30||w as f64/h as f64>8.{img.clone()}else{ocr_pixels::crop(img,q,check)?};
            crop_pixels+=crop.width() as u64*crop.height() as u64;
            if crop_pixels>40_000_000{return Err("文字区域过多，请分区域识别 / Too many text regions; recognize smaller regions".into());}
            crops.push(crop);
        }
        let mut indices:Vec<usize>=(0..crops.len()).collect();
        indices.sort_by(|a,b| (crops[*a].width() as f64/crops[*a].height() as f64).total_cmp(&(crops[*b].width() as f64/crops[*b].height() as f64)));
        progress(35,"正在校正文字方向 / Classifying text direction");
        for batch in indices.chunks(6){
            check()?;let mut data=vec![0f32;batch.len()*3*48*192];
            for(i,index)in batch.iter().enumerate(){ocr_pixels::normalize_crop(&crops[*index],192,&mut data[i*3*48*192..(i+1)*3*48*192],check)?;}
            let(shape,values)=Self::infer(&mut self.cls,batch.len(),48,192,data)?;check()?;
            if shape!=[batch.len(),2]||values.len()!=batch.len()*2{return Err("OCR 方向输出形状不兼容 / Incompatible OCR direction output".into());}
            for(i,index)in batch.iter().enumerate(){if values[2*i+1]>values[2*i]&&values[2*i+1]>0.9{crops[*index]=image::imageops::rotate180(&crops[*index]);}}
        }
        let mut results=vec![(String::new(),0f64);crops.len()];
        for (b,batch) in indices.chunks(6).enumerate(){
            check()?;progress(45+(45*b*6/crops.len().max(1)) as u32,"正在识别文字 / Recognizing text");
            let ratio=batch.iter().map(|i|crops[*i].width() as f64/crops[*i].height() as f64).fold(0f64,f64::max);
            let width=(48.*ratio).trunc().max(1.) as usize;
            if width>16384{return Err("OCR 文本行过长，请分段识别 / OCR text line too long; split into smaller regions".into());}
            let stride=3*48*width;let mut data=vec![0f32;batch.len()*stride];
            for(i,index)in batch.iter().enumerate(){ocr_pixels::normalize_crop(&crops[*index],width,&mut data[i*stride..(i+1)*stride],check)?;}
            let(shape,values)=Self::infer(&mut self.rec,batch.len(),48,width,data)?;check()?;
            if shape.len()!=3||shape[0]!=batch.len()||shape[2]!=self.characters.len()||shape.iter().product::<usize>()!=values.len(){return Err("OCR 识别输出与字典不匹配 / OCR output does not match its character dictionary".into());}
            let classes=shape[2];let steps=shape[1];
            for(i,index)in batch.iter().enumerate(){
                let mut previous=usize::MAX;let mut text=String::new();let mut sum=0f64;let mut count=0usize;
                for t in 0..steps{
                    let row=&values[(i*steps+t)*classes..(i*steps+t+1)*classes];
                    let mut best=0;for k in 1..classes{if row[k]>row[best]{best=k;}}
                    if best!=0&&best!=previous{text.push_str(&self.characters[best]);sum+=row[best] as f64;count+=1;}
                    previous=best;
                }
                // Match deployed RapidOCR's mean(conf_list + [1e-50]), including its extra denominator.
                results[*index]=(text,(sum+1e-50)/(count+1) as f64);
            }
        }
        let mut lines=Vec::new();let mut score_sum=0.;let mut low_count=0;
        for(q,(text,score))in boxes.iter().zip(results){
            if text.is_empty()||score<0.5{continue;}
            let rounded=(score*10000.).round_ties_even()/10000.;score_sum+=rounded;if rounded<low{low_count+=1;}
            let x0=q.iter().map(|p|p.x).fold(f64::INFINITY,f64::min).round_ties_even() as i64;
            let x1=q.iter().map(|p|p.x).fold(f64::NEG_INFINITY,f64::max).round_ties_even() as i64;
            let y0=q.iter().map(|p|p.y).fold(f64::INFINITY,f64::min).round_ties_even() as i64;
            let y1=q.iter().map(|p|p.y).fold(f64::NEG_INFINITY,f64::max).round_ties_even() as i64;
            lines.push(json!({"text":text,"score":rounded,"box":[x0,y0,x1,y1]}));
        }
        let text=lines.iter().filter_map(|line|line["text"].as_str()).collect::<Vec<_>>().join("\n");
        let average=if lines.is_empty(){0.}else{(score_sum/lines.len() as f64*10000.).round_ties_even()/10000.};
        Ok(json!({"text":text,"count":lines.len(),"lines":lines,"averageScore":average,"lowConfidence":low_count,"provider":self.provider}))
    }
}

pub fn recognize(root:&Path,path:&Path,low:f64,check:&dyn Fn()->Result<(),String>,progress:&dyn Fn(u32,&str))->Result<Value,String>{
    // CPU is the compatibility default. DirectML is explicit and never prevents CPU-only use.
    let requested=std::env::var("FURINAKIT_OCR_PROVIDER").unwrap_or_else(|_|"cpu".into()).to_lowercase();
    if !matches!(requested.as_str(),"cpu"|"directml"){return Err("FURINAKIT_OCR_PROVIDER must be cpu or directml".into());}
    let mut files=Vec::new();for model in manifest()?.files{
        let p=root.join(&model.name);let meta=std::fs::metadata(&p).map_err(|_|format!("OCR 模型未安装 / OCR model is not installed: {}",model.name))?;
        if !meta.is_file()||meta.len()!=model.bytes{return Err(format!("OCR 模型文件无效 / Invalid OCR model file: {}",model.name));}
        files.push((meta.len(),meta.modified().ok()));
    }
    let key=Key{root:root.to_owned(),requested:requested.clone(),files};
    let mut guard=loop{check()?;match cache().try_lock(){Ok(g)=>break g,Err(TryLockError::WouldBlock)=>std::thread::sleep(Duration::from_millis(40)),Err(TryLockError::Poisoned(_))=>return Err("OCR 会话状态异常，请重启程序 / OCR session state invalid; restart the app".into())}};
    if guard.as_ref().map(|c|&c.key)!=Some(&key){
        progress(5,"首次加载本地 OCR 模型 / Loading local OCR models");
        let engine=if requested=="directml"{match Engine::load(root,true,check){Ok(e)=>e,Err(_)=>{check()?;progress(8,"显卡引擎不可用，改用 CPU / GPU unavailable; using CPU");Engine::load(root,false,check)?}}}else{Engine::load(root,false,check)?};
        *guard=Some(Cached{key,engine});
    }
    check()?;let img=ocr_pixels::load(path)?;
    let cached=guard.as_mut().ok_or("OCR session missing")?;
    let result=cached.engine.recognize(&img,low,check,progress);
    if result.is_err()&&cached.engine.provider=="directml"{
        check()?;progress(10,"显卡推理失败，使用 CPU 重试 / GPU inference failed; retrying on CPU");
        cached.engine=Engine::load(root,false,check)?;
        return cached.engine.recognize(&img,low,check,progress);
    }
    result
}
