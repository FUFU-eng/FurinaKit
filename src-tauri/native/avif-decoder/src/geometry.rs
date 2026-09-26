use super::Info;
use std::sync::atomic::{AtomicBool,Ordering};

pub(crate) fn validate(v:&Info)->Result<(u32,u32),String> {
    if v.width==0 || v.height==0 || v.width>40000 || v.height>40000 ||
        u64::from(v.width)*u64::from(v.height)>40_000_000 || ![8,10,12,16].contains(&v.depth) {
        return Err("AVIF invalid dimensions/depth".into());
    }
    if v.crop_w==0 || v.crop_h==0 || v.crop_x.checked_add(v.crop_w).is_none_or(|n|n>v.width) ||
        v.crop_y.checked_add(v.crop_h).is_none_or(|n|n>v.height) ||
        v.rotation>3 || !(-1..=1).contains(&v.mirror) || v.pasp_h==0 || v.pasp_v==0 {
        return Err("AVIF invalid display geometry".into());
    }
    Ok(if v.rotation%2==0{(v.crop_w,v.crop_h)}else{(v.crop_h,v.crop_w)})
}
pub(crate) fn apply<T:Copy+Default>(input:Vec<T>,v:&Info,cancel:&AtomicBool)->Result<Vec<T>,String> {
    let (w,h)=validate(v)?;
    if input.len()!=v.width as usize*v.height as usize*4{return Err("AVIF RGBA length mismatch".into());}
    if cancel.load(Ordering::Relaxed){return Err("AVIF cancelled".into());}
    if v.crop_x==0 && v.crop_y==0 && v.crop_w==v.width && v.crop_h==v.height && v.rotation==0 && v.mirror==-1{return Ok(input);}
    let count=(w as usize).checked_mul(h as usize).and_then(|n|n.checked_mul(4)).ok_or("AVIF output overflow")?;
    let mut output=super::allocate::<T>(count)?;
    for y in 0..h {
        if cancel.load(Ordering::Relaxed){return Err("AVIF cancelled".into());}
        for x in 0..w {
            // Transform order: crop -> counterclockwise rotation -> display-space mirror.
            // Reverse that order when locating the source pixel.
            let mx=if v.mirror==1{w-1-x}else{x};let my=if v.mirror==0{h-1-y}else{y};
            let (sx,sy)=match v.rotation {0=>(mx,my),1=>(v.crop_w-1-my,mx),
                2=>(v.crop_w-1-mx,v.crop_h-1-my),3=>(my,v.crop_h-1-mx),_=>unreachable!()};
            let src=(((sy+v.crop_y) as usize)*v.width as usize+(sx+v.crop_x) as usize)*4;
            let dst=((y as usize)*w as usize+x as usize)*4;
            output[dst..dst+4].copy_from_slice(&input[src..src+4]);
        }
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn all_rotations_mirrors_rgba8_and_rgba16() {
        // Oracle is hand-enumerated CCW output for an asymmetric 3x2 grid.
        let rotations=[vec![1,2,3,4,5,6],vec![3,6,2,5,1,4],vec![6,5,4,3,2,1],vec![4,1,5,2,6,3]];
        let cancel=AtomicBool::new(false);
        for rotation in 0..4 {for mirror in -1..=1 {
            let v=Info{width:5,height:4,depth:8,crop_x:1,crop_y:1,crop_w:3,crop_h:2,rotation,mirror,pasp_h:1,pasp_v:1,..Info::default()};
            let (w,h)=validate(&v).unwrap();let mut expected=rotations[rotation as usize].clone();
            if mirror==0 {let old=expected.clone();for y in 0..h as usize{expected[y*w as usize..(y+1)*w as usize].copy_from_slice(&old[(h as usize-1-y)*w as usize..(h as usize-y)*w as usize]);}}
            if mirror==1 {for row in expected.chunks_exact_mut(w as usize){row.reverse();}}
            let mut input=vec![0u8;5*4*4];
            for (n,(x,y)) in [(1,1),(2,1),(3,1),(1,2),(2,2),(3,2)].iter().enumerate(){input[(y*5+x)*4..(y*5+x)*4+4].fill(n as u8+1);}
            let got=apply(input.clone(),&v,&cancel).unwrap();assert_eq!(got.chunks_exact(4).map(|x|x[0]).collect::<Vec<_>>(),expected);
            let got16=apply(input.into_iter().map(|x|u16::from(x)*257).collect(),&v,&cancel).unwrap();
            assert_eq!(got16,got.iter().map(|x|u16::from(*x)*257).collect::<Vec<_>>());
        }}
    }
    #[test]
    fn invalid_crop_and_cancel_fail_closed() {
        let mut v=Info{width:3,height:2,depth:8,crop_w:3,crop_h:2,pasp_h:1,pasp_v:1,mirror:-1,..Info::default()};
        assert!(apply(vec![0u8;24],&v,&AtomicBool::new(true)).is_err());
        v.crop_x=u32::MAX;assert!(validate(&v).is_err());
        v.crop_x=0;v.mirror=2;assert!(validate(&v).is_err());
    }
}
