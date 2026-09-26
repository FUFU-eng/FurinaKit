//! PNG3 metadata precedence: cICP > iCCP > sRGB > gAMA/cHRM.
//! The pinned png parser validates structure; no handwritten chunk scanner.
use std::io::Cursor;
use image::DynamicImage;
use crate::colour::Encoding;
pub fn metadata(bytes:&[u8],icc:Vec<u8>,notes:&mut Vec<String>)->Result<(Encoding,bool),String>{
 let mut decoder=png::Decoder::new(Cursor::new(bytes));decoder.set_limits(png::Limits{bytes:16*1024*1024});
 let reader=decoder.read_info().map_err(|e|e.to_string())?;let info=reader.info();
 if let Some(c)=info.coding_independent_code_points{
  if c.matrix_coefficients!=0{return Err("PNG cICP requires an identity RGB matrix".into());}
  if !icc.is_empty(){notes.push("PNG3 cICP 优先于 ICC / PNG cICP takes precedence over ICC".into());}
  let cll=info.content_light_level.map(|c|(c.max_content_light_level/10000).min(10000)as u16).unwrap_or(0);
  return Ok((Encoding{icc:Vec::new(),primaries:c.color_primaries.into(),transfer:c.transfer_function.into(),max_cll:cll},!c.is_video_full_range_image));
 }
 if !icc.is_empty(){return Ok((Encoding{icc,primaries:1,transfer:13,max_cll:0},false));}
 if info.srgb.is_some() || (info.gama_chunk.is_none()&&info.chrm_chunk.is_none()){return Ok((Encoding{primaries:1,transfer:13,..Default::default()},false));}
 let mut profile=moxcms::ColorProfile::new_srgb();profile.cicp=None;
 if let Some(ch)=info.chrm_chunk{
  fn xy(v:(png::ScaledFloat,png::ScaledFloat))->Result<moxcms::Chromaticity,String>{let x=v.0.into_value();let y=v.1.into_value();if !x.is_finite()||!y.is_finite()||x<0.0||y<=0.0||x+y>1.00001{return Err("Invalid PNG chromaticity".into());}Ok(moxcms::Chromaticity{x,y})}
  profile.update_rgb_colorimetry(xy(ch.white)?.to_xyyb(),moxcms::ColorPrimaries{red:xy(ch.red)?,green:xy(ch.green)?,blue:xy(ch.blue)?});
  if profile.rgb_to_xyz_matrix().v.iter().flatten().any(|x|!x.is_finite()){return Err("Degenerate PNG chromaticities".into());}
 }
 if let Some(g)=info.gama_chunk{let g=g.into_value();if !(0.01..=10.0).contains(&g){return Err("PNG gamma outside supported range".into());}
  let curve=moxcms::curve_from_gamma(1.0/g);profile.red_trc=Some(curve.clone());profile.green_trc=Some(curve.clone());profile.blue_trc=Some(curve);
 }
 notes.push("PNG gAMA/cHRM → sRGB".into());Ok((Encoding{icc:profile.encode().map_err(|e|e.to_string())?,primaries:1,transfer:13,max_cll:0},false))
}
pub fn expand_video_range(image:DynamicImage,depth:u32)->Result<DynamicImage,String>{
 if u64::from(image.width())*u64::from(image.height())*8>256_000_000{return Err("Range conversion exceeds buffer budget".into());}
 if depth==8 {let mut p=image.into_rgba8();for px in p.pixels_mut(){for c in 0..3{px[c]=(((i32::from(px[c])-16).max(0)*255+109)/219).min(255)as u8;}}Ok(DynamicImage::ImageRgba8(p))}
 else{let mut p=image.into_rgba16();for px in p.pixels_mut(){for c in 0..3{px[c]=(((i64::from(px[c])-4096).max(0)*65535+28032)/56064).min(65535)as u16;}}Ok(DynamicImage::ImageRgba16(p))}
}
