//! Reject failed, truncated or non-executable update downloads before running them.
use std::{fs::File,io::{Read,Seek,SeekFrom},path::Path};
pub fn validate(path:&Path,expected_size:u64,expected_sha256:Option<&str>)->Result<(),String>{
    let mut file=File::open(path).map_err(|_|"安装包不存在".to_string())?;
    let length=file.metadata().map_err(|e|e.to_string())?.len();
    if length<65536||expected_size>0&&length!=expected_size{return Err("安装包长度不完整，请重新下载".into());}
    let mut header=[0u8;64];file.read_exact(&mut header).map_err(|e|e.to_string())?;
    if &header[..2]!=b"MZ"{return Err("下载内容不是 Windows 安装程序".into());}
    let offset=u32::from_le_bytes(header[60..64].try_into().unwrap()) as u64;
    if offset>length.saturating_sub(4){return Err("安装包 PE 头损坏".into());}
    file.seek(SeekFrom::Start(offset)).map_err(|e|e.to_string())?;let mut signature=[0u8;4];file.read_exact(&mut signature).map_err(|e|e.to_string())?;
    if &signature!=b"PE\0\0"{return Err("安装包 PE 签名无效".into());}
    if let Some(expected)=expected_sha256.filter(|s|!s.is_empty()){
        use sha2::{Digest,Sha256};
        if expected.len()!=64||!expected.bytes().all(|c|c.is_ascii_hexdigit()){return Err("更新清单的 SHA-256 无效".into());}
        file.seek(SeekFrom::Start(0)).map_err(|e|e.to_string())?;let mut hash=Sha256::new();let mut buffer=[0u8;65536];
        loop{let read=file.read(&mut buffer).map_err(|e|e.to_string())?;if read==0{break;}hash.update(&buffer[..read]);}
        if format!("{:x}",hash.finalize())!=expected.to_ascii_lowercase(){return Err("安装包 SHA-256 校验失败，请重新下载".into());}
    }
    Ok(())
}
#[cfg(test)]mod tests{
    use super::*;
    #[test]fn rejects_html_and_truncation(){
        let p=std::env::temp_dir().join(format!("fk-update-test-{}.exe",uuid::Uuid::new_v4()));
        let mut bytes=vec![0u8;65536];bytes[0..2].copy_from_slice(b"MZ");bytes[60..64].copy_from_slice(&128u32.to_le_bytes());bytes[128..132].copy_from_slice(b"PE\0\0");
        std::fs::write(&p,&bytes).unwrap();assert!(validate(&p,65536,None).is_ok());assert!(validate(&p,65537,None).is_err());assert!(validate(&p,65536,Some(&"0".repeat(64))).is_err());
        std::fs::write(&p,vec![b'x';65536]).unwrap();assert!(validate(&p,0,None).is_err());std::fs::remove_file(p).unwrap();
    }
}
