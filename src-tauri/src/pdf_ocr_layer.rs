//! Append invisible, Unicode-mapped text without rasterizing/replacing original page content.
use std::{collections::BTreeMap,path::Path};
use lopdf::{dictionary,Document,Object,ObjectId,Dictionary,Stream,content::{Content,Operation},StringFormat};
use serde_json::Value;
fn err(e:impl std::fmt::Display)->String{format!("PDF 文字层失败 / PDF text layer failed: {e}")}
fn deref<'a>(doc:&'a Document,mut object:&'a Object)->Result<&'a Object,String>{
    for _ in 0..32{if let Object::Reference(id)=object{object=doc.get_object(*id).map_err(err)?;}else{return Ok(object);}}
    Err("PDF 对象引用过深 / PDF reference depth exceeded".into())
}
fn inherited<'a>(doc:&'a Document,mut page:ObjectId,key:&[u8])->Result<Option<&'a Object>,String>{
    for _ in 0..64{let dict=doc.get_dictionary(page).map_err(err)?;if let Ok(value)=dict.get(key){return Ok(Some(deref(doc,value)?));}
        match dict.get(b"Parent"){Ok(value)=>page=value.as_reference().map_err(err)?,Err(_)=>return Ok(None)}
    }Err("PDF 页面树过深或循环 / Invalid PDF page tree".into())
}
fn number(value:&Object)->Result<f64,String>{let n=match value{Object::Integer(n)=>*n as f64,Object::Real(n)=>*n as f64,_=>return Err("Invalid PDF numeric value".into())};if n.is_finite(){Ok(n)}else{Err("Nonfinite PDF value".into())}}
fn rect(value:&Object)->Result<[f64;4],String>{let a=value.as_array().map_err(err)?;if a.len()!=4{return Err("Invalid page box".into());}Ok([number(&a[0])?,number(&a[1])?,number(&a[2])?,number(&a[3])?])}
pub struct Layer{doc:Document,pages:Vec<ObjectId>,font_id:ObjectId,characters:BTreeMap<char,u16>}
impl Layer{
    pub fn load(path:&Path)->Result<Self,String>{
        let mut doc=Document::load(path).map_err(err)?;
        if doc.is_encrypted(){return Err("请先解密 PDF，再执行 OCR / Decrypt the PDF before OCR".into());}
        if doc.objects.values().any(|o|o.as_dict().ok().map(|d|[b"Type".as_slice(),b"FT".as_slice()].iter().any(|key|d.get(key).and_then(Object::as_name).ok()==Some(b"Sig"))).unwrap_or(false)){
            return Err("此 PDF 包含签名字段；OCR 会使签名失效，请先另存无签名副本 / Save an unsigned copy before OCR".into());
        }
        let pages:Vec<_>=doc.get_pages().into_values().collect();
        if pages.is_empty()||pages.len()>2000{return Err("PDF 必须包含 1–2000 页；较大文件请先拆分 / PDF must contain 1–2000 pages".into());}
        let font_id=doc.new_object_id();Ok(Self{doc,pages,font_id,characters:BTreeMap::new()})
    }
    pub fn count(&self)->usize{self.pages.len()}
    pub fn append(&mut self,index:usize,width:u32,height:u32,render_ratio:f64,lines:&[Value])->Result<(),String>{
        let page=*self.pages.get(index).ok_or("Missing PDF page")?;
        let media=rect(inherited(&self.doc,page,b"MediaBox")?.ok_or("Missing MediaBox")?)?;
        let crop=match inherited(&self.doc,page,b"CropBox")?{Some(v)=>rect(v)?,None=>media};
        let [x0,y0,x1,y1]=[media[0].max(crop[0]),media[1].max(crop[1]),media[2].min(crop[2]),media[3].min(crop[3])];
        let (pw,ph)=(x1-x0,y1-y0);if pw<=0.0||ph<=0.0{return Err("Invalid PDF crop box".into());}
        let rotate=match inherited(&self.doc,page,b"Rotate")?{Some(o)=>o.as_i64().map_err(err)?.rem_euclid(360),None=>0};
        let (w,h)=(width as f64,height as f64);
        let (a,b,c,d,tx,ty)=match rotate{0=>(pw/w,0.0,0.0,-ph/h,x0,y1),90=>(0.0,ph/w,pw/h,0.0,x0,y0),180=>(-pw/w,0.0,0.0,ph/h,x1,y0),270=>(0.0,-ph/w,-pw/h,0.0,x1,y1),_=>return Err("Unsupported non-right-angle page rotation".into())};
        let expected=if rotate==90||rotate==270{ph/pw}else{pw/ph};
        if !render_ratio.is_finite()||(render_ratio/expected-1.0).abs()>0.005{return Err("渲染器与 PDF 裁剪框不一致；未写入错位文字 / Renderer crop geometry mismatch".into());}
        if lines.is_empty(){return Ok(());}
        let mut resources=match inherited(&self.doc,page,b"Resources")?{Some(o)=>o.as_dict().map_err(err)?.clone(),None=>Dictionary::new()};
        let mut fonts=match resources.get(b"Font"){Ok(o)=>deref(&self.doc,o)?.as_dict().map_err(err)?.clone(),Err(_)=>Dictionary::new()};
        let mut name="FKOCR".to_owned();let mut suffix=0;while fonts.has(name.as_bytes()){suffix+=1;name=format!("FKOCR{suffix}");}
        fonts.set(name.as_bytes(),Object::Reference(self.font_id));resources.set("Font",fonts);
        let mut ops=vec![Operation::new("q",vec![])];
        for line in lines{
            let text=line["text"].as_str().ok_or("Missing OCR text")?;if text.trim().is_empty(){continue;}
            let bbox=line["box"].as_array().filter(|a|a.len()==4).ok_or("Missing OCR box")?;
            let values:Vec<f64>=bbox.iter().map(|v|v.as_f64().filter(|n|n.is_finite()).ok_or("Invalid OCR box")).collect::<Result<_,_>>()?;
            let (left,top,right,bottom)=(values[0].clamp(0.0,w),values[1].clamp(0.0,h),values[2].clamp(0.0,w),values[3].clamp(0.0,h));
            if right<=left||bottom<=top{return Err("Degenerate OCR box".into());}
            let mut codes=Vec::new();
            for ch in text.chars(){let cid=match self.characters.get(&ch){Some(c)=>*c,None=>{if self.characters.len()>=65534{return Err("Too many PDF OCR characters".into());}let id=(self.characters.len()+1) as u16;self.characters.insert(ch,id);id}};codes.extend_from_slice(&cid.to_be_bytes());}
            let size=(bottom-top)*0.92;let horizontal=100.0*(right-left)/(text.chars().count() as f64*size);
            let real=|n:f64|Object::Real(n as f32);
            ops.extend([Operation::new("BT",vec![]),Operation::new("Tf",vec![Object::Name(name.as_bytes().to_vec()),real(size)]),Operation::new("Tr",vec![3.into()]),Operation::new("Tc",vec![0.into()]),Operation::new("Tw",vec![0.into()]),Operation::new("Ts",vec![0.into()]),Operation::new("Tz",vec![real(horizontal)]),Operation::new("Tm",vec![real(a),real(b),real(-c),real(-d),real(a*left+c*bottom+tx),real(b*left+d*bottom+ty)]),Operation::new("Tj",vec![Object::String(codes,StringFormat::Hexadecimal)]),Operation::new("ET",vec![])]);
        }
        ops.push(Operation::new("Q",vec![]));
        // Isolate the original page's CTM/clipping state. Preserve original streams verbatim.
        let begin=self.doc.add_object(Stream::new(dictionary!{},b"q\n".to_vec()));
        let mut overlay=b"\nQ\n".to_vec();overlay.extend(Content{operations:ops}.encode().map_err(err)?);
        let end=self.doc.add_object(Stream::new(dictionary!{},overlay));
        let original=self.doc.get_dictionary(page).map_err(err)?.get(b"Contents").ok().cloned();
        let mut contents=vec![Object::Reference(begin)];
        if let Some(object)=original{match deref(&self.doc,&object)?{Object::Array(items)=>{if items.iter().any(|o|!matches!(o,Object::Reference(_))){return Err("Invalid page content array".into());}contents.extend(items.clone());},Object::Stream(_)=>{if !matches!(object,Object::Reference(_)){return Err("Direct PDF content stream is unsupported".into());}contents.push(object);},Object::Null=>{},_=>return Err("Unsupported PDF content object".into())}}
        contents.push(Object::Reference(end));
        let page=self.doc.get_object_mut(page).map_err(err)?.as_dict_mut().map_err(err)?;page.set("Resources",resources);page.set("Contents",contents);Ok(())
    }
    pub fn save(mut self,path:&Path)->Result<(),String>{
        let bytes=crate::pdf_ocr_font::font();let font_file=self.doc.add_object(Stream::new(dictionary!{"Length1"=>bytes.len() as i64},bytes));
        let descriptor=self.doc.add_object(dictionary!{"Type"=>"FontDescriptor","FontName"=>"FurinaKitOCRInvisible","Flags"=>4,"FontBBox"=>vec![0.into(),0.into(),1000.into(),1000.into()],"ItalicAngle"=>0,"Ascent"=>1000,"Descent"=>0,"CapHeight"=>1000,"StemV"=>0,"FontFile2"=>font_file});
        let mut gids=vec![0,0];for _ in 0..self.characters.len(){gids.extend([0,1]);}let gid_map=self.doc.add_object(Stream::new(dictionary!{},gids));
        let descendant=self.doc.add_object(dictionary!{"Type"=>"Font","Subtype"=>"CIDFontType2","BaseFont"=>"FurinaKitOCRInvisible","CIDSystemInfo"=>dictionary!{"Registry"=>Object::string_literal("Adobe"),"Ordering"=>Object::string_literal("Identity"),"Supplement"=>0},"FontDescriptor"=>descriptor,"DW"=>1000,"CIDToGIDMap"=>gid_map});
        let mut cmap="/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /FurinaKitOCRUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n".to_owned();
        let chars:Vec<_>=self.characters.iter().collect();
        for batch in chars.chunks(100){cmap.push_str(&format!("{} beginbfchar\n",batch.len()));for (ch,cid) in batch{let mut units=[0;2];let unicode=ch.encode_utf16(&mut units).iter().map(|u|format!("{u:04X}")).collect::<String>();cmap.push_str(&format!("<{cid:04X}> <{unicode}>\n"));}cmap.push_str("endbfchar\n");}
        cmap.push_str("endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n");
        let unicode=self.doc.add_object(Stream::new(dictionary!{},cmap.into_bytes()));
        self.doc.objects.insert(self.font_id,dictionary!{"Type"=>"Font","Subtype"=>"Type0","BaseFont"=>"FurinaKitOCRInvisible","Encoding"=>"Identity-H","DescendantFonts"=>vec![Object::Reference(descendant)],"ToUnicode"=>unicode}.into());
        if self.doc.version.as_str()<"1.7"{self.doc.version="1.7".into();}
        self.doc.save(path).map_err(err)?;Ok(())
    }
}
