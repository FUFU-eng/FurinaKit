//! 极简 ZIP 读写（只覆盖 xlsx / 批量结果打包需要的部分：Stored + Deflate，非 ZIP64）。
//! 压缩/解压用 flate2（lopdf 的依赖，本来就在依赖树里，不增加体积）。

use std::io::{Read, Write};

use flate2::read::DeflateDecoder;
use flate2::write::DeflateEncoder;
use flate2::{Compression, Crc};

fn u16le(b: &[u8], at: usize) -> Result<u16, String> {
    b.get(at..at + 2).map(|s| u16::from_le_bytes([s[0], s[1]])).ok_or_else(|| "ZIP 结构损坏".to_string())
}
fn u32le(b: &[u8], at: usize) -> Result<u32, String> {
    b.get(at..at + 4).map(|s| u32::from_le_bytes([s[0], s[1], s[2], s[3]])).ok_or_else(|| "ZIP 结构损坏".to_string())
}

pub struct ZipEntry {
    pub name: String,
    method: u16,
    comp_size: usize,
    uncomp_size: usize,
    local_offset: usize,
}

pub struct ZipReader<'a> {
    data: &'a [u8],
    pub entries: Vec<ZipEntry>,
}

impl<'a> ZipReader<'a> {
    pub fn new(data: &'a [u8]) -> Result<Self, String> {
        // 从尾部找中央目录结束记录（EOCD），注释最长 65535 字节
        if data.len() < 22 {
            return Err("不是有效的 ZIP/xlsx 文件（太短）".into());
        }
        let min = data.len().saturating_sub(22 + 65535);
        let mut eocd = None;
        let mut i = data.len() - 22;
        loop {
            if &data[i..i + 4] == b"PK\x05\x06" {
                eocd = Some(i);
                break;
            }
            if i == min {
                break;
            }
            i -= 1;
        }
        let eocd = eocd.ok_or("不是有效的 ZIP/xlsx 文件（找不到目录）")?;
        let count = u16le(data, eocd + 10)? as usize;
        let cd_off = u32le(data, eocd + 16)? as usize;
        let mut entries = Vec::with_capacity(count);
        let mut p = cd_off;
        for _ in 0..count {
            if u32le(data, p)? != 0x0201_4b50 {
                return Err("ZIP 中央目录损坏".into());
            }
            let flags = u16le(data, p + 8)?;
            let method = u16le(data, p + 10)?;
            let comp_size = u32le(data, p + 20)? as usize;
            let uncomp_size = u32le(data, p + 24)? as usize;
            let nlen = u16le(data, p + 28)? as usize;
            let elen = u16le(data, p + 30)? as usize;
            let clen = u16le(data, p + 32)? as usize;
            let local_offset = u32le(data, p + 42)? as usize;
            let raw = data.get(p + 46..p + 46 + nlen).ok_or("ZIP 文件名损坏")?;
            let name = if flags & 0x800 != 0 {
                String::from_utf8_lossy(raw).to_string()
            } else {
                // 非 UTF-8 标记的文件名：xlsx 内部都是 ASCII，这里按有损 UTF-8 处理即可
                String::from_utf8_lossy(raw).to_string()
            };
            entries.push(ZipEntry { name, method, comp_size, uncomp_size, local_offset });
            p += 46 + nlen + elen + clen;
        }
        Ok(ZipReader { data, entries })
    }

    pub fn find(&self, name: &str) -> Option<&ZipEntry> {
        let n = name.trim_start_matches('/');
        self.entries.iter().find(|e| e.name == n).or_else(|| self.entries.iter().find(|e| e.name.eq_ignore_ascii_case(n)))
    }

    pub fn read(&self, name: &str) -> Result<Vec<u8>, String> {
        let e = self.find(name).ok_or_else(|| format!("ZIP 里找不到 {name}"))?;
        self.read_entry(e)
    }

    pub fn read_entry(&self, e: &ZipEntry) -> Result<Vec<u8>, String> {
        let p = e.local_offset;
        if u32le(self.data, p)? != 0x0403_4b50 {
            return Err("ZIP 本地文件头损坏".into());
        }
        let nlen = u16le(self.data, p + 26)? as usize;
        let elen = u16le(self.data, p + 28)? as usize;
        let start = p + 30 + nlen + elen;
        let comp = self.data.get(start..start + e.comp_size).ok_or("ZIP 数据被截断")?;
        match e.method {
            0 => Ok(comp.to_vec()),
            8 => {
                let mut out = Vec::with_capacity(e.uncomp_size.min(512 << 20));
                DeflateDecoder::new(comp).read_to_end(&mut out).map_err(|x| format!("解压失败：{x}"))?;
                Ok(out)
            }
            m => Err(format!("不支持的 ZIP 压缩方式 {m}")),
        }
    }
}

/// 写 ZIP：全部 Deflate；文件名按 UTF-8 标记写入（Windows 资源管理器能正确显示中文）
pub struct ZipWriter {
    buf: Vec<u8>,
    central: Vec<u8>,
    count: u16,
}

impl ZipWriter {
    pub fn new() -> Self {
        ZipWriter { buf: Vec::new(), central: Vec::new(), count: 0 }
    }

    pub fn add(&mut self, name: &str, data: &[u8]) -> Result<(), String> {
        let mut crc = Crc::new();
        crc.update(data);
        let crc = crc.sum();
        let mut enc = DeflateEncoder::new(Vec::new(), Compression::default());
        enc.write_all(data).map_err(|e| e.to_string())?;
        let comp = enc.finish().map_err(|e| e.to_string())?;
        let (method, body): (u16, &[u8]) = if comp.len() < data.len() { (8, &comp) } else { (0, data) };
        if self.buf.len() > u32::MAX as usize - body.len() - 1024 || data.len() > u32::MAX as usize {
            return Err("打包结果超过 4GB，无法写入 ZIP".into());
        }
        let name_b = name.replace('\\', "/").into_bytes();
        let offset = self.buf.len() as u32;
        // DOS 时间：固定为 2020-01-01 00:00（不影响使用）
        let (dtime, ddate) = (0u16, ((2020 - 1980) << 9 | 1 << 5 | 1) as u16);
        let mut local = Vec::new();
        local.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
        local.extend_from_slice(&20u16.to_le_bytes());
        local.extend_from_slice(&0x0800u16.to_le_bytes());
        local.extend_from_slice(&method.to_le_bytes());
        local.extend_from_slice(&dtime.to_le_bytes());
        local.extend_from_slice(&ddate.to_le_bytes());
        local.extend_from_slice(&crc.to_le_bytes());
        local.extend_from_slice(&(body.len() as u32).to_le_bytes());
        local.extend_from_slice(&(data.len() as u32).to_le_bytes());
        local.extend_from_slice(&(name_b.len() as u16).to_le_bytes());
        local.extend_from_slice(&0u16.to_le_bytes());
        local.extend_from_slice(&name_b);
        self.buf.extend_from_slice(&local);
        self.buf.extend_from_slice(body);

        let c = &mut self.central;
        c.extend_from_slice(&0x0201_4b50u32.to_le_bytes());
        c.extend_from_slice(&20u16.to_le_bytes());
        c.extend_from_slice(&20u16.to_le_bytes());
        c.extend_from_slice(&0x0800u16.to_le_bytes());
        c.extend_from_slice(&method.to_le_bytes());
        c.extend_from_slice(&dtime.to_le_bytes());
        c.extend_from_slice(&ddate.to_le_bytes());
        c.extend_from_slice(&crc.to_le_bytes());
        c.extend_from_slice(&(body.len() as u32).to_le_bytes());
        c.extend_from_slice(&(data.len() as u32).to_le_bytes());
        c.extend_from_slice(&(name_b.len() as u16).to_le_bytes());
        c.extend_from_slice(&[0u8; 8]); // extra len, comment len, disk no, internal attr
        c.extend_from_slice(&0u32.to_le_bytes()); // external attr
        c.extend_from_slice(&offset.to_le_bytes());
        c.extend_from_slice(&name_b);
        self.count = self.count.checked_add(1).ok_or("ZIP 条目过多")?;
        Ok(())
    }

    pub fn finish(mut self) -> Vec<u8> {
        let cd_off = self.buf.len() as u32;
        let cd_len = self.central.len() as u32;
        self.buf.extend_from_slice(&self.central);
        self.buf.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
        self.buf.extend_from_slice(&[0u8; 4]);
        self.buf.extend_from_slice(&self.count.to_le_bytes());
        self.buf.extend_from_slice(&self.count.to_le_bytes());
        self.buf.extend_from_slice(&cd_len.to_le_bytes());
        self.buf.extend_from_slice(&cd_off.to_le_bytes());
        self.buf.extend_from_slice(&0u16.to_le_bytes());
        self.buf
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn roundtrip() {
        let mut w = ZipWriter::new();
        w.add("a.txt", b"hello hello hello hello hello").unwrap();
        w.add("中文/b.bin", &[1, 2, 3]).unwrap();
        let z = w.finish();
        let r = ZipReader::new(&z).unwrap();
        assert_eq!(r.read("a.txt").unwrap(), b"hello hello hello hello hello");
        assert_eq!(r.read("中文/b.bin").unwrap(), vec![1, 2, 3]);
    }
}
