//! Native AVIF decoding surface; NOT yet connected to the application routing.
//! libavif 1.4.2 handles container/grid/alpha/sequence semantics, rav1d handles AV1.
//! Output is straight-alpha RGBA in the SOURCE colour encoding, with metadata.
//! This is deliberately not an implicit sRGB conversion or HDR tone-mapping API.
#![deny(unsafe_op_in_unsafe_fn)]
mod backend;
mod geometry;
use std::{cell::Cell,ffi::{c_char,c_void,CStr},ptr::NonNull,sync::atomic::{AtomicBool,Ordering}};
thread_local! {static CANCEL:Cell<*const AtomicBool>=const{Cell::new(std::ptr::null())};}
struct CancelScope(*const AtomicBool);
impl CancelScope {fn new(c:&AtomicBool)->Self{Self(CANCEL.with(|v|v.replace(c)))}}
impl Drop for CancelScope {fn drop(&mut self){CANCEL.with(|v|v.set(self.0));}}
fn is_cancelled()->bool {CANCEL.with(|v|{let p=v.get();!p.is_null()&&
    // SAFETY: synchronous decode owns CancelScope, which is dropped before the caller reference expires.
    unsafe{(*p).load(Ordering::Relaxed)}})}
#[no_mangle]
pub extern "C" fn fk_cancelled()->i32 {i32::from(is_cancelled())}
#[repr(C)]
#[derive(Default,Clone,Copy)]
struct Info {
    duration:u64,timescale:u64,width:u32,height:u32,depth:u32,count:u32,index:u32,
    crop_x:u32,crop_y:u32,crop_w:u32,crop_h:u32,rotation:u32,mirror:i32,
    primaries:u32,transfer:u32,matrix:u32,alpha:u32,gain_map:u32,pasp_h:u32,pasp_v:u32,
    icc_len:u32,exif_len:u32,xmp_len:u32,max_cll:u32,max_pall:u32,
}
extern "C" {
    fn fk_avif_open(bytes:*const u8,len:usize,error:*mut c_char,n:usize)->*mut c_void;
    fn fk_avif_close(handle:*mut c_void);
    fn fk_avif_decode(handle:*mut c_void,index:u32,error:*mut c_char,n:usize)->i32;
    fn fk_avif_info(handle:*mut c_void,info:*mut Info,error:*mut c_char,n:usize)->i32;
    fn fk_avif_rgba(handle:*mut c_void,pixels:*mut c_void,len:usize,depth:u32,error:*mut c_char,n:usize)->i32;
    fn fk_avif_metadata(handle:*mut c_void,which:u32,bytes:*mut u8,len:usize)->i32;
    fn fk_avif_info_size()->usize;
    fn fk_avif_is_avif(bytes:*const u8,len:usize)->i32;
    fn fk_avif_frame_size()->usize;
}
struct Handle(NonNull<c_void>);
impl Drop for Handle {fn drop(&mut self){
    // SAFETY: unique decoder allocated by open, destroyed before input bytes go out of scope.
    unsafe{fk_avif_close(self.0.as_ptr());}
}}
#[derive(Debug)]
pub enum Pixels {Rgba8(Vec<u8>),Rgba16(Vec<u16>)}
#[derive(Debug)]
pub struct SourceColour {
    pub icc:Vec<u8>,pub primaries:u16,pub transfer:u16,pub matrix:u16,
    pub max_content_light:u16,pub max_average_light:u16,
    /// Gain map is NOT baked into RGBA. Consumers must not claim a tone-mapped result.
    pub gain_map_present:bool,
}
#[derive(Debug)]
pub struct DecodedAvif {
    pub width:u32,pub height:u32,pub source_depth:u32,pub pixels:Pixels,pub colour:SourceColour,
    pub has_alpha:bool,pub pixel_aspect:[u32;2],pub frame_index:u32,pub frame_count:u32,
    pub duration_ticks:u64,pub timescale:u64,
    /// Source metadata only: do not blindly reinsert EXIF orientation after geometry was applied.
    pub source_exif:Vec<u8>,pub source_xmp:Vec<u8>,
}
fn allocate<T:Copy+Default>(n:usize)->Result<Vec<T>,String>{
    let bytes=n.checked_mul(std::mem::size_of::<T>()).ok_or("AVIF size overflow")?;
    if bytes>256_000_000{return Err("AVIF RGBA exceeds 256 MB output budget".into());}
    let mut v=Vec::new();v.try_reserve_exact(n).map_err(|_|"AVIF allocation failed")?;v.resize(n,T::default());Ok(v)
}
fn error(buf:&[c_char;512])->String {
    // SAFETY: C snprintf uses the full zero-initialized buffer and always terminates it.
    unsafe{CStr::from_ptr(buf.as_ptr())}.to_string_lossy().into_owned()
}
fn info(h:&Handle,e:&mut [c_char;512])->Result<Info,String>{
    let mut v=Info::default();
    // SAFETY: live decoder, correctly aligned POD, writable error buffer.
    if unsafe{fk_avif_info(h.0.as_ptr(),&mut v,e.as_mut_ptr(),e.len())}==0{return Err(error(e));}
    geometry::validate(&v)?;Ok(v)
}
fn metadata(h:&Handle,which:u32,len:u32)->Result<Vec<u8>,String>{
    if len>4*1024*1024{return Err("AVIF metadata limit".into());}
    let mut v=allocate::<u8>(len as usize)?;
    // SAFETY: metadata length read from this unchanged decoder, writable exact-sized buffer.
    if unsafe{fk_avif_metadata(h.0.as_ptr(),which,v.as_mut_ptr(),v.len())}==0{return Err("AVIF metadata copy failed".into());}
    Ok(v)
}
/// Decodes a selected sequence frame (0 for a still) from an immutable bounded input.
/// Cancellation is cooperative between container/codec calls and geometry rows; it
/// cannot interrupt an in-progress rav1d worker or libavif reformat kernel.
/// Budgets bound input/output, not total decoder native allocations or process RSS.
pub fn decode(bytes:&[u8],frame:u32,cancel:&AtomicBool)->Result<DecodedAvif,String>{
    if bytes.is_empty() || bytes.len()>128*1024*1024{return Err("AVIF input exceeds bounds".into());}
    let _scope=CancelScope::new(cancel);
    if is_cancelled(){return Err("AVIF cancelled".into());}
    // SAFETY: no pointers involved; fail closed if the compiled C/Rust POD sizes disagree.
    if unsafe{fk_avif_info_size()}!=std::mem::size_of::<Info>() || unsafe{fk_avif_frame_size()}!=std::mem::size_of::<backend::Frame>(){return Err("AVIF bridge ABI mismatch".into());}
    let mut e=[0 as c_char;512];
    // SAFETY: immutable bytes remain alive throughout decoder lifetime; writable error buffer.
    let h=Handle(NonNull::new(unsafe{fk_avif_open(bytes.as_ptr(),bytes.len(),e.as_mut_ptr(),e.len())}).ok_or_else(||error(&e))?);
    let before=info(&h,&mut e)?;
    if frame>=before.count{return Err("AVIF frame index out of range".into());}
    let budget=u64::from(before.width)*u64::from(before.height)*4*if before.depth>8{2}else{1};
    if budget>256_000_000{return Err("AVIF output budget exceeded".into());}
    // SAFETY: live exclusive decoder; validated frame index.
    if unsafe{fk_avif_decode(h.0.as_ptr(),frame,e.as_mut_ptr(),e.len())}==0{return Err(error(&e));}
    let v=info(&h,&mut e)?;let (width,height)=geometry::validate(&v)?;
    let n=v.width as usize*v.height as usize*4;
    let pixels=if v.depth>8 {
        let mut p=allocate::<u16>(n)?;
        // SAFETY: live decoder, aligned uint16 RGBA output, capacity/byte length match dimensions.
        if unsafe{fk_avif_rgba(h.0.as_ptr(),p.as_mut_ptr().cast(),p.len()*2,16,e.as_mut_ptr(),e.len())}==0{return Err(error(&e));}
        Pixels::Rgba16(geometry::apply(p,&v,cancel)?)
    } else {
        let mut p=allocate::<u8>(n)?;
        // SAFETY: live decoder and an exact-size writable RGBA8 output.
        if unsafe{fk_avif_rgba(h.0.as_ptr(),p.as_mut_ptr().cast(),p.len(),8,e.as_mut_ptr(),e.len())}==0{return Err(error(&e));}
        Pixels::Rgba8(geometry::apply(p,&v,cancel)?)
    };
    if is_cancelled(){return Err("AVIF cancelled".into());}
    Ok(DecodedAvif{width,height,source_depth:v.depth,pixels,
        colour:SourceColour{icc:metadata(&h,0,v.icc_len)?,primaries:v.primaries as u16,transfer:v.transfer as u16,
            matrix:v.matrix as u16,max_content_light:v.max_cll as u16,max_average_light:v.max_pall as u16,
            gain_map_present:v.gain_map!=0},has_alpha:v.alpha!=0,pixel_aspect:if v.rotation%2==1{[v.pasp_v,v.pasp_h]}else{[v.pasp_h,v.pasp_v]},
        frame_index:v.index,frame_count:v.count,duration_ticks:v.duration,timescale:v.timescale,
        source_exif:metadata(&h,1,v.exif_len)?,source_xmp:metadata(&h,2,v.xmp_len)?})
}
/// Recognize compatible AVIF/AVIS brands using libavif, not a file extension.
pub fn is_avif(bytes:&[u8])->bool{
 // SAFETY: bounded immutable slice, only inspected synchronously.
 !bytes.is_empty() && unsafe{fk_avif_is_avif(bytes.as_ptr(),bytes.len())}!=0
}
