//! Pure image engine; production must invoke the bounded worker process, not run codecs on the UI process.
pub mod colour;
pub mod decode;
pub mod image_basic;
#[path = "../../../src/image_artifacts.rs"]
pub mod image_artifacts;
#[path = "../../../src/image_gif.rs"]
pub mod image_gif;
pub fn check_dimensions(w:u32,h:u32)->Result<(),String>{
 if w==0||h==0||w>40000||h>40000||u64::from(w)*u64::from(h)>40_000_000{return Err("图片超过尺寸预算 / Image exceeds dimension budget".into());}Ok(())
}
pub(crate) fn buffer<T:Copy+Default>(n:usize)->Result<Vec<T>,String>{
 if n.checked_mul(std::mem::size_of::<T>()).filter(|b|*b<=256_000_000).is_none(){return Err("图片内存预算超限 / Image buffer budget exceeded".into());}
 let mut v=Vec::new();v.try_reserve_exact(n).map_err(|_|"Image allocation failed")?;v.resize(n,T::default());Ok(v)
}

pub mod png_colour;
#[path = "../../../src/image_process.rs"]
pub mod image_process;
#[path = "../../../src/image_parameters.rs"]
pub mod image_parameters;
pub mod cmyk;
pub mod upscale_pixels;
