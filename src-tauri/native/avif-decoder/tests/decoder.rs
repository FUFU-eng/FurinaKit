use furinakit_avif_decoder::{decode,DecodedAvif,Pixels};
use std::{path::PathBuf,sync::atomic::AtomicBool};
fn fixture(name:&str)->Vec<u8>{let root=std::env::var_os("FURINAKIT_AVIF_FIXTURES").expect("explicit public fixture directory required");std::fs::read(PathBuf::from(root).join(name)).unwrap()}
fn read(name:&str,frame:u32)->DecodedAvif{decode(&fixture(name),frame,&AtomicBool::new(false)).unwrap_or_else(|e|panic!("{name} frame {frame}: {e}"))}
fn rgba(v:&DecodedAvif)->&[u8]{match &v.pixels{Pixels::Rgba8(p)=>p,_=>panic!("expected 8-bit")}}
fn compare_png_oracle(v:&DecodedAvif,oracle:&str){
 let expected=fixture(oracle);let actual=rgba(v);assert_eq!(actual.len(),expected.len());
 let mut max_rgb=0;let mut max_alpha=0;
 for (a,b) in actual.chunks_exact(4).zip(expected.chunks_exact(4)){
  max_alpha=max_alpha.max(a[3].abs_diff(b[3]));
  if b[3]!=0{for k in 0..3{max_rgb=max_rgb.max(a[k].abs_diff(b[k]));}}
 }
 println!("PNG_ORACLE {oracle}: max visible RGB error={max_rgb}, max alpha error={max_alpha}");
 assert!(max_rgb<=8,"visible RGB differs from source PNG beyond lossy tolerance");assert_eq!(max_alpha,0);
}
// white_1x1 is lossy default quality; independent Pillow/libavif oracle is 253, not 255.
#[test]fn white_pixel(){let v=read("white_1x1.avif",0);assert_eq!((v.width,v.height),(1,1));assert_eq!(rgba(&v),&[253,253,253,255]);}
#[test]fn idat_progressive_alpha_png_oracles(){for name in ["draw_points_idat.avif","draw_points_idat_metasize0.avif","draw_points_idat_progressive.avif","draw_points_idat_progressive_metasize0.avif"]{
 let v=read(name,0);assert_eq!((v.width,v.height),(33,11));assert!(v.has_alpha);compare_png_oracle(&v,"draw_points.rgba");}}
#[test]fn rotation_alpha_and_legacy_compatibility(){let a=read("abc_color_irot_alpha_irot.avif",0);let b=read("abc_color_irot_alpha_NOirot.avif",0);
 assert_eq!((a.width,a.height),(256,512));assert!(a.has_alpha&&b.has_alpha);assert_eq!(rgba(&a),rgba(&b));compare_png_oracle(&a,"abc_ccw.rgba");}
#[test]fn independent_color_grid_alpha_item(){let v=read("color_grid_alpha_nogrid.avif",0);assert!(v.has_alpha);let p=rgba(&v);assert_eq!(p.len(),v.width as usize*v.height as usize*4);assert!(p.chunks_exact(4).any(|p|p[3]!=255));println!("GRID+ALPHA {}x{}",v.width,v.height);}
#[test]fn five_tile_grid(){let v=read("sofa_grid1x5_420.avif",0);assert!(v.width>0&&v.height>0);assert_eq!(rgba(&v).len(),v.width as usize*v.height as usize*4);println!("GRID {}x{}",v.width,v.height);}
#[test]fn sequence_alpha_metadata_and_random_access(){let a=read("colors-animated-8bpc-alpha-exif-xmp.avif",0);let b=read("colors-animated-8bpc-alpha-exif-xmp.avif",4);
 for v in [&a,&b]{assert_eq!(v.frame_count,5);assert!(v.has_alpha);assert_eq!(v.source_exif.len(),1126);assert_eq!(v.source_xmp.len(),3898);assert!(v.duration_ticks>0&&v.timescale>0);}
 assert_eq!(a.frame_index,0);assert_eq!(b.frame_index,4);assert_ne!(rgba(&a),rgba(&b));
 let c=read("colors-animated-12bpc-keyframes-0-2-3.avif",2);assert_eq!(c.source_depth,12);assert_eq!(c.frame_index,2);assert!(matches!(c.pixels,Pixels::Rgba16(_)));}
#[test]fn icc_exif_xmp_preserved_as_source_metadata(){let v=read("paris_icc_exif_xmp.avif",0);assert_eq!((v.width,v.height),(403,302));assert_eq!(v.colour.icc,fixture("paris.icc"));assert_eq!(v.source_exif.len(),1126);assert_eq!(v.source_xmp.len(),3898);}
#[test]fn hdr_and_gain_map_are_explicit_not_srgb_claims(){let v=read("colors_hdr_rec2020.avif",0);println!("HDR depth={} CICP={}/{}/{}",v.source_depth,v.colour.primaries,v.colour.transfer,v.colour.matrix);assert_ne!(v.colour.transfer,13);assert_eq!(v.colour.primaries,9);
 let v=read("seine_sdr_gainmap_srgb.avif",0);assert!(v.colour.gain_map_present);}
#[test]fn sixteen_bit_sample_transform(){let v=read("weld_sato_12B_8B_q0.avif",0);assert_eq!(v.source_depth,16);match v.pixels{Pixels::Rgba16(p)=>{assert_eq!(p.len(),v.width as usize*v.height as usize*4);assert!(p.iter().any(|x|*x>4095&&*x<65535));},_=>panic!("16-bit precision lost")}}
#[test]fn unknown_nonessential_accepted_invalid_transform_and_missing_alpha_ispe_rejected(){assert!(read("clop_irot_imor.avif",0).height>0);assert!(read("circle_custom_properties.avif",0).width>0);
 for n in ["clap_irot_imir_non_essential.avif","alpha_noispe.avif"]{assert!(decode(&fixture(n),0,&AtomicBool::new(false)).is_err(),"{n}");}}
#[test]fn malformed_truncated_index_and_cancel_then_restart(){let b=fixture("white_1x1.avif");let no=AtomicBool::new(false);
 for n in [0,1,8,20,b.len()/2,b.len()-1]{assert!(decode(&b[..n],0,&no).is_err(),"truncation {n}");}
 assert!(decode(&[42;128],0,&no).is_err());assert!(decode(&b,1,&no).is_err());assert!(decode(&b,0,&AtomicBool::new(true)).is_err());assert!(decode(&b,0,&no).is_ok());}
#[test]fn independent_concurrent_contexts(){let handles:Vec<_>=(0..4).map(|_|std::thread::spawn(||{for _ in 0..8{let v=read("white_1x1.avif",0);assert_eq!(rgba(&v),&[253,253,253,255]);}})).collect();for h in handles{h.join().unwrap();}}
#[test]fn container_crop_rotate_mirror_10bit_png_oracle(){
 let v=read("clap_irot_imir_valid.avif",0);assert_eq!((v.width,v.height,v.source_depth),(10,8,10));
 let expected=fixture("clap_irot_imir.rgba");let p=match v.pixels{Pixels::Rgba16(p)=>p,_=>panic!("10-bit precision lost")};assert_eq!(p.len(),expected.len());
 let mut max=0;for(a,b)in p.iter().zip(expected){let scaled=((u32::from(*a)+128)/257) as u8;max=max.max(scaled.abs_diff(b));}
 // Independently prove geometry with exact 16-bit pixels from IDENTICAL coded samples,
 // with nonessential transforms renamed to unknown properties. This avoids treating
 // differing 10->8 vs 10->16->8 reformat rounding as a geometry error.
 let raw=read("geometry_raw_same_samples.avif",0);assert_eq!((raw.width,raw.height),(12,34));
 let raw=match raw.pixels{Pixels::Rgba16(p)=>p,_=>panic!("raw precision lost")};
 for y in 0..8usize{for x in 0..10usize{
  let src=((15-x)*12+(11-y))*4;let dst=(y*10+x)*4;
  assert_eq!(&p[dst..dst+4],&raw[src..src+4],"exact 16-bit crop/CCW/mirror at {x},{y}");
 }}
 println!("10-bit geometry exact at 16-bit; independent Pillow RGB8 max error={max} (different integer reformat/output precision)");assert!(max<=2);
}
