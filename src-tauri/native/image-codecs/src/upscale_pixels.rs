//! RGB-only inference preparation and independently resampled alpha. Runs only in the bounded codec child.
use std::path::{Path,PathBuf};
use image::{DynamicImage,ImageFormat,GrayImage,imageops::FilterType};
use serde_json::{Value,json};
use crate::image_artifacts::LimitedFile;
fn save(image:DynamicImage,path:&Path)->Result<(),String>{
 let mut f=LimitedFile::create(path,128_000_000)?;
 image.write_to(&mut f,ImageFormat::Png).map_err(|e|e.to_string())?;f.sync()
}
fn scale(args:&Value)->Result<u32,String>{
 match args["scale"].as_u64(){Some(2)=>Ok(2),Some(3)=>Ok(3),_=>Err("Only anime 2x/3x are supported".into())}
}
fn sibling(output:&Path,name:&str)->Result<PathBuf,String>{Ok(output.parent().ok_or("Missing private output directory")?.join(name))}
pub fn prepare(input:&Path,output:&Path,args:&Value)->Result<Value,String>{
 let scale=scale(args)?;let loaded=crate::decode::load(input,&||Ok(()))?;
 let mut notes=loaded.notes.clone();
 let mut rgba=loaded.image.into_rgba8();let(w0,h0)=rgba.dimensions();
 // 输出上限约 3200 万像素（超过会触发尺寸/内存预算）。大图不再直接报错，而是先等比缩小到
 // “放大后恰好不超上限”的尺寸再强化，并在结果里说明。例：6000×4310 ×2 → 先缩到约 3330×2392。
 const MAX_OUT:f64=32_000_000.0;
 let out_px=f64::from(w0)*f64::from(h0)*f64::from(scale*scale);
 if out_px>MAX_OUT{
  let f=(MAX_OUT/out_px).sqrt();
  let nw=((f64::from(w0)*f).floor() as u32).max(1);let nh=((f64::from(h0)*f).floor() as u32).max(1);
  rgba=image::imageops::resize(&rgba,nw,nh,FilterType::Lanczos3);
  notes.push(format!("原图 {w0}×{h0} 过大，已先等比缩到 {nw}×{nh} 再 {scale} 倍强化（输出上限约 3200 万像素） / Large input was downscaled to {nw}×{nh} before {scale}x upscale"));
 }
 let(w,h)=rgba.dimensions();
 let ow=w.checked_mul(scale).ok_or("Upscale width overflow")?;let oh=h.checked_mul(scale).ok_or("Upscale height overflow")?;
 crate::check_dimensions(ow,oh)?;
 let mut alpha=GrayImage::new(w,h);let mut any=false;let mut opaque=true;
 for(p,a)in rgba.pixels().zip(alpha.pixels_mut()){a[0]=p[3];any|=p[3]>0;opaque&=p[3]==255;}
 if !any{return Err("输入图片完全透明，无法强化 / Fully transparent input".into());}
 // Alpha stays at source dimensions until finalization. The inference engine never sees RGBA.
 save(DynamicImage::ImageLuma8(alpha),&sibling(output,"alpha.png")?)?;
 save(DynamicImage::ImageRgba8(rgba).into_rgb8().into(),output)?;
 Ok(json!({"widthBefore":w,"heightBefore":h,"width":ow,"height":oh,"opaque":opaque,"scale":scale,"warning":notes.join("; ")}))
}
pub fn finish(input:&Path,output:&Path,args:&Value)->Result<Value,String>{
 let scale=scale(args)?;
 let alpha_path=sibling(output,"alpha.png")?;
 let alpha=crate::decode::load(&alpha_path,&||Ok(()))?.image.into_luma8();
 let(w,h)=alpha.dimensions();let ow=w.checked_mul(scale).ok_or("Width overflow")?;let oh=h.checked_mul(scale).ok_or("Height overflow")?;crate::check_dimensions(ow,oh)?;
 let rendered=crate::decode::load(input,&||Ok(()))?.image;
 if rendered.width()!=ow||rendered.height()!=oh{return Err("超分输出尺寸异常 / Unexpected inference dimensions".into());}
 let rgb=rendered.into_rgb8();let opaque=alpha.pixels().all(|p|p[0]==255);
 if opaque{save(DynamicImage::ImageRgb8(rgb),output)?;}else{
  let scaled=image::imageops::resize(&alpha,ow,oh,FilterType::Lanczos3);
  let mut rgba=DynamicImage::ImageRgb8(rgb).into_rgba8();
  for(p,a)in rgba.pixels_mut().zip(scaled.pixels()){p[3]=a[0];}
  save(DynamicImage::ImageRgba8(rgba),output)?;
 }
 Ok(json!({"widthBefore":w,"heightBefore":h,"width":ow,"height":oh,"scale":scale,"format":"png","alphaPreserved":true}))
}
