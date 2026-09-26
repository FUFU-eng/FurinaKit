//! Source-space-aware CMYK ICC decoding. Never apply a four-ink profile to RGB pixels.
use image::{DynamicImage,ImageBuffer,metadata::Orientation};
use moxcms::{ColorProfile,DataColorSpace,Layout};
use crate::decode::Loaded;
use std::io::Cursor;
fn profile(bytes:&[u8])->Result<ColorProfile,String>{let p=crate::colour::parse_icc(bytes)?;if p.color_space!=DataColorSpace::Cmyk{return Err("CMYK 源像素与 ICC 色彩空间不匹配 / CMYK source/ICC mismatch".into());}Ok(p)}
fn rgb8(samples:&[u8],w:u32,h:u32,profile:&ColorProfile,check:&dyn Fn()->Result<(),String>)->Result<DynamicImage,String>{
 let transform=profile.create_transform_8bit(Layout::Rgba,&ColorProfile::new_srgb(),Layout::Rgb,crate::colour::options(true)).map_err(|e|e.to_string())?;
 let mut rgb=crate::buffer::<u8>(w as usize*h as usize*3)?;
 for(input,output)in samples.chunks_exact(w as usize*4).zip(rgb.chunks_exact_mut(w as usize*3)){check()?;transform.transform(input,output).map_err(|e|e.to_string())?;}
 Ok(DynamicImage::ImageRgb8(ImageBuffer::from_raw(w,h,rgb).ok_or("Invalid CMYK result")?))
}
fn rgb16(samples:&[u16],w:u32,h:u32,profile:&ColorProfile,check:&dyn Fn()->Result<(),String>)->Result<DynamicImage,String>{
 let transform=profile.create_transform_16bit(Layout::Rgba,&ColorProfile::new_srgb(),Layout::Rgb,crate::colour::options(true)).map_err(|e|e.to_string())?;
 let mut rgb=crate::buffer::<u16>(w as usize*h as usize*3)?;
 for(input,output)in samples.chunks_exact(w as usize*4).zip(rgb.chunks_exact_mut(w as usize*3)){check()?;transform.transform(input,output).map_err(|e|e.to_string())?;}
 Ok(DynamicImage::ImageRgb16(ImageBuffer::from_raw(w,h,rgb).ok_or("Invalid CMYK result")?))
}
/// Inspect bounded metadata before decoder allocation. Broken ICC chunks are not "untagged".
fn jpeg_metadata(bytes:&[u8])->Result<(bool,bool),String>{
 let(mut p,mut adobe,mut icc,mut metadata_bytes,mut icc_bytes)=(2usize,false,false,0usize,0usize);
 while p<bytes.len(){
  if bytes[p]!=0xff{return Err("Invalid JPEG marker boundary".into());}while bytes.get(p)==Some(&0xff){p+=1;}let m=*bytes.get(p).ok_or("Truncated JPEG marker")?;p+=1;
  if matches!(m,0xda|0xd9){return Ok((adobe,icc));}if m==1||matches!(m,0xd0..=0xd7){continue;}
  let size=bytes.get(p..p+2).ok_or("Truncated JPEG segment")?;let n=u16::from_be_bytes([size[0],size[1]])as usize;if n<2{return Err("Invalid JPEG segment size".into());}let data=bytes.get(p+2..p+n).ok_or("Truncated JPEG segment")?;
  if matches!(m,0xe0..=0xef){metadata_bytes+=data.len();if metadata_bytes>16*1024*1024{return Err("JPEG metadata exceeds 16 MiB".into());}}
  if m==0xee&&data.starts_with(b"Adobe"){if data.len()<12{return Err("Truncated Adobe metadata".into());}adobe=true;}
  if m==0xe2&&data.starts_with(b"ICC_PROFILE\0"){icc=true;if data.len()<14{return Err("Truncated JPEG ICC header".into());}icc_bytes+=data.len()-14;if icc_bytes>4*1024*1024{return Err("JPEG ICC exceeds 4 MiB".into());}}
  p+=n;
 }
 Err("Missing JPEG image data".into())
}
pub fn decode(bytes:&[u8],check:&dyn Fn()->Result<(),String>)->Result<Option<Loaded>,String>{
 check()?;
 if bytes.starts_with(&[0xff,0xd8]){
  use zune_core::{bytestream::ZCursor,colorspace::ColorSpace,options::DecoderOptions};
  let(inverted,icc_present)=jpeg_metadata(bytes)?;
  let options=DecoderOptions::default().set_strict_mode(false).set_max_width(40000).set_max_height(40000);
  let mut decoder=zune_jpeg::JpegDecoder::new_with_options(ZCursor::new(bytes),options);decoder.decode_headers().map_err(|e|e.to_string())?;
  let icc=decoder.icc_profile();if icc_present&&icc.is_none(){return Err("Invalid/incomplete JPEG ICC chunks".into());}
  let cs=decoder.input_colorspace().ok_or("Missing JPEG colour space")?;if !matches!(cs,ColorSpace::CMYK|ColorSpace::YCCK){return Ok(None);}
  let Some(icc)=icc else{return Ok(None);};let source=profile(&icc)?;
  let(w,h)=decoder.dimensions().ok_or("Missing JPEG dimensions")?;let(w,h)=(u32::try_from(w).map_err(|_|"JPEG width overflow")?,u32::try_from(h).map_err(|_|"JPEG height overflow")?);crate::check_dimensions(w,h)?;
  let orientation=decoder.exif().and_then(|b|Orientation::from_exif_chunk(b)).unwrap_or(Orientation::NoTransforms);
  decoder.set_options(decoder.options().jpeg_set_out_colorspace(cs));let mut samples=crate::buffer::<u8>(w as usize*h as usize*4)?;decoder.decode_into(&mut samples).map_err(|e|e.to_string())?;
  for row in samples.chunks_exact_mut(w as usize*4){check()?;for p in row.chunks_exact_mut(4){if cs==ColorSpace::YCCK{let y=f32::from(p[0]);let cb=f32::from(p[1])-128.0;let cr=f32::from(p[2])-128.0;p[0]=(y+1.402*cr).round().clamp(0.0,255.0)as u8;p[1]=(y-0.344136*cb-0.714136*cr).round().clamp(0.0,255.0)as u8;p[2]=(y+1.772*cb).round().clamp(0.0,255.0)as u8;p[3]=255-p[3];}else if inverted{for c in p{*c=255-*c;}}}}
  let mut image=rgb8(&samples,w,h,&source,check)?;image.apply_orientation(orientation);
  return Ok(Some(Loaded{image,notes:vec!["JPEG CMYK/YCCK 源像素经 ICC → sRGB / Source CMYK ICC managed; source metadata stripped".into()],frames:1,source_depth:8}));
 }
 if bytes.starts_with(b"II*\0")||bytes.starts_with(b"MM\0*")||bytes.starts_with(b"II+\0")||bytes.starts_with(b"MM\0+"){
  use tiff::{decoder::{Decoder,DecodingResult,Limits},tags::Tag,ColorType};
  let mut limits=Limits::default();limits.decoding_buffer_size=256_000_000;limits.ifd_value_size=4*1024*1024;limits.intermediate_buffer_size=128_000_000;
  let mut decoder=Decoder::new(Cursor::new(bytes)).map_err(|e|e.to_string())?.with_limits(limits);let color=decoder.colortype().map_err(|e|e.to_string())?;
  let depth=match color{ColorType::CMYK(8)=>8,ColorType::CMYK(16)=>16,_=>return Ok(None)};
  let Some(icc)=decoder.find_tag(Tag::IccProfile).map_err(|e|e.to_string())?else{return Ok(None);};let icc=icc.into_u8_vec().map_err(|e|e.to_string())?;let source=profile(&icc)?;
  let(w,h)=decoder.dimensions().map_err(|e|e.to_string())?;crate::check_dimensions(w,h)?;let bytes_needed=u64::from(w)*u64::from(h)*4*u64::from(depth/8);if bytes_needed>256_000_000{return Err("CMYK source exceeds buffer budget".into());}
  let orientation=decoder.find_tag_unsigned::<u16>(Tag::Orientation).map_err(|e|e.to_string())?.unwrap_or(1);let orientation=u8::try_from(orientation).ok().and_then(Orientation::from_exif).ok_or("Invalid TIFF orientation")?;
  let mut image=match decoder.read_image().map_err(|e|e.to_string())?{DecodingResult::U8(p)if depth==8&&p.len()==w as usize*h as usize*4=>rgb8(&p,w,h,&source,check)?,DecodingResult::U16(p)if depth==16&&p.len()==w as usize*h as usize*4=>rgb16(&p,w,h,&source,check)?,_=>return Err("Unsupported CMYK TIFF sample layout".into())};image.apply_orientation(orientation);
  let mut notes=vec!["TIFF CMYK 源像素经 ICC → sRGB / Source CMYK ICC managed; source metadata stripped".into()];if decoder.more_images(){notes.push("多页 TIFF 静态转换仅首图 / First TIFF image used".into());}
  return Ok(Some(Loaded{image,notes,frames:1,source_depth:depth}));
 }
 Ok(None)
}
