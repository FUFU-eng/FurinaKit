//! Bounded static-image encoders and multi-resolution ICO; never route animation edits here.
use std::{path::Path,io::{Write,Cursor}};
use image::{DynamicImage,ImageFormat,imageops::FilterType};
use serde_json::{Value,json};
use crate::image_artifacts::LimitedFile;
pub use crate::image_parameters::{number,sizes,extension};
fn white(image:DynamicImage)->DynamicImage{
    let rgba=image.into_rgba8();let mut rgb=image::RgbImage::new(rgba.width(),rgba.height());
    for (src,dst) in rgba.pixels().zip(rgb.pixels_mut()){let a=src[3] as u32;for channel in 0..3{dst[channel]=((src[channel] as u32*a+255*(255-a)+127)/255) as u8;}}
    DynamicImage::ImageRgb8(rgb)
}
// Lanczos filtering expects premultiplied color when alpha varies. Match that contract
// rather than interpolating hidden black RGB into visible icon edges.
fn alpha8(buffer:&mut image::RgbaImage,undo:bool,check:&dyn Fn()->Result<(),String>)->Result<(),String>{
    for (i,p) in buffer.pixels_mut().enumerate(){if i%65536==0{check()?;}let a=p[3] as u32;if a==255{continue;}for c in 0..3{p[c]=if undo{if a==0{0}else{((p[c] as u32*255+a/2)/a).min(255) as u8}}else{((p[c] as u32*a+127)/255) as u8};}}Ok(())
}
pub(crate) fn resize_alpha(image:DynamicImage,w:u32,h:u32,check:&dyn Fn()->Result<(),String>)->Result<DynamicImage,String>{
    if !image.color().has_alpha(){return Ok(image.resize_exact(w,h,FilterType::Lanczos3));}
    match image.color(){
        image::ColorType::La16|image::ColorType::Rgba16=>{
            let mut buffer=image.into_rgba16();
            for (i,p) in buffer.pixels_mut().enumerate(){if i%65536==0{check()?;}let a=p[3] as u64;for c in 0..3{p[c]=((p[c] as u64*a+32767)/65535) as u16;}}
            let mut result=image::imageops::resize(&buffer,w,h,FilterType::Lanczos3);drop(buffer);
            for (i,p) in result.pixels_mut().enumerate(){if i%65536==0{check()?;}let a=p[3] as u64;for c in 0..3{p[c]=if a==0{0}else{((p[c] as u64*65535+a/2)/a).min(65535) as u16};}}
            Ok(DynamicImage::ImageRgba16(result))
        }
        image::ColorType::Rgba32F=>{
            if w as u64*h as u64>16_000_000{return Err("浮点 RGBA 缩放超过内存预算 / Float RGBA resize exceeds memory budget".into());}
            let mut buffer=image.into_rgba32f();
            for (i,p) in buffer.pixels_mut().enumerate(){if i%65536==0{check()?;}let a=p[3];if !a.is_finite()||!(0.0..=1.0).contains(&a)||p.0[..3].iter().any(|c|!c.is_finite()){return Err("Invalid floating-point image channels".into());}for c in 0..3{p[c]*=a;}}
            let mut result=image::imageops::resize(&buffer,w,h,FilterType::Lanczos3);drop(buffer);
            for (i,p) in result.pixels_mut().enumerate(){if i%65536==0{check()?;}let a=p[3];for c in 0..3{p[c]=if a>0.0{p[c]/a}else{0.0};}}
            Ok(DynamicImage::ImageRgba32F(result))
        }
        _=>{let mut buffer=image.into_rgba8();alpha8(&mut buffer,false,check)?;let mut result=image::imageops::resize(&buffer,w,h,FilterType::Lanczos3);drop(buffer);alpha8(&mut result,true,check)?;Ok(DynamicImage::ImageRgba8(result))}
    }
}
pub fn encode(tool:&str,args:&Value,input:&Path,output:&Path,ext:&str,check:&dyn Fn()->Result<(),String>)->Result<Value,String>{
    check()?;let loaded=crate::decode::load(input,check)?;let mut image=loaded.image;let before=(image.width(),image.height());check()?;
    if ext=="ico"{
        let requested=sizes(args)?;let side=image.width().min(image.height());image=image.crop_imm((image.width()-side)/2,(image.height()-side)/2,side,side);
        let mut base=image.into_rgba8();alpha8(&mut base,false,check)?;
        let maximum=*requested.last().ok_or("Empty ICO size set")?;if side<maximum{base=image::imageops::resize(&base,maximum,maximum,FilterType::Lanczos3);}
        let mut frames=Vec::new();
        for size in &requested{check()?;let mut scaled=image::imageops::resize(&base,*size,*size,FilterType::Lanczos3);alpha8(&mut scaled,true,check)?;let mut data=Cursor::new(Vec::new());DynamicImage::ImageRgba8(scaled).write_to(&mut data,ImageFormat::Png).map_err(|e|e.to_string())?;frames.push(data.into_inner());}
        let mut writer=LimitedFile::create(output,256_000_000)?;let mut directory=Vec::new();directory.extend([0,0,1,0]);directory.extend((frames.len() as u16).to_le_bytes());let mut offset=6+16*frames.len() as u32;
        for (size,data) in requested.iter().zip(&frames){directory.extend([if *size==256{0}else{*size as u8};2]);directory.extend([0,0]);directory.extend(1u16.to_le_bytes());directory.extend(32u16.to_le_bytes());directory.extend((data.len() as u32).to_le_bytes());directory.extend(offset.to_le_bytes());offset+=data.len() as u32;}
        writer.write_all(&directory).map_err(|e|e.to_string())?;for data in frames{check()?;writer.write_all(&data).map_err(|e|e.to_string())?;}writer.sync()?;return Ok(json!({"sizes":requested,"format":"ico","widthBefore":before.0,"heightBefore":before.1,"colourSpace":"sRGB","warning":loaded.notes.join("; ")}));
    }
    let quality=number(args,"quality",if tool=="image-to-jpg"{95.0}else if tool=="image-format-convert"{90.0}else{75.0})?.clamp(1.0,100.0) as u8;
    if tool=="image-compress"{
        let max_width=number(args,"max_width",0.0)?;
        let edge=number(args,"maxWidth",number(args,"maxEdge",0.0)?)?;
        let scale=number(args,"scale",1.0)?;
        if max_width<0.0||edge<0.0||scale<=0.0{return Err("缩放参数无效 / Invalid resize parameter".into());}
        let factor=if max_width>0.0{(max_width/image.width() as f64).min(1.0)}else if edge>0.0{(edge/image.width().max(image.height()) as f64).min(1.0)}else{scale};
        let w=(image.width() as f64*factor).floor().max(1.0);let h=(image.height() as f64*factor).floor().max(1.0);
        if !w.is_finite()||!h.is_finite()||w*h>40_000_000.0||w>40000.0||h>40000.0{return Err("目标图片超出尺寸限制 / Target image exceeds limits".into());}
        if (w as u32,h as u32)!=(image.width(),image.height()){image=resize_alpha(image,w as u32,h as u32,check)?;}
    }
    check()?;if ext=="jpg"||ext=="bmp"{image=white(image);}
    let (w,h)=(image.width(),image.height());let mut output=LimitedFile::create(output,256_000_000)?;
    if ext=="jpg"{
        use image::ImageEncoder;
        let mut encoder=image::codecs::jpeg::JpegEncoder::new_with_quality(&mut output,quality);
        encoder.set_icc_profile(moxcms::ColorProfile::new_srgb().encode().map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
        encoder.encode_image(&image).map_err(|e|e.to_string())?;
    }else if ext=="png"{
        use image::ImageEncoder;
        let mut encoder=image::codecs::png::PngEncoder::new(&mut output);
        encoder.set_icc_profile(moxcms::ColorProfile::new_srgb().encode().map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
        encoder.write_image(image.as_bytes(),w,h,image.color().into()).map_err(|e|e.to_string())?;
    }else if ext=="webp"{
        if w>16383||h>16383{return Err("WebP dimensions exceed 16383".into());}
        let rgba=image.into_rgba8();let mut config=webp::WebPConfig::new().map_err(|_|"WebP config allocation failed")?;
        config.lossless=0;config.quality=f32::from(quality);config.method=4;config.alpha_quality=100;config.exact=1;
        let encoded=webp::Encoder::from_rgba(rgba.as_raw(),w,h).encode_advanced(&config).map_err(|e|format!("WebP encoding: {e:?}"))?;
        check()?;output.write_all(&encoded).map_err(|e|e.to_string())?;
    }else if ext=="avif"{
        let rgba=image.into_rgba8();let pixels:Vec<ravif::RGBA8>=rgba.pixels().map(|p|ravif::RGBA8::new(p[0],p[1],p[2],p[3])).collect();drop(rgba);
        let encoded=ravif::Encoder::new().with_quality(f32::from(quality)).with_alpha_quality(100.0).with_speed(6).with_num_threads(Some(4))
            .with_alpha_color_mode(ravif::AlphaColorMode::UnassociatedDirty)
            .encode_rgba(ravif::Img::new(&pixels,w as usize,h as usize)).map_err(|e|e.to_string())?;
        check()?;output.write_all(&encoded.avif_file).map_err(|e|e.to_string())?;
    }else{
        let format=match ext{"bmp"=>ImageFormat::Bmp,"tiff"=>ImageFormat::Tiff,"gif"=>ImageFormat::Gif,_=>return Err("Unsupported static image encoder".into())};
        if ext=="gif"{image=image.into_rgba8().into();}
        image.write_to(&mut output,format).map_err(|e|e.to_string())?;
    }
    output.sync()?;check()?;
    let quality_applied=matches!(ext,"jpg"|"webp"|"avif");
    let mut notes=loaded.notes;
    if loaded.source_depth>8&&matches!(ext,"jpg"|"webp"|"avif"|"gif"|"bmp"){notes.push("此输出编码路径量化为8位 / This output path quantizes to 8-bit".into());}
    Ok(json!({"format":ext,"width":w,"height":h,"widthBefore":before.0,"heightBefore":before.1,"quality":quality,"qualityApplied":quality_applied,
        "losslessEncoding":matches!(ext,"png"|"bmp"|"tiff"),"colourSpace":"sRGB","sourceDepth":loaded.source_depth,"sourceFrames":loaded.frames,"warning":notes.join("; ")}))
}
