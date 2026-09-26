//! Explicit SDR output policy. ICC has priority over container CICP. No source-profile relabelling.
use image::{DynamicImage,ImageBuffer};
use moxcms::{ColorProfile,DataColorSpace,CicpProfile,CicpColorPrimaries,TransferCharacteristics as Trc,MatrixCoefficients,Layout,TransformOptions,ParsingOptions,RenderingIntent};
#[derive(Default)]
pub struct Encoding {pub icc:Vec<u8>,pub primaries:u16,pub transfer:u16,pub max_cll:u16}
pub(crate) fn parse_icc(bytes:&[u8])->Result<ColorProfile,String>{
 if bytes.len()>4*1024*1024{return Err("ICC exceeds 4 MiB".into());}
 ColorProfile::new_from_slice_with_options(bytes,ParsingOptions{max_profile_size:4*1024*1024+1,max_allowed_clut_size:8*1024*1024,max_allowed_trc_size:65536}).map_err(|e|format!("无效/不支持的 ICC / Invalid ICC: {e}"))
}
fn profile(e:&Encoding,notes:&mut Vec<String>)->Result<(ColorProfile,bool,u16),String>{
 if !e.icc.is_empty(){
  let p=parse_icc(&e.icc)?;
  if !matches!(p.color_space,DataColorSpace::Rgb|DataColorSpace::Gray){return Err("ICC 与已解码 RGB 不兼容 / ICC requires a source-colour-aware decoder".into());}
  // ICC is authoritative. Container PQ/HLG must not override a conflicting SDR profile.
  let transfer=p.cicp.as_ref().map(|c|c.transfer_characteristics as u16).unwrap_or(0);
  notes.push("ICC → sRGB".into());return Ok((p,true,transfer));
 }
 let prim=if e.primaries==0||e.primaries==2 {notes.push("未指定原色，按 BT.709 / Unspecified primaries: assuming BT.709".into());1}else{e.primaries};
 let transfer=if e.transfer==0||e.transfer==2 {notes.push("未指定传递函数，按 sRGB / Unspecified transfer: assuming sRGB".into());13}else{e.transfer};
 let cp=CicpColorPrimaries::try_from(u8::try_from(prim).map_err(|_|"Invalid CICP primaries")?).map_err(|e|e.to_string())?;
 if matches!(cp,CicpColorPrimaries::Reserved|CicpColorPrimaries::Unspecified|CicpColorPrimaries::Xyz){return Err("Unsupported RGB CICP primaries".into());}
 let tc=Trc::try_from(u8::try_from(transfer).map_err(|_|"Invalid CICP transfer")?).map_err(|e|e.to_string())?;
 if matches!(tc,Trc::Reserved|Trc::Unspecified){return Err("Unsupported CICP transfer".into());}
 let p=ColorProfile::new_from_cicp(CicpProfile{color_primaries:cp,transfer_characteristics:if transfer==18{Trc::Linear}else{tc},matrix_coefficients:MatrixCoefficients::Identity,full_range:true});
 if !p.is_matrix_shaper(){return Err("Incomplete CICP RGB colour profile".into());}
 Ok((p,false,transfer))
}
pub(crate) fn options(icc:bool)->TransformOptions {TransformOptions{rendering_intent:RenderingIntent::RelativeColorimetric,allow_use_cicp_transfer:!icc,prefer_fixed_point:false,allow_extended_range_rgb_xyz:true,..Default::default()}}
/// HDR -> SDR: global extended-Reinhard luminance shoulder, 203-nit reference;
/// PQ absolute 10,000-nit range, HLG 1,000-nit display / 1.2 system gamma.
/// MaxCLL supplies the shoulder white (default 1000), constrained to 203..10000.
/// This is a named, lossy rendering policy, NOT HDR metadata preservation.
fn tone(rgb:&mut [f32],transfer:u16,max_cll:u16){
 let scale=if transfer==16{10000.0/203.0}else{1000.0/203.0};
 for c in rgb.iter_mut(){*c=(*c*scale).max(0.0);}
 let y=0.2126*rgb[0]+0.7152*rgb[1]+0.0722*rgb[2];
 let white=f32::from(if max_cll==0{1000}else{max_cll}).clamp(203.0,10000.0)/203.0;
 let k=if y>0.0{(1.0+y/(white*white))/(1.0+y)}else{0.0};
 for c in rgb.iter_mut(){let linear=(*c*k).clamp(0.0,1.0);*c=if linear<=0.0031308{12.92*linear}else{1.055*linear.powf(1.0/2.4)-0.055};}
}
// BT.2100 HLG inverse OETF: scene-linear samples, NOT per-channel display gamma.
fn hlg_scene(e:f32)->f32{if e<=0.5{e*e/3.0}else{(((e-0.55991073)/0.17883277).exp()+0.28466892)/12.0}}
fn hlg_ootf(rgb:&mut [f32]){let ys=(0.2126*rgb[0]+0.7152*rgb[1]+0.0722*rgb[2]).max(0.0);let gain=ys.powf(0.2);for c in rgb{*c*=gain;}}
pub fn to_srgb(image:DynamicImage,e:&Encoding,check:&dyn Fn()->Result<(),String>,notes:&mut Vec<String>)->Result<DynamicImage,String>{
 check()?;
 if e.icc.is_empty()&&e.primaries==1&&e.transfer==13{return Ok(image);}
 let (source,icc,transfer)=profile(e,notes)?;
 let gray=source.color_space==DataColorSpace::Gray;let layout=if gray{Layout::GrayAlpha}else{Layout::Rgba};
 let hdr=matches!(transfer,16|18);
 let dst=if hdr{ColorProfile::new_from_cicp(CicpProfile{color_primaries:CicpColorPrimaries::Bt709,transfer_characteristics:Trc::Linear,matrix_coefficients:MatrixCoefficients::Identity,full_range:true})}else{ColorProfile::new_srgb()};
 let wide=matches!(image.color(),image::ColorType::L16|image::ColorType::La16|image::ColorType::Rgb16|image::ColorType::Rgba16|image::ColorType::Rgb32F|image::ColorType::Rgba32F);
 let (w,h)=(image.width(),image.height());crate::check_dimensions(w,h)?;
 // Preserve full-range RGBA16 samples/alpha. Work one bounded row at a time.
 if u64::from(w)*u64::from(h)*8>256_000_000{return Err("Colour output exceeds buffer budget".into());}
 let mut pixels=image.into_rgba16();
 if hdr{
  if transfer==18&&!icc{notes.push("HLG: BT.2100 scene-linear inverse OETF + luminance-dependent 1000-nit OOTF (gamma 1.2)".into());}
  notes.push(format!("HDR → SDR：Reinhard / 203-nit reference, {}-nit shoulder; HDR metadata not retained",if e.max_cll==0{1000}else{e.max_cll}));
  let transform=source.create_transform_f32(layout,&dst,Layout::Rgba,options(icc)).map_err(|e|e.to_string())?;
  let mut input=crate::buffer::<f32>(w as usize*if gray{2}else{4})?;let mut output=crate::buffer::<f32>(w as usize*4)?;
  for row in pixels.as_mut().chunks_exact_mut(w as usize*4){check()?;
   for (i,p)in row.chunks_exact(4).enumerate(){if gray{input[i*2]=f32::from(p[0])/65535.0;input[i*2+1]=f32::from(p[3])/65535.0;}else{for c in 0..4{input[i*4+c]=f32::from(p[c])/65535.0;}}}
   if transfer==18&&!icc{for p in input.chunks_exact_mut(if gray{2}else{4}){let channels=if gray{1}else{3};for c in &mut p[..channels]{*c=hlg_scene(*c);}}}
   transform.transform(&input,&mut output).map_err(|e|e.to_string())?;
   for (p,rgb)in row.chunks_exact_mut(4).zip(output.chunks_exact_mut(4)){
    if rgb[..3].iter().any(|n|!n.is_finite()){return Err("Non-finite HDR colour transform".into());}
    if transfer==18&&!icc{hlg_ootf(&mut rgb[..3]);}
    tone(&mut rgb[..3],transfer,e.max_cll);for c in 0..3{p[c]=(rgb[c]*65535.0).round().clamp(0.0,65535.0)as u16;}
   }
  }
 }else{
  let transform=source.create_transform_16bit(layout,&dst,Layout::Rgba,options(icc)).map_err(|e|e.to_string())?;
  let mut input=crate::buffer::<u16>(w as usize*if gray{2}else{4})?;let mut output=crate::buffer::<u16>(w as usize*4)?;
  for row in pixels.as_mut().chunks_exact_mut(w as usize*4){check()?;
   if gray{for(i,p)in row.chunks_exact(4).enumerate(){input[i*2]=p[0];input[i*2+1]=p[3];}}else{input.copy_from_slice(row);}
   transform.transform(&input,&mut output).map_err(|e|e.to_string())?;
   for(p,c)in row.chunks_exact_mut(4).zip(output.chunks_exact(4)){p[..3].copy_from_slice(&c[..3]);} // alpha is never colour transformed
  }
 }
 if wide{Ok(DynamicImage::ImageRgba16(pixels))}else{let data:Vec<u8>=pixels.into_raw().into_iter().map(|n|((u32::from(n)+128)/257)as u8).collect();Ok(DynamicImage::ImageRgba8(ImageBuffer::from_raw(w,h,data).ok_or("Invalid colour output")?))}
}
