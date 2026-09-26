//! Windows' inbox PDF rasterizer. No bundled renderer, shell, Python or network.
use std::path::Path;
use windows::{core::HSTRING, Data::Pdf::{PdfDocument,PdfPageRenderOptions}, Storage::{StorageFile,Streams::{InMemoryRandomAccessStream,DataReader}}, Win32::System::WinRT::{RoInitialize,RoUninitialize,RO_INIT_MULTITHREADED}};
fn err(e:impl std::fmt::Display)->String{format!("Windows PDF 渲染失败 / Windows PDF rendering failed: {e}")}
struct Apartment;
impl Drop for Apartment{fn drop(&mut self){unsafe{RoUninitialize()}}}
pub struct Renderer{document:PdfDocument,_apartment:Apartment}
impl Renderer{
    pub fn open(path:&Path)->Result<Self,String>{
        unsafe{RoInitialize(RO_INIT_MULTITHREADED)}.map_err(err)?;
        let apartment=Apartment;
        let path=std::fs::canonicalize(path).map_err(err)?;
        // StorageFile expects an ordinary absolute Win32/UNC path, not the extended prefix.
        let raw=path.to_str().ok_or("PDF 路径不是有效 Unicode / PDF path is not Unicode")?;
        let raw=if let Some(rest)=raw.strip_prefix(r"\\?\UNC\"){format!(r"\\{rest}")}else{raw.strip_prefix(r"\\?\").unwrap_or(raw).to_owned()};
        let file=StorageFile::GetFileFromPathAsync(&HSTRING::from(raw)).map_err(err)?.get().map_err(err)?;
        let document=PdfDocument::LoadFromFileAsync(&file).map_err(err)?.get().map_err(err)?;
        Ok(Self{document,_apartment:apartment})
    }
    pub fn count(&self)->Result<u32,String>{self.document.PageCount().map_err(err)}
    pub fn render(&self,index:u32,dpi:u32,destination:&Path,check:&dyn Fn()->Result<(),String>)->Result<(u32,u32,f64),String>{
        check()?;let page=self.document.GetPage(index).map_err(err)?;
        let outcome=(||{
            let size=page.Size().map_err(err)?; if !size.Width.is_finite()||!size.Height.is_finite()||size.Width<=0.0||size.Height<=0.0{return Err("无效 PDF 页面尺寸 / Invalid PDF page size".into());}
            // WinRT Size is in 96-DPI DIPs, NOT the PDF coordinate system's 72-point inches.
            let w=(size.Width as f64*dpi as f64/96.0).ceil();let h=(size.Height as f64*dpi as f64/96.0).ceil();
            if w*h>16_000_000.0||w>32768.0||h>32768.0{return Err("页面在所选 DPI 下过大，请降低 DPI 或先裁剪 / Page too large; lower DPI or crop first".into());}
            let (w,h)=(w as u32,h as u32);
            let stream=InMemoryRandomAccessStream::new().map_err(err)?;
            let options=PdfPageRenderOptions::new().map_err(err)?;
            options.SetDestinationWidth(w).map_err(err)?;options.SetDestinationHeight(h).map_err(err)?;
            options.SetBackgroundColor(windows::UI::Color{A:255,R:255,G:255,B:255}).map_err(err)?;
            options.SetIsIgnoringHighContrast(true).map_err(err)?;
            page.RenderWithOptionsToStreamAsync(&stream,&options).map_err(err)?.get().map_err(err)?;check()?;
            let length=stream.Size().map_err(err)?;
            if length==0||length>128_000_000{return Err("PDF 页面编码超出限制 / Rendered page exceeds size limit".into());}
            let reader=DataReader::CreateDataReader(&stream.GetInputStreamAt(0).map_err(err)?).map_err(err)?;
            let mut data=vec![0u8;length as usize];let mut offset=0;
            while offset<data.len(){check()?;let loaded=reader.LoadAsync(((data.len()-offset).min(1_048_576)) as u32).map_err(err)?.get().map_err(err)? as usize;
                if loaded==0{return Err("PDF 页面读取中断 / Truncated rendered page".into());}
                reader.ReadBytes(&mut data[offset..offset+loaded]).map_err(err)?;offset+=loaded;
            }
            check()?;crate::atomic_store::write(destination,&data)?;
            let (w,h)=image::ImageReader::open(destination).map_err(err)?.with_guessed_format().map_err(err)?.into_dimensions().map_err(err)?;
            if w==0||h==0{return Err("PDF 渲染输出尺寸无效 / Invalid rendered dimensions".into());}
            Ok((w,h,size.Width as f64/size.Height as f64))
        })();
        let _=page.Close();outcome
    }
}
