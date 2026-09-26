//! Indexed GIF edits: preserve palettes, per-frame delay/disposal, loop extensions and transparency.
use std::{borrow::Cow,fs,io::{Cursor,Write,Seek,SeekFrom},num::NonZeroU64,path::Path};
use serde_json::{Value,json};
use crate::{image_artifacts::LimitedFile,image_basic::number};
struct Metadata{extensions:Vec<(usize,Vec<u8>)>,frames:usize,background:u8,aspect:u8}
fn metadata(data:&[u8],check:&dyn Fn()->Result<(),String>)->Result<Metadata,String>{
    fn skip(data:&[u8],position:&mut usize,n:usize)->Result<(),String>{*position=position.checked_add(n).ok_or("GIF offset overflow")?;if *position>data.len(){Err("GIF 数据不完整 / Truncated GIF".into())}else{Ok(())}}
    fn blocks(data:&[u8],position:&mut usize)->Result<(),String>{loop{let n=*data.get(*position).ok_or("Truncated GIF sub-block")? as usize;skip(data,position,1+n)?;if n==0{return Ok(());}}}
    if data.len()<13||!matches!(&data[..6],b"GIF87a"|b"GIF89a"){return Err("请选择有效 GIF / Select a valid GIF".into());}
    let mut p=13;let flags=data[10];if flags&128!=0{skip(data,&mut p,3*(1usize<<((flags&7)+1)))?;}
    let mut result=Metadata{extensions:Vec::new(),frames:0,background:data[11],aspect:data[12]};let mut extension_bytes=0usize;
    loop{check()?;let start=p;let block=*data.get(p).ok_or("Missing GIF trailer")?;p+=1;
        match block{
            0x3b=>return Ok(result),
            0x2c=>{let packed=*data.get(p+8).ok_or("Truncated GIF image descriptor")?;skip(data,&mut p,9)?;if packed&128!=0{skip(data,&mut p,3*(1usize<<((packed&7)+1)))?;}skip(data,&mut p,1)?;blocks(data,&mut p)?;result.frames+=1;if result.frames>10000{return Err("GIF 超出 10000 帧限制 / GIF exceeds 10000 frames".into());}},
            0x21=>{let label=*data.get(p).ok_or("Truncated GIF extension")?;p+=1;blocks(data,&mut p)?;
                match label{0xf9=>{},0xfe|0xff=>{extension_bytes+=p-start;if extension_bytes>8_000_000{return Err("GIF 扩展数据过大 / GIF metadata too large".into());}result.extensions.push((result.frames,data[start..p].to_vec()));},_=>return Err("暂不处理含纯文本或未知图形扩展的 GIF，原文件未修改 / Unsupported GIF graphic extension; source unchanged".into())}
            },_=>return Err("无效 GIF 数据块 / Invalid GIF block".into())
        }
    }
}
fn crop(mut frame:gif::Frame<'static>,x:u32,y:u32,w:u32,h:u32)->gif::Frame<'static>{
    let left=(frame.left as u32).max(x);let top=(frame.top as u32).max(y);let right=(frame.left as u32+frame.width as u32).min(x+w);let bottom=(frame.top as u32+frame.height as u32).min(y+h);
    if right<=left||bottom<=top{
        // Keep the duration of a frame outside the crop without painting or clearing a pixel.
        frame.left=0;frame.top=0;frame.width=1;frame.height=1;frame.transparent=Some(0);frame.dispose=gif::DisposalMethod::Keep;frame.palette=Some(vec![0,0,0,0,0,0]);frame.buffer=Cow::Owned(vec![0]);return frame;
    }
    let mut data=Vec::with_capacity(((right-left)*(bottom-top)) as usize);
    for row in top..bottom{let start=((row-frame.top as u32)*frame.width as u32+left-frame.left as u32) as usize;data.extend_from_slice(&frame.buffer[start..start+(right-left) as usize]);}
    frame.left=(left-x) as u16;frame.top=(top-y) as u16;frame.width=(right-left) as u16;frame.height=(bottom-top) as u16;frame.buffer=Cow::Owned(data);frame
}
fn compact(frame:&mut gif::Frame<'static>,global:&[u8])->Result<(),String>{
    // Keep transparent indices unchanged: readers differ in background/disposal interpretation.
    if frame.transparent.is_some(){return Ok(());}
    let palette=frame.palette.as_deref().unwrap_or(global);let colors=palette.len()/3;
    let mut used=[false;256];for &index in frame.buffer.iter(){used[index as usize]=true;}if let Some(t)=frame.transparent{used[t as usize]=true;}
    for (i,is_used) in used.iter().enumerate(){if *is_used&&i>=colors{return Err("GIF palette index out of range".into());}}
    let count=used.iter().filter(|v|**v).count();if count==0{return Err("Empty GIF frame".into());}
    if count.max(2).next_power_of_two()>=colors.max(2).next_power_of_two(){return Ok(());}
    let mut map=[0u8;256];let mut output=Vec::new();for i in 0..colors{if used[i]{map[i]=(output.len()/3) as u8;output.extend_from_slice(&palette[i*3..i*3+3]);}}
    for value in frame.buffer.to_mut(){*value=map[*value as usize];}frame.transparent=frame.transparent.map(|i|map[i as usize]);frame.palette=Some(output);Ok(())
}
pub fn encode(tool:&str,args:&Value,input:&Path,output:&Path,check:&dyn Fn()->Result<(),String>)->Result<Value,String>{
    check()?;let bytes=fs::read(input).map_err(|e|e.to_string())?;if bytes.len()>128_000_000{return Err("GIF 超过 128 MB / GIF exceeds 128 MB".into());}
    let meta=metadata(&bytes,check)?;if meta.frames==0{return Err("GIF 没有图像帧 / GIF contains no image frame".into());}
    if number(args,"max_width",0.0)?>0.0{return Err("当前原生 GIF 尚未迁移 max_width 缩放参数，请省略该参数或使用旧完整版 / Omit max_width or use the legacy full installation".into());}
    let _quality=number(args,"quality",75.0)?; // Compatibility only: GIF has no JPEG-style quality scalar.
    let mut options=gif::DecodeOptions::new();options.set_color_output(gif::ColorOutput::Indexed);options.set_memory_limit(gif::MemoryLimit::Bytes(NonZeroU64::new(40_000_000).ok_or("Invalid GIF limit")?));options.check_frame_consistency(true);
    let mut decoder=options.read_info(Cursor::new(&bytes)).map_err(|e|e.to_string())?;let (sw,sh)=(decoder.width() as u32,decoder.height() as u32);
    if sw==0||sh==0||sw as u64*sh as u64>40_000_000{return Err("GIF 画布超出 4000 万像素限制 / GIF canvas exceeds 40 megapixels".into());}
    let cropping=tool=="gif-crop";
    let integer=|key:&str,default:f64|->Result<u32,String>{let n=number(args,key,default)?;if n<0.0||n>65535.0||n.fract()!=0.0{return Err(format!("无效裁剪坐标 / Invalid crop coordinate: {key}"));}Ok(n as u32)};
    let (x,y,w,h)=if cropping{(integer("x",0.0)?,integer("y",0.0)?,integer("width",100.0)?,integer("height",100.0)?)}else{(0,0,sw,sh)};
    if w==0||h==0||x+w>sw||y+h>sh{return Err("裁剪区域必须位于 GIF 画布内 / Crop must be inside the GIF canvas".into());}
    let palette=decoder.global_palette().unwrap_or(&[]).to_vec();let mut file=LimitedFile::create(output,256_000_000)?;
    let mut encoder=gif::Encoder::new(&mut file,w as u16,h as u16,&palette).map_err(|e|e.to_string())?;
    let mut frame_count=0usize;let mut extension=0usize;let mut duration=0u64;let mut pixels=0u64;
    loop{check()?;let Some(frame)=decoder.read_next_frame().map_err(|e|e.to_string())? else{break;};let mut frame=frame.clone();
        pixels+=frame.width as u64*frame.height as u64;frame_count+=1;if pixels>500_000_000||frame_count>10000{return Err("GIF 总帧像素量超出限制，请拆分动图 / GIF frame budget exceeded".into());}
        if frame.width==0||frame.height==0||frame.buffer.len()!=frame.width as usize*frame.height as usize{return Err("Invalid GIF frame buffer".into());}
        let colors=frame.palette.as_deref().unwrap_or(&palette).len()/3;
        if colors==0||frame.buffer.iter().any(|p|*p as usize>=colors)||frame.transparent.map(|p|p as usize>=colors).unwrap_or(false){return Err("Invalid GIF palette index".into());}
        while extension<meta.extensions.len()&&meta.extensions[extension].0<frame_count{encoder.get_mut().write_all(&meta.extensions[extension].1).map_err(|e|e.to_string())?;extension+=1;}
        duration+=frame.delay as u64*10;if cropping{
            if frame_count==1&&(frame.left as u32>=x+w||frame.top as u32>=y+h||frame.left as u32+frame.width as u32<=x||frame.top as u32+frame.height as u32<=y){return Err("裁剪区域未包含首帧内容，无法安全保持初始背景；请调整区域 / Crop excludes first frame; adjust region to preserve initial background".into());}
            frame=crop(frame,x,y,w,h);}else{compact(&mut frame,&palette)?;}
        check()?;encoder.write_frame(&frame).map_err(|e|e.to_string())?;
    }
    if frame_count!=meta.frames{return Err("GIF 帧数不一致，未发布产物 / GIF frame count mismatch".into());}
    while extension<meta.extensions.len(){encoder.get_mut().write_all(&meta.extensions[extension].1).map_err(|e|e.to_string())?;extension+=1;}
    let _=encoder.into_inner().map_err(|e|e.to_string())?;
    file.seek(SeekFrom::Start(11)).map_err(|e|e.to_string())?;file.write_all(&[meta.background,meta.aspect]).map_err(|e|e.to_string())?;file.sync()?;drop(file);check()?;
    let size=fs::metadata(output).map_err(|e|e.to_string())?.len();let original=!cropping&&size>=bytes.len() as u64;
    Ok(json!({"frames":frame_count,"durationMs":duration,"width":w,"height":h,"format":"gif","qualityApplied":false,"useOriginal":original,"decodedPixels":pixels,"message":if cropping{"已逐帧裁剪并保留时序 / Cropped each frame and retained timing"}else if original{"重编码未变小，保留原始 GIF / Re-encoding was not smaller; original GIF retained"}else{"GIF 无损调色板优化；quality 不适用 / Lossless GIF palette optimization; quality is not applied"}}))
}
