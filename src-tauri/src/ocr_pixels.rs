// Portions adapted from RapidOCR (SWHL) and PaddleOCR, Apache-2.0.
// Copyright (c) 2020 PaddlePaddle Authors. All Rights Reserved.
// See licenses/ocr-NOTICE.md and licenses/ocr-Apache-2.0-LICENSE.txt.
//! Pixel preprocessing matched to the deployed RapidOCR v3/v2 configuration.
//! No implicit EXIF rotation (the legacy PIL path does not perform it either).
use image::{DynamicImage, Rgb, RgbImage};
use super::ocr_geometry::{homography,Quad};
pub const MAX_DETECTION_PIXELS: usize = 16_000_000;

pub fn load(path:&std::path::Path)->Result<RgbImage,String>{
    let reader=image::ImageReader::open(path).map_err(|e|format!("无法读取图片 / Cannot read image: {e}"))?
        .with_guessed_format().map_err(|e|e.to_string())?;
    let (w,h)=reader.into_dimensions().map_err(|e|format!("图片格式不受支持 / Unsupported image: {e}"))?;
    if w==0||h==0||w as u64*h as u64>40_000_000{return Err("图片为空或超过 4000 万像素，请裁剪后识别 / Empty image or over 40 megapixels; crop before OCR".into());}
    let img=image::ImageReader::open(path).map_err(|e|e.to_string())?.with_guessed_format().map_err(|e|e.to_string())?
        .decode().map_err(|e|format!("图片解码失败 / Image decoding failed: {e}"))?;
    // Legacy RGBA handling is unusual: swap RGB->BGR, mask alpha==0, add 255-alpha.
    // Retain that existing contract; do not silently substitute normal alpha blending.
    let has_alpha=matches!(img,DynamicImage::ImageRgba8(_)|DynamicImage::ImageRgba16(_)|DynamicImage::ImageRgba32F(_));
    if has_alpha{
        let rgba=img.to_rgba8();let mut rgb=RgbImage::new(w,h);
        for (x,y,p) in rgba.enumerate_pixels(){let a=p[3];let add=255-a;
            rgb.put_pixel(x,y,Rgb(if a==0{[255;3]}else{[p[2].saturating_add(add),p[1].saturating_add(add),p[0].saturating_add(add)]}));}
        Ok(rgb)
    }else{Ok(img.to_rgb8())}
}

/// Half-pixel linear resize, replicate border, integer 11-bit interpolation coefficients.
pub fn resize(img:&RgbImage,w:u32,h:u32,check:&dyn Fn()->Result<(),String>)->Result<RgbImage,String>{
    if w==0||h==0||w as usize*h as usize>MAX_DETECTION_PIXELS{return Err("OCR 缩放尺寸过大，请裁剪识别区域 / OCR resize is too large; crop the region".into());}
    let mut result=RgbImage::new(w,h);let iw=img.width();let ih=img.height();
    let axis=|i:u32,src:u32,dst:u32|{
        let at=((i as f64+0.5)*src as f64/dst as f64-0.5).clamp(0.,src.saturating_sub(1) as f64);
        let low=at.floor() as u32;let f=at-low as f64;
        (low,(low+1).min(src-1),((1.-f)*2048.).round_ties_even() as i64,(f*2048.).round_ties_even() as i64)
    };
    let xs:Vec<_>=(0..w).map(|x|axis(x,iw,w)).collect();
    for y in 0..h{if y%32==0{check()?;}let(y0,y1,a,b)=axis(y,ih,h);
        for x in 0..w{let(x0,x1,c,d)=xs[x as usize];let p00=img.get_pixel(x0,y0);let p01=img.get_pixel(x1,y0);let p10=img.get_pixel(x0,y1);let p11=img.get_pixel(x1,y1);
            let p=std::array::from_fn(|k|(((p00[k] as i64*c+p01[k] as i64*d)*a+(p10[k] as i64*c+p11[k] as i64*d)*b+(1<<21))>>22).clamp(0,255) as u8);
            result.put_pixel(x,y,Rgb(p));
        }
    }Ok(result)
}

pub fn detection_tensor(img:&RgbImage,check:&dyn Fn()->Result<(),String>)->Result<(Vec<f32>,usize,usize),String>{
    let w=img.width();let h=img.height();let ratio=if w.min(h)<736{736./w.min(h) as f64}else{1.};
    let round32=|n:u32|(((n as f64*ratio).trunc()/32.).round_ties_even()*32.) as u32;
    let(dw,dh)=(round32(w),round32(h));
    if dw==0||dh==0||dw as usize*dh as usize>MAX_DETECTION_PIXELS{return Err("OCR 检测区域超过安全内存预算，请裁剪后重试 / OCR region exceeds the memory budget; crop and retry".into());}
    let resized=resize(img,dw,dh,check)?;let plane=dw as usize*dh as usize;
    let mut data=vec![0f32;3*plane];let mean=[0.485f32,0.456,0.406];let std=[0.229f32,0.224,0.225];
    for(i,p)in resized.pixels().enumerate(){for k in 0..3{data[k*plane+i]=(p[k] as f32*(1f32/255.)-mean[k])/std[k];}}
    Ok((data,dh as usize,dw as usize))
}
fn cubic(x:f64)->f64{let x=x.abs();let a=-0.75;if x<=1.{(a+2.)*x*x*x-(a+3.)*x*x+1.}else if x<2.{a*x*x*x-5.*a*x*x+8.*a*x-4.*a}else{0.}}
pub fn crop(img:&RgbImage,q:&Quad,check:&dyn Fn()->Result<(),String>)->Result<RgbImage,String>{
    let w=q[0].distance(q[1]).max(q[2].distance(q[3])).trunc().max(1.) as u32;
    let h=q[0].distance(q[3]).max(q[1].distance(q[2])).trunc().max(1.) as u32;
    if w as usize*h as usize>MAX_DETECTION_PIXELS{return Err("OCR 文字框过大 / OCR text box too large".into());}
    let matrix=homography(q,w as f64,h as f64)?;let mut result=RgbImage::new(w,h);
    for y in 0..h{if y%16==0{check()?;}for x in 0..w{
        let denominator=matrix[6]*x as f64+matrix[7]*y as f64+1.;
        if denominator.abs()<1e-10{return Err("OCR 透视变换无效 / Invalid OCR perspective transform".into());}
        let sx=((matrix[0]*x as f64+matrix[1]*y as f64+matrix[2])/denominator*32.).round_ties_even()/32.;
        let sy=((matrix[3]*x as f64+matrix[4]*y as f64+matrix[5])/denominator*32.).round_ties_even()/32.;
        let ix=sx.floor() as i64;let iy=sy.floor() as i64;let mut value=[0f64;3];
        for dy in -1..=2{for dx in -1..=2{let weight=cubic(sx-(ix+dx) as f64)*cubic(sy-(iy+dy) as f64);
            let p=img.get_pixel((ix+dx).clamp(0,img.width() as i64-1) as u32,(iy+dy).clamp(0,img.height() as i64-1) as u32);
            for c in 0..3{value[c]+=weight*p[c] as f64;}
        }}
        result.put_pixel(x,y,Rgb(value.map(|v|v.round_ties_even().clamp(0.,255.) as u8)));
    }}
    Ok(if h as f64/w as f64>=1.5{image::imageops::rotate270(&result)}else{result})
}

/// Normalize a crop into a zero-padded CHW batch slice (zero after normalization, not black).
pub fn normalize_crop(img:&RgbImage,width:usize,into:&mut[f32],check:&dyn Fn()->Result<(),String>)->Result<(),String>{
    if width==0||width>16384||into.len()!=3*48*width{return Err("OCR 文本行过长，请分段识别 / OCR text line is too long; split it into regions".into());}
    let resized_width=((48.*img.width() as f64/img.height() as f64).ceil() as usize).min(width).max(1);
    let resized=resize(img,resized_width as u32,48,check)?;let plane=48*width;
    for y in 0..48{for x in 0..resized_width{let p=resized.get_pixel(x as u32,y as u32);for c in 0..3{into[c*plane+y*width+x]=(p[c] as f32/255.-0.5)/0.5;}}}
    Ok(())
}
