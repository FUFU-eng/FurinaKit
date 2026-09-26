use std::{path::Path,io::{Read,Cursor},sync::atomic::AtomicBool};
use image::{DynamicImage,ImageBuffer,ImageDecoder};
use furinakit_avif_decoder::Pixels;
use crate::colour::Encoding;
pub struct Loaded {pub image:DynamicImage,pub notes:Vec<String>,pub frames:u32,pub source_depth:u32}
pub fn load(path:&Path,check:&dyn Fn()->Result<(),String>)->Result<Loaded,String>{
 check()?;let f=std::fs::File::open(path).map_err(|e|e.to_string())?;let n=f.metadata().map_err(|e|e.to_string())?.len();
 if n==0||n>128_000_000{return Err("图片输入超过预算 / Input empty or over 128 MB".into());}
 let mut bytes=Vec::new();bytes.try_reserve_exact(n as usize).map_err(|_|"Image input allocation failed")?;f.take(128_000_001).read_to_end(&mut bytes).map_err(|e|e.to_string())?;
 if bytes.len()>128_000_000{return Err("Image input changed beyond budget".into());}
 decode(&bytes,check)
}
pub fn decode(bytes:&[u8],check:&dyn Fn()->Result<(),String>)->Result<Loaded,String>{
 check()?;if bytes.len()>128_000_000{return Err("Image input budget exceeded".into());}
 if let Some(loaded)=crate::cmyk::decode(bytes,check)?{return Ok(loaded);}
 let mut notes=Vec::new();let (mut image,encoding,frames,source_depth)=if furinakit_avif_decoder::is_avif(bytes){
  // Production cancellation is enforced by the supervising child-process lifetime;
  // this short-lived worker never shares application-owned cancellation memory.
  let avif=furinakit_avif_decoder::decode(bytes,0,&AtomicBool::new(false))?;
  let mut image=match avif.pixels{Pixels::Rgba8(p)=>DynamicImage::ImageRgba8(ImageBuffer::from_raw(avif.width,avif.height,p).ok_or("AVIF pixel shape")?),Pixels::Rgba16(p)=>DynamicImage::ImageRgba16(ImageBuffer::from_raw(avif.width,avif.height,p).ok_or("AVIF pixel shape")?)};
  if avif.pixel_aspect[0]!=avif.pixel_aspect[1]{
   let width=(u64::from(image.width())*u64::from(avif.pixel_aspect[0])+u64::from(avif.pixel_aspect[1])/2)/u64::from(avif.pixel_aspect[1]);
   let width=u32::try_from(width.max(1)).map_err(|_|"Pixel aspect dimensions overflow")?;crate::check_dimensions(width,image.height())?;
   let height=image.height();image=crate::image_basic::resize_alpha(image,width,height,check)?;
   notes.push("非方形像素已重采样 / Pixel aspect ratio rendered to square pixels".into());
  }
  if !avif.source_exif.is_empty(){notes.push("AVIF 使用容器方向；不重复应用 Exif，输出移除源 Exif/XMP / Container orientation authoritative; source Exif/XMP stripped".into());}
  if avif.colour.gain_map_present{notes.push("使用基础图像，未保留 HDR gain map / Base rendition only; gain map not retained".into());}
  (image,Encoding{icc:avif.colour.icc,primaries:avif.colour.primaries,transfer:avif.colour.transfer,max_cll:avif.colour.max_content_light},avif.frame_count,avif.source_depth)
 }else{
  let mut reader=image::ImageReader::new(Cursor::new(bytes)).with_guessed_format().map_err(|e|e.to_string())?;
  let format=reader.format();let mut limits=image::Limits::default();limits.max_image_width=Some(40000);limits.max_image_height=Some(40000);limits.max_alloc=Some(256_000_000);reader.limits(limits);
  let mut decoder=reader.into_decoder().map_err(|e|e.to_string())?;let (w,h)=decoder.dimensions();crate::check_dimensions(w,h)?;
  if decoder.total_bytes()>256_000_000{return Err("Decoded image byte budget exceeded".into());}
  let icc=decoder.icc_profile().map_err(|e|e.to_string())?.unwrap_or_default();if icc.len()>4*1024*1024{return Err("ICC exceeds 4 MiB".into());}
  let orientation=decoder.orientation().map_err(|e|e.to_string())?;
  let mut image=DynamicImage::from_decoder(decoder).map_err(|e|e.to_string())?;image.apply_orientation(orientation);
  let depth=if image.color().bytes_per_pixel()/image.color().channel_count()>1{16}else{8};
  if matches!(format,Some(image::ImageFormat::Gif|image::ImageFormat::WebP|image::ImageFormat::Png)){notes.push("静态转换仅使用首帧；动图编辑请用 GIF 工具 / Static conversion uses first frame; use GIF tools for animation".into());}
  let encoding=if format==Some(image::ImageFormat::Png){let (e,narrow)=crate::png_colour::metadata(bytes,icc,&mut notes)?;if narrow{image=crate::png_colour::expand_video_range(image,depth)?;notes.push("PNG narrow range → full RGB".into());}e}else{Encoding{icc,primaries:1,transfer:13,max_cll:0}};
  (image,encoding,1,depth)
 };
 if frames>1{notes.push(format!("静态转换使用第1帧（共{frames}帧） / First frame of {frames} used"));}
 image=crate::colour::to_srgb(image,&encoding,check,&mut notes)?;check()?;
 Ok(Loaded{image,notes,frames,source_depth})
}
