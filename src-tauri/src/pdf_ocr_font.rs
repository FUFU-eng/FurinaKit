//! Original minimal TrueType font: two empty glyphs, fixed advance, no external font assets.
//! OCR uses PDF rendering mode 3 + explicit CIDToGIDMap + ToUnicode; visible glyphs are unnecessary.
use std::collections::BTreeMap;
fn u16at(b:&mut [u8],p:usize,v:u16){b[p..p+2].copy_from_slice(&v.to_be_bytes());}
fn u32at(b:&mut [u8],p:usize,v:u32){b[p..p+4].copy_from_slice(&v.to_be_bytes());}
fn checksum(b:&[u8])->u32{b.chunks(4).fold(0u32,|sum,c|{let mut word=[0;4];word[..c.len()].copy_from_slice(c);sum.wrapping_add(u32::from_be_bytes(word))})}
pub fn font()->Vec<u8>{
    let mut tables:BTreeMap<&str,Vec<u8>>=BTreeMap::new();
    let mut head=vec![0;54];u32at(&mut head,0,0x00010000);u32at(&mut head,4,0x00010000);u32at(&mut head,12,0x5f0f3cf5);u16at(&mut head,18,1000);u16at(&mut head,46,8);u16at(&mut head,48,2);tables.insert("head",head);
    let mut hhea=vec![0;36];u32at(&mut hhea,0,0x00010000);u16at(&mut hhea,4,1000);u16at(&mut hhea,10,1000);u16at(&mut hhea,14,1000);u16at(&mut hhea,18,1);u16at(&mut hhea,34,2);tables.insert("hhea",hhea);
    let mut maxp=vec![0;32];u32at(&mut maxp,0,0x00010000);u16at(&mut maxp,4,2);u16at(&mut maxp,14,1);tables.insert("maxp",maxp);
    tables.insert("hmtx",vec![3,232,0,0,3,232,0,0]);tables.insert("loca",vec![0;6]);tables.insert("glyf",vec![0;4]);
    let mut post=vec![0;32];u32at(&mut post,0,0x00030000);u32at(&mut post,12,1);tables.insert("post",post);
    let mut os=vec![0;78];u16at(&mut os,2,1000);u16at(&mut os,4,400);u16at(&mut os,6,5);os[58..62].copy_from_slice(b"FKIT");u16at(&mut os,62,64);u16at(&mut os,64,32);u16at(&mut os,66,32);u16at(&mut os,68,1000);u16at(&mut os,74,1000);tables.insert("OS/2",os);
    let mut cmap=vec![0;44];u16at(&mut cmap,2,1);u16at(&mut cmap,4,3);u16at(&mut cmap,6,1);u32at(&mut cmap,8,12);
    for (i,v) in [4,32,0,4,4,1,0,32,65535,0,32,65535,65505,1,0,0].iter().enumerate(){u16at(&mut cmap,12+i*2,*v);}tables.insert("cmap",cmap);
    let names=[(1u16,"FurinaKit OCR Invisible"),(2,"Regular"),(3,"FurinaKitOCRInvisible-1"),(4,"FurinaKit OCR Invisible"),(6,"FurinaKitOCRInvisible")];
    let mut name=vec![0;6+names.len()*12];u16at(&mut name,2,names.len() as u16);let start=name.len();u16at(&mut name,4,start as u16);
    for (i,(id,value)) in names.iter().enumerate(){let data:Vec<u8>=value.encode_utf16().flat_map(u16::to_be_bytes).collect();let offset=name.len()-start;
        for (j,v) in [3u16,1,0x0409,*id,data.len() as u16,offset as u16].iter().enumerate(){u16at(&mut name,6+i*12+j*2,*v);}name.extend(data);
    }tables.insert("name",name);
    let count=tables.len();let power=1usize<<count.ilog2();let mut out=vec![0;12+count*16];u32at(&mut out,0,0x00010000);u16at(&mut out,4,count as u16);u16at(&mut out,6,(power*16) as u16);u16at(&mut out,8,count.ilog2() as u16);u16at(&mut out,10,((count-power)*16) as u16);
    let mut head_offset=0;
    for (i,(tag,data)) in tables.iter().enumerate(){let offset=out.len();let p=12+i*16;out[p..p+4].copy_from_slice(tag.as_bytes());u32at(&mut out,p+4,checksum(data));u32at(&mut out,p+8,offset as u32);u32at(&mut out,p+12,data.len() as u32);if *tag=="head"{head_offset=offset;}out.extend(data);while out.len()%4!=0{out.push(0);}}
    let adjustment=0xb1b0afbau32.wrapping_sub(checksum(&out));u32at(&mut out,head_offset+8,adjustment);out
}
