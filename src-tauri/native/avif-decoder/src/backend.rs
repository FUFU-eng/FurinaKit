//! Owns rav1d resources. Only project-owned POD plane views cross the C boundary.
use rav1d::include::dav1d::{dav1d::{Dav1dContext,Dav1dSettings},data::Dav1dData,picture::Dav1dPicture};
use rav1d::src::lib::*;
use std::{ffi::c_void,ptr::NonNull};

#[repr(C)]
pub struct Frame {
    plane:[*mut u8;3], stride:[u32;2],
    width:u32,height:u32,depth:u32,layout:u32,full_range:u32,
    primaries:u32,transfer:u32,matrix:u32,chroma:u32,
}
struct Data(Dav1dData);
impl Drop for Data { fn drop(&mut self) {
    // SAFETY: exclusive initialized slot; send_data updates ownership in this slot.
    unsafe { dav1d_data_unref(Some(NonNull::from(&mut self.0))); }
}}
struct Picture(Dav1dPicture);
impl Drop for Picture { fn drop(&mut self) {
    // SAFETY: exclusively owned default/decoder-populated picture.
    unsafe { dav1d_picture_unref(Some(NonNull::from(&mut self.0))); }
}}
struct Context { ctx:Option<Dav1dContext>, picture:Picture, limit:u32 }
impl Drop for Context { fn drop(&mut self) {
    // Match upstream teardown: release the externally held picture before closing its codec.
    self.picture=Picture(Dav1dPicture::default());
    // SAFETY: unique open context, closes exactly once.
    unsafe { dav1d_close(Some(NonNull::from(&mut self.ctx))); }
}}
#[no_mangle]
pub unsafe extern "C" fn fk_rav1d_create(threads:u32,pixels:u32,operating:u32,layers:u32)->*mut c_void {
    if super::is_cancelled() || pixels==0 || operating>31 || layers>1 {return std::ptr::null_mut();}
    let mut s=std::mem::MaybeUninit::<Dav1dSettings>::uninit();
    // SAFETY: correctly aligned writable settings are fully initialized by rav1d.
    unsafe {dav1d_default_settings(NonNull::new_unchecked(s.as_mut_ptr()));}
    let mut s=unsafe {s.assume_init()};
    s.n_threads=threads.clamp(1,4) as i32; s.max_frame_delay=1;
    s.frame_size_limit=pixels.min(40_000_000); s.strict_std_compliance=1;
    s.operating_point=operating as i32; s.all_layers=layers as i32;
    let mut c=Box::new(Context{ctx:None,picture:Picture(Dav1dPicture::default()),limit:s.frame_size_limit});
    // SAFETY: writable context/settings exclusively held until synchronous open finishes.
    if unsafe {dav1d_open(Some(NonNull::from(&mut c.ctx)),Some(NonNull::from(&mut s)))}.0!=0 {
        return std::ptr::null_mut();
    }
    Box::into_raw(c).cast()
}
#[no_mangle]
pub unsafe extern "C" fn fk_rav1d_destroy(raw:*mut c_void) {
    // SAFETY: C adapter passes each pointer returned by create once, or NULL.
    if !raw.is_null() {drop(unsafe {Box::from_raw(raw.cast::<Context>())});}
}
fn pump(c:&mut Context,bytes:*const u8,len:usize,spatial:u32)->Option<Picture> {
    if super::is_cancelled() || bytes.is_null() || len==0 || len>128*1024*1024 {return None;}
    let mut data=Data(Dav1dData::default());
    // SAFETY: initialized, exclusive slot; allocation bounded by input size.
    let dst=unsafe {dav1d_data_create(Some(NonNull::from(&mut data.0)),len)};
    if dst.is_null(){return None;}
    // SAFETY: private C adapter supplies a live libavif sample for this call;
    // destination is a fresh len-byte rav1d allocation, nonoverlapping.
    unsafe {std::ptr::copy_nonoverlapping(bytes,dst,len);}
    let again=-libc::EAGAIN;
    let mut chosen=None;
    for _ in 0..256 {
        if super::is_cancelled(){return None;}
        let before=data.0.sz;
        let mut sent=0;
        if data.0.data.is_some() {
            // SAFETY: live context; data is exclusively owned and updated on consumption.
            sent=unsafe {dav1d_send_data(c.ctx,Some(NonNull::from(&mut data.0)))}.0;
            if sent!=0 && sent!=again{return None;}
        }
        let mut p=Picture(Dav1dPicture::default());
        // SAFETY: empty picture slot; on success owns a decoder reference.
        let got=unsafe {dav1d_get_picture(c.ctx,Some(NonNull::from(&mut p.0)))}.0;
        if got==again {
            if data.0.data.is_none(){return chosen;}
            if sent==again && data.0.sz==before{return None;}
        } else if got!=0 {return None;}
        else {
            let h=p.0.frame_hdr?;
            // SAFETY: successful live picture owns its frame header reference.
            let wanted=spatial==255 || unsafe {h.as_ref()}.spatial_id as u32==spatial;
            if wanted && chosen.is_none(){chosen=Some(p);}
            // Drain all remaining pictures before returning the selected one.
        }
    }
    None // bounded pump; not an unbounded retry loop for malformed streams
}
#[no_mangle]
pub unsafe extern "C" fn fk_rav1d_frame(raw:*mut c_void,bytes:*const u8,len:usize,spatial:u32,out:*mut Frame)->i32 {
    if raw.is_null() || out.is_null(){return 0;}
    // SAFETY: only private codec adapter holds this context, calls are serialized per context.
    let c=unsafe {&mut *raw.cast::<Context>()};
    let Some(p)=pump(c,bytes,len,spatial) else {return 0;};
    let v=&p.0;
    if v.p.w<=0 || v.p.h<=0 || v.p.w>40000 || v.p.h>40000 ||
       (v.p.w as u64)*(v.p.h as u64)>u64::from(c.limit) ||
       ![8,10,12].contains(&v.p.bpc) || v.p.layout>3 {return 0;}
    let Some(seq)=v.seq_hdr else{return 0;};
    // SAFETY: owned decoded picture retains sequence header until replaced below.
    let seq=unsafe {seq.as_ref()};
    let mut plane=[std::ptr::null_mut();3];let mut stride=[0;2];
    for i in 0..if v.p.layout==0{1}else{3} {
        let Some(ptr)=v.data[i] else{return 0;};
        let si=if i==0{0}else{1};let s=v.stride[si];
        let width=if i!=0 && matches!(v.p.layout,1|2){(v.p.w+1)/2}else{v.p.w};
        let min=width as u64*if v.p.bpc>8{2}else{1};
        if s<=0 || s as u64>u32::MAX as u64 || (s as u64)<min{return 0;}
        plane[i]=ptr.as_ptr().cast();stride[si]=s as u32;
    }
    let f=Frame{plane,stride,width:v.p.w as u32,height:v.p.h as u32,depth:v.p.bpc as u32,
        layout:v.p.layout,full_range:u32::from(seq.color_range),primaries:seq.pri,
        transfer:seq.trc,matrix:seq.mtrx,chroma:seq.chr};
    c.picture=p; // retains planes until next successful frame or context destruction
    // SAFETY: caller supplies writable, correctly aligned local FkFrame storage.
    unsafe {out.write(f);}
    1
}
