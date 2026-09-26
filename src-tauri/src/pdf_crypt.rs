//! PDF 标准安全处理器（Standard Security Handler）：解密 + AES-256 加密。纯 Rust，无外部依赖。
//!
//! 为什么自己写：lopdf 0.34 只能解 RC4（V1/V2），而现在绝大多数加密 PDF 用的是 AES-128（V4）
//! 或 AES-256（V5/R6），也完全不支持加密。原来走 Python（PyMuPDF），这里替换掉。
//!
//! 支持：
//!   解密：RC4 40~128 位（R2/R3）、AES-128（V4 R4, AESV2）、AES-256（V5 R5/R6, AESV3），
//!         用户密码或所有者密码均可；含对象流（ObjStm）的文件也能正确解。
//!   加密：AES-256（V5 R6，ISO 32000-2，Acrobat X 及以后、Chrome/Edge/WPS/福昕都能打开）。
//!
//! MD5 / RC4 / AES 在本文件内实现（SHA-2 用已有的 sha2 crate），单测对照标准测试向量。

use std::collections::HashSet;
use std::path::Path;
use std::sync::{Arc, Mutex};

use lopdf::{dictionary, Dictionary, Document, Object, ObjectId, StringFormat};
use sha2::{Digest, Sha256, Sha384, Sha512};

// ═════════════════════════════ 基础密码学原语 ═════════════════════════════

/// MD5（RFC 1321）。只用于 PDF R2~R4 的密钥派生，不用于任何安全场景的新设计。
pub fn md5(data: &[u8]) -> [u8; 16] {
    const S: [u32; 64] = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9,
        14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15,
        21, 6, 10, 15, 21,
    ];
    let k: Vec<u32> = (0..64).map(|i| ((i as f64 + 1.0).sin().abs() * 4294967296.0) as u32).collect();
    let (mut a0, mut b0, mut c0, mut d0) = (0x67452301u32, 0xefcdab89u32, 0x98badcfeu32, 0x10325476u32);
    let mut msg = data.to_vec();
    let bit_len = (data.len() as u64).wrapping_mul(8);
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_le_bytes());
    for chunk in msg.chunks(64) {
        let m: Vec<u32> = chunk.chunks(4).map(|w| u32::from_le_bytes([w[0], w[1], w[2], w[3]])).collect();
        let (mut a, mut b, mut c, mut d) = (a0, b0, c0, d0);
        for i in 0..64 {
            let (f, g) = match i / 16 {
                0 => ((b & c) | (!b & d), i),
                1 => ((d & b) | (!d & c), (5 * i + 1) % 16),
                2 => (b ^ c ^ d, (3 * i + 5) % 16),
                _ => (c ^ (b | !d), (7 * i) % 16),
            };
            let f2 = f.wrapping_add(a).wrapping_add(k[i]).wrapping_add(m[g]);
            a = d;
            d = c;
            c = b;
            b = b.wrapping_add(f2.rotate_left(S[i]));
        }
        a0 = a0.wrapping_add(a);
        b0 = b0.wrapping_add(b);
        c0 = c0.wrapping_add(c);
        d0 = d0.wrapping_add(d);
    }
    let mut out = [0u8; 16];
    out[0..4].copy_from_slice(&a0.to_le_bytes());
    out[4..8].copy_from_slice(&b0.to_le_bytes());
    out[8..12].copy_from_slice(&c0.to_le_bytes());
    out[12..16].copy_from_slice(&d0.to_le_bytes());
    out
}

/// RC4（加解密同一操作）
pub fn rc4(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut s: [u8; 256] = [0; 256];
    for (i, v) in s.iter_mut().enumerate() {
        *v = i as u8;
    }
    let mut j: u8 = 0;
    for i in 0..256 {
        j = j.wrapping_add(s[i]).wrapping_add(key[i % key.len()]);
        s.swap(i, j as usize);
    }
    let (mut i, mut j) = (0u8, 0u8);
    data.iter()
        .map(|b| {
            i = i.wrapping_add(1);
            j = j.wrapping_add(s[i as usize]);
            s.swap(i as usize, j as usize);
            b ^ s[(s[i as usize].wrapping_add(s[j as usize])) as usize]
        })
        .collect()
}

const SBOX: [u8; 256] = {
    // 由 GF(2^8) 求逆 + 仿射变换在编译期生成，避免手抄 256 个常数出错
    let mut sbox = [0u8; 256];
    let mut p: u8 = 1;
    let mut q: u8 = 1;
    loop {
        // p *= 3
        p = p ^ (p << 1) ^ (if p & 0x80 != 0 { 0x1B } else { 0 });
        // q /= 3
        q ^= q << 1;
        q ^= q << 2;
        q ^= q << 4;
        if q & 0x80 != 0 {
            q ^= 0x09;
        }
        let x = q ^ q.rotate_left(1) ^ q.rotate_left(2) ^ q.rotate_left(3) ^ q.rotate_left(4);
        sbox[p as usize] = x ^ 0x63;
        if p == 1 {
            break;
        }
    }
    sbox[0] = 0x63;
    sbox
};

const INV_SBOX: [u8; 256] = {
    let mut inv = [0u8; 256];
    let mut i = 0;
    while i < 256 {
        inv[SBOX[i] as usize] = i as u8;
        i += 1;
    }
    inv
};

fn xtime(x: u8) -> u8 {
    (x << 1) ^ (if x & 0x80 != 0 { 0x1B } else { 0 })
}

fn gmul(mut a: u8, mut b: u8) -> u8 {
    let mut p = 0u8;
    while b != 0 {
        if b & 1 != 0 {
            p ^= a;
        }
        a = xtime(a);
        b >>= 1;
    }
    p
}

/// AES（FIPS-197），支持 128/192/256 位密钥
pub struct Aes {
    rk: Vec<[u8; 16]>,
}

impl Aes {
    pub fn new(key: &[u8]) -> Result<Aes, String> {
        let nk = key.len() / 4;
        if !(key.len() == 16 || key.len() == 24 || key.len() == 32) {
            return Err(format!("AES 密钥长度无效：{}", key.len()));
        }
        let nr = nk + 6;
        let total = 4 * (nr + 1);
        let mut w: Vec<[u8; 4]> = Vec::with_capacity(total);
        for i in 0..nk {
            w.push([key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]]);
        }
        let mut rcon: u8 = 1;
        for i in nk..total {
            let mut t = w[i - 1];
            if i % nk == 0 {
                t = [SBOX[t[1] as usize] ^ rcon, SBOX[t[2] as usize], SBOX[t[3] as usize], SBOX[t[0] as usize]];
                rcon = xtime(rcon);
            } else if nk > 6 && i % nk == 4 {
                t = [SBOX[t[0] as usize], SBOX[t[1] as usize], SBOX[t[2] as usize], SBOX[t[3] as usize]];
            }
            let p = w[i - nk];
            w.push([p[0] ^ t[0], p[1] ^ t[1], p[2] ^ t[2], p[3] ^ t[3]]);
        }
        let rk = (0..=nr)
            .map(|r| {
                let mut b = [0u8; 16];
                for c in 0..4 {
                    b[4 * c..4 * c + 4].copy_from_slice(&w[4 * r + c]);
                }
                b
            })
            .collect();
        Ok(Aes { rk })
    }

    fn add(s: &mut [u8; 16], k: &[u8; 16]) {
        for i in 0..16 {
            s[i] ^= k[i];
        }
    }

    pub fn encrypt_block(&self, block: &mut [u8; 16]) {
        let nr = self.rk.len() - 1;
        Self::add(block, &self.rk[0]);
        for round in 1..=nr {
            for b in block.iter_mut() {
                *b = SBOX[*b as usize];
            }
            // ShiftRows（列主序：state[r + 4c]）
            let s = *block;
            for c in 0..4 {
                for r in 0..4 {
                    block[r + 4 * c] = s[r + 4 * ((c + r) % 4)];
                }
            }
            if round != nr {
                for c in 0..4 {
                    let a = [block[4 * c], block[4 * c + 1], block[4 * c + 2], block[4 * c + 3]];
                    block[4 * c] = xtime(a[0]) ^ (xtime(a[1]) ^ a[1]) ^ a[2] ^ a[3];
                    block[4 * c + 1] = a[0] ^ xtime(a[1]) ^ (xtime(a[2]) ^ a[2]) ^ a[3];
                    block[4 * c + 2] = a[0] ^ a[1] ^ xtime(a[2]) ^ (xtime(a[3]) ^ a[3]);
                    block[4 * c + 3] = (xtime(a[0]) ^ a[0]) ^ a[1] ^ a[2] ^ xtime(a[3]);
                }
            }
            Self::add(block, &self.rk[round]);
        }
    }

    pub fn decrypt_block(&self, block: &mut [u8; 16]) {
        let nr = self.rk.len() - 1;
        Self::add(block, &self.rk[nr]);
        for round in (0..nr).rev() {
            let s = *block;
            for c in 0..4 {
                for r in 0..4 {
                    block[r + 4 * ((c + r) % 4)] = s[r + 4 * c];
                }
            }
            for b in block.iter_mut() {
                *b = INV_SBOX[*b as usize];
            }
            Self::add(block, &self.rk[round]);
            if round != 0 {
                for c in 0..4 {
                    let a = [block[4 * c], block[4 * c + 1], block[4 * c + 2], block[4 * c + 3]];
                    block[4 * c] = gmul(a[0], 14) ^ gmul(a[1], 11) ^ gmul(a[2], 13) ^ gmul(a[3], 9);
                    block[4 * c + 1] = gmul(a[0], 9) ^ gmul(a[1], 14) ^ gmul(a[2], 11) ^ gmul(a[3], 13);
                    block[4 * c + 2] = gmul(a[0], 13) ^ gmul(a[1], 9) ^ gmul(a[2], 14) ^ gmul(a[3], 11);
                    block[4 * c + 3] = gmul(a[0], 11) ^ gmul(a[1], 13) ^ gmul(a[2], 9) ^ gmul(a[3], 14);
                }
            }
        }
    }

    /// CBC 加密，不填充（输入必须是 16 的倍数）
    pub fn cbc_encrypt_nopad(&self, iv: &[u8; 16], data: &[u8]) -> Vec<u8> {
        let mut prev = *iv;
        let mut out = Vec::with_capacity(data.len());
        for chunk in data.chunks(16) {
            let mut b = [0u8; 16];
            b[..chunk.len()].copy_from_slice(chunk);
            for i in 0..16 {
                b[i] ^= prev[i];
            }
            self.encrypt_block(&mut b);
            out.extend_from_slice(&b);
            prev = b;
        }
        out
    }

    /// CBC 解密，不去填充
    pub fn cbc_decrypt_nopad(&self, iv: &[u8; 16], data: &[u8]) -> Vec<u8> {
        let mut prev = *iv;
        let mut out = Vec::with_capacity(data.len());
        for chunk in data.chunks_exact(16) {
            let mut b = [0u8; 16];
            b.copy_from_slice(chunk);
            let cur = b;
            self.decrypt_block(&mut b);
            for i in 0..16 {
                b[i] ^= prev[i];
            }
            out.extend_from_slice(&b);
            prev = cur;
        }
        out
    }
}

/// PDF 的 AES 数据格式：16 字节随机 IV + CBC(PKCS#7 填充)
fn aes_pdf_encrypt(key: &[u8], data: &[u8]) -> Vec<u8> {
    let aes = Aes::new(key).expect("key");
    let iv = random16();
    let pad = 16 - data.len() % 16;
    let mut buf = data.to_vec();
    buf.extend(std::iter::repeat(pad as u8).take(pad));
    let mut out = iv.to_vec();
    out.extend(aes.cbc_encrypt_nopad(&iv, &buf));
    out
}

fn aes_pdf_decrypt(key: &[u8], data: &[u8]) -> Vec<u8> {
    if data.len() < 32 {
        // 只有 IV（空字符串）或损坏：按空内容处理
        return Vec::new();
    }
    let aes = match Aes::new(key) {
        Ok(a) => a,
        Err(_) => return data.to_vec(),
    };
    let mut iv = [0u8; 16];
    iv.copy_from_slice(&data[..16]);
    let body = &data[16..data.len() - (data.len() - 16) % 16];
    let mut out = aes.cbc_decrypt_nopad(&iv, body);
    if let Some(&pad) = out.last() {
        let pad = pad as usize;
        if (1..=16).contains(&pad) && pad <= out.len() && out[out.len() - pad..].iter().all(|&b| b as usize == pad) {
            out.truncate(out.len() - pad);
        }
    }
    out
}

pub fn random16() -> [u8; 16] {
    *uuid::Uuid::new_v4().as_bytes()
}

fn random_bytes(n: usize) -> Vec<u8> {
    let mut v = Vec::with_capacity(n + 16);
    while v.len() < n {
        v.extend_from_slice(&random16());
    }
    v.truncate(n);
    v
}

// ═════════════════════════════ 标准安全处理器 ═════════════════════════════

const PAD: [u8; 32] = [
    0x28, 0xBF, 0x4E, 0x5E, 0x4E, 0x75, 0x8A, 0x41, 0x64, 0x00, 0x4E, 0x56, 0xFF, 0xFA, 0x01, 0x08, 0x2E, 0x2E, 0x00,
    0xB6, 0xD0, 0x68, 0x3E, 0x80, 0x2F, 0x0C, 0xA9, 0xFE, 0x64, 0x53, 0x69, 0x7A,
];

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Cipher {
    Identity,
    Rc4,
    AesV2,
    AesV3,
}

#[derive(Clone, Debug)]
pub struct CryptState {
    pub key: Vec<u8>,
    pub stm: Cipher,
    pub str_: Cipher,
    pub encrypt_metadata: bool,
    pub revision: i64,
}

impl CryptState {
    fn object_key(&self, id: ObjectId, cipher: Cipher) -> Vec<u8> {
        if cipher == Cipher::AesV3 {
            return self.key.clone();
        }
        let mut k = self.key.clone();
        k.extend_from_slice(&id.0.to_le_bytes()[..3]);
        k.extend_from_slice(&id.1.to_le_bytes()[..2]);
        if cipher == Cipher::AesV2 {
            k.extend_from_slice(b"sAlT");
        }
        let h = md5(&k);
        let n = (self.key.len() + 5).min(16);
        h[..n].to_vec()
    }

    pub fn decrypt_bytes(&self, id: ObjectId, cipher: Cipher, data: &[u8]) -> Vec<u8> {
        match cipher {
            Cipher::Identity => data.to_vec(),
            Cipher::Rc4 => rc4(&self.object_key(id, cipher), data),
            Cipher::AesV2 | Cipher::AesV3 => aes_pdf_decrypt(&self.object_key(id, cipher), data),
        }
    }

    pub fn encrypt_bytes(&self, id: ObjectId, cipher: Cipher, data: &[u8]) -> Vec<u8> {
        match cipher {
            Cipher::Identity => data.to_vec(),
            Cipher::Rc4 => rc4(&self.object_key(id, cipher), data),
            Cipher::AesV2 | Cipher::AesV3 => aes_pdf_encrypt(&self.object_key(id, cipher), data),
        }
    }
}

fn dict_i64(d: &Dictionary, k: &[u8], default: i64) -> i64 {
    d.get(k).ok().and_then(|o| o.as_i64().ok()).unwrap_or(default)
}

fn dict_bytes(d: &Dictionary, k: &[u8]) -> Vec<u8> {
    match d.get(k) {
        Ok(Object::String(s, _)) => s.clone(),
        _ => Vec::new(),
    }
}

/// 读取 /Encrypt 字典（可能是间接引用，也可能直接内嵌在 trailer 里）
pub fn encrypt_dict(doc: &Document) -> Option<(Option<ObjectId>, Dictionary)> {
    match doc.trailer.get(b"Encrypt").ok()? {
        Object::Reference(id) => match doc.get_object(*id).ok()? {
            Object::Dictionary(d) => Some((Some(*id), d.clone())),
            _ => None,
        },
        Object::Dictionary(d) => Some((None, d.clone())),
        _ => None,
    }
}

fn file_id0(doc: &Document) -> Vec<u8> {
    doc.trailer
        .get(b"ID")
        .ok()
        .and_then(|o| o.as_array().ok())
        .and_then(|a| a.first())
        .and_then(|o| o.as_str().ok())
        .map(|s| s.to_vec())
        .unwrap_or_default()
}

fn crypt_filter(d: &Dictionary, name_key: &[u8], v: i64) -> Cipher {
    if v < 4 {
        return Cipher::Rc4;
    }
    let name = match d.get(name_key) {
        Ok(Object::Name(n)) => n.clone(),
        _ => b"Identity".to_vec(),
    };
    if name == b"Identity" {
        return Cipher::Identity;
    }
    let cfm = d
        .get(b"CF")
        .ok()
        .and_then(|o| o.as_dict().ok())
        .and_then(|cf| cf.get(&name).ok())
        .and_then(|o| o.as_dict().ok())
        .and_then(|f| f.get(b"CFM").ok())
        .and_then(|o| o.as_name().ok())
        .map(|n| n.to_vec())
        .unwrap_or_default();
    match cfm.as_slice() {
        b"AESV2" => Cipher::AesV2,
        b"AESV3" => Cipher::AesV3,
        b"V2" => Cipher::Rc4,
        b"None" => Cipher::Identity,
        _ => {
            if v >= 5 {
                Cipher::AesV3
            } else {
                Cipher::Rc4
            }
        }
    }
}

fn pad_password(pw: &[u8]) -> [u8; 32] {
    let mut out = [0u8; 32];
    let n = pw.len().min(32);
    out[..n].copy_from_slice(&pw[..n]);
    out[n..].copy_from_slice(&PAD[..32 - n]);
    out
}

/// Algorithm 2（R2~R4）：由用户密码计算文件密钥
fn key_r4(pw: &[u8], o: &[u8], p: i64, id0: &[u8], r: i64, key_len: usize, encrypt_metadata: bool) -> Vec<u8> {
    let mut buf = pad_password(pw).to_vec();
    buf.extend_from_slice(&o[..o.len().min(32)]);
    buf.extend_from_slice(&(p as i32 as u32).to_le_bytes());
    buf.extend_from_slice(id0);
    if r >= 4 && !encrypt_metadata {
        buf.extend_from_slice(&[0xFF; 4]);
    }
    let mut h = md5(&buf).to_vec();
    if r >= 3 {
        for _ in 0..50 {
            h = md5(&h[..key_len]).to_vec();
        }
    }
    h.truncate(key_len);
    h
}

/// Algorithm 4/5：计算 /U 值（用于校验用户密码）
fn u_value_r4(key: &[u8], r: i64, id0: &[u8]) -> Vec<u8> {
    if r == 2 {
        return rc4(key, &PAD);
    }
    let mut buf = PAD.to_vec();
    buf.extend_from_slice(id0);
    let mut x = rc4(key, &md5(&buf));
    for i in 1..=19u8 {
        let k: Vec<u8> = key.iter().map(|b| b ^ i).collect();
        x = rc4(&k, &x);
    }
    x
}

/// Algorithm 7：由所有者密码还原出用户密码
fn owner_to_user_r4(owner_pw: &[u8], o: &[u8], r: i64, key_len: usize) -> Vec<u8> {
    let mut h = md5(&pad_password(owner_pw)).to_vec();
    if r >= 3 {
        for _ in 0..50 {
            h = md5(&h).to_vec();
        }
    }
    let key = &h[..key_len];
    let o32 = &o[..o.len().min(32)];
    if r == 2 {
        rc4(key, o32)
    } else {
        let mut x = o32.to_vec();
        for i in (0..=19u8).rev() {
            let k: Vec<u8> = key.iter().map(|b| b ^ i).collect();
            x = rc4(&k, &x);
        }
        x
    }
}

/// Algorithm 2.B（R6 的口令散列，ISO 32000-2）；R5 只做一次 SHA-256
fn hash_r6(pw: &[u8], salt: &[u8], udata: &[u8], r: i64) -> Vec<u8> {
    let mut h = Sha256::new();
    h.update(pw);
    h.update(salt);
    h.update(udata);
    let mut k: Vec<u8> = h.finalize().to_vec();
    if r < 6 {
        return k;
    }
    let mut round = 0u32;
    loop {
        let mut k1 = Vec::with_capacity(64 * (pw.len() + k.len() + udata.len()));
        for _ in 0..64 {
            k1.extend_from_slice(pw);
            k1.extend_from_slice(&k);
            k1.extend_from_slice(udata);
        }
        let aes = Aes::new(&k[..16]).expect("aes128");
        let mut iv = [0u8; 16];
        iv.copy_from_slice(&k[16..32]);
        let e = aes.cbc_encrypt_nopad(&iv, &k1);
        let sum: u32 = e[..16].iter().map(|&b| b as u32).sum();
        k = match sum % 3 {
            0 => Sha256::digest(&e).to_vec(),
            1 => Sha384::digest(&e).to_vec(),
            _ => Sha512::digest(&e).to_vec(),
        };
        round += 1;
        if round >= 64 && (*e.last().unwrap() as u32) <= round - 32 {
            break;
        }
    }
    k.truncate(32);
    k
}

/// 用给定密码（先当用户密码，再当所有者密码）求文件密钥。返回 (状态, 是否以所有者身份打开)
pub fn authenticate(doc: &Document, password: &str) -> Result<(CryptState, bool), String> {
    let (_, d) = encrypt_dict(doc).ok_or("这个 PDF 没有加密")?;
    let filter = d.get(b"Filter").ok().and_then(|o| o.as_name().ok()).unwrap_or(b"Standard");
    if filter != b"Standard" {
        return Err(format!(
            "这个 PDF 使用「{}」安全处理器（证书/DRM 加密），不是密码加密，无法解锁",
            String::from_utf8_lossy(filter)
        ));
    }
    let v = dict_i64(&d, b"V", 0);
    let r = dict_i64(&d, b"R", 2);
    let o = dict_bytes(&d, b"O");
    let u = dict_bytes(&d, b"U");
    let p = dict_i64(&d, b"P", -1);
    let encrypt_metadata = d.get(b"EncryptMetadata").ok().and_then(|o| o.as_bool().ok()).unwrap_or(true);
    let stm = crypt_filter(&d, b"StmF", v);
    let str_ = crypt_filter(&d, b"StrF", v);
    let pw = password.as_bytes();

    if r >= 5 {
        if o.len() < 48 || u.len() < 48 {
            return Err("加密字典损坏（/O 或 /U 长度不对）".into());
        }
        let pw = &pw[..pw.len().min(127)];
        let oe = dict_bytes(&d, b"OE");
        let ue = dict_bytes(&d, b"UE");
        let zero = [0u8; 16];
        // 所有者
        if hash_r6(pw, &o[32..40], &u[..48], r) == o[..32] {
            let ik = hash_r6(pw, &o[40..48], &u[..48], r);
            let key = Aes::new(&ik)?.cbc_decrypt_nopad(&zero, &oe[..oe.len().min(32)]);
            if key.len() == 32 {
                return Ok((CryptState { key, stm, str_, encrypt_metadata, revision: r }, true));
            }
        }
        // 用户
        if hash_r6(pw, &u[32..40], &[], r) == u[..32] {
            let ik = hash_r6(pw, &u[40..48], &[], r);
            let key = Aes::new(&ik)?.cbc_decrypt_nopad(&zero, &ue[..ue.len().min(32)]);
            if key.len() == 32 {
                return Ok((CryptState { key, stm, str_, encrypt_metadata, revision: r }, false));
            }
        }
        return Err(if password.is_empty() { "PDF 已加密，需要提供密码".into() } else { "密码错误".into() });
    }

    if !(2..=4).contains(&r) {
        return Err(format!("不支持的加密版本 R={r}"));
    }
    let key_len = if v == 1 { 5 } else { (dict_i64(&d, b"Length", 40) as usize / 8).clamp(5, 16) };
    let key_len = if v >= 4 { 16.max(key_len).min(16) } else { key_len };
    let id0 = file_id0(doc);
    let check = |upw: &[u8]| -> Option<Vec<u8>> {
        let key = key_r4(upw, &o, p, &id0, r, key_len, encrypt_metadata);
        let uv = u_value_r4(&key, r, &id0);
        let n = if r == 2 { 32 } else { 16 };
        if u.len() >= n && uv[..n] == u[..n] {
            Some(key)
        } else {
            None
        }
    };
    if let Some(key) = check(pw) {
        return Ok((CryptState { key, stm, str_, encrypt_metadata, revision: r }, false));
    }
    let upw = owner_to_user_r4(pw, &o, r, key_len);
    if let Some(key) = check(&upw) {
        return Ok((CryptState { key, stm, str_, encrypt_metadata, revision: r }, true));
    }
    Err(if password.is_empty() { "PDF 已加密，需要提供密码".into() } else { "密码错误".into() })
}

// ═════════════════════════════ 解密整份文档 ═════════════════════════════

struct LoadCtx {
    state: CryptState,
    /// 位于对象流里的对象：不单独加密（整条对象流已经解过密）
    compressed: HashSet<ObjectId>,
    encrypt_id: Option<ObjectId>,
}

static LOAD_CTX: Mutex<Option<Arc<LoadCtx>>> = Mutex::new(None);
static LOAD_SERIAL: Mutex<()> = Mutex::new(());

fn decrypt_in_place(state: &CryptState, id: ObjectId, obj: &mut Object) {
    match obj {
        Object::String(s, _) => {
            *s = state.decrypt_bytes(id, state.str_, s);
        }
        Object::Array(a) => {
            for x in a.iter_mut() {
                decrypt_in_place(state, id, x);
            }
        }
        Object::Dictionary(d) => {
            for (_, v) in d.iter_mut() {
                decrypt_in_place(state, id, v);
            }
        }
        Object::Stream(st) => {
            let is_xref = st.dict.type_is(b"XRef");
            if is_xref {
                return;
            }
            let is_meta = st.dict.type_is(b"Metadata");
            for (_, v) in st.dict.iter_mut() {
                decrypt_in_place(state, id, v);
            }
            if is_meta && !state.encrypt_metadata {
                return;
            }
            // 流级别的 /Crypt 过滤器（极少见）：/Identity 表示不加密
            let identity_filter = matches!(st.dict.get(b"Filter"), Ok(Object::Name(n)) if n == b"Crypt")
                || matches!(st.dict.get(b"Filter"), Ok(Object::Array(a)) if a.first().and_then(|o| o.as_name().ok()) == Some(b"Crypt"));
            if identity_filter {
                return;
            }
            let plain = state.decrypt_bytes(id, state.stm, &st.content);
            st.set_content(plain);
        }
        _ => {}
    }
}

/// lopdf 的过滤回调：普通对象用的是**原地修改后的** `obj`（返回值只看 Some/None），
/// 对象流里的对象用的是**返回值**。两种情况分开处理。
fn load_filter(id: ObjectId, obj: &mut Object) -> Option<(ObjectId, Object)> {
    let ctx = LOAD_CTX.lock().ok()?.clone();
    if let Some(ctx) = ctx {
        if ctx.compressed.contains(&id) {
            return Some((id, std::mem::replace(obj, Object::Null)));
        }
        if Some(id) != ctx.encrypt_id {
            decrypt_in_place(&ctx.state, id, obj);
        }
    }
    Some((id, Object::Null))
}

/// 打开（可能加密的）PDF 并返回完全解密后的文档。
/// 返回 (文档, 原来是否加密, 是否以所有者身份打开)
pub fn load_decrypted(path: &Path, password: &str) -> Result<(Document, bool, bool), String> {
    let probe = Document::load(path).map_err(|e| format!("无法读取 PDF：{e}"))?;
    let Some((enc_id, _)) = encrypt_dict(&probe) else {
        return Ok((probe, false, false));
    };
    let mut try_list = vec![password.to_string()];
    if !password.is_empty() {
        // 有些用户会把首尾空格一起粘进来
        let t = password.trim().to_string();
        if t != password {
            try_list.push(t);
        }
    }
    let mut last_err = String::new();
    let mut auth = None;
    for pw in &try_list {
        match authenticate(&probe, pw) {
            Ok(a) => {
                auth = Some(a);
                break;
            }
            Err(e) => last_err = e,
        }
    }
    let Some((state, as_owner)) = auth else { return Err(last_err) };

    // 对象流里的对象不单独加密（整条流已经加密），这里记下来跳过
    let mut compressed: HashSet<ObjectId> = HashSet::new();
    for (num, entry) in probe.reference_table.entries.iter() {
        if let lopdf::xref::XrefEntry::Compressed { .. } = entry {
            compressed.insert((*num, 0));
        }
    }

    let _serial = LOAD_SERIAL.lock().map_err(|_| "内部锁异常")?;
    *LOAD_CTX.lock().map_err(|_| "内部锁异常")? = Some(Arc::new(LoadCtx { state, compressed, encrypt_id: enc_id }));
    let loaded = Document::load_filtered(path, load_filter);
    *LOAD_CTX.lock().map_err(|_| "内部锁异常")? = None;
    let mut doc = loaded.map_err(|e| format!("解密后读取 PDF 失败：{e}"))?;

    doc.trailer.remove(b"Encrypt");
    if let Some(id) = enc_id {
        doc.objects.remove(&id);
    }
    // 交叉引用流 / 对象流在重写时会重新生成，旧的留着只会占体积
    doc.objects.retain(|_, o| !matches!(o, Object::Stream(s) if s.dict.type_is(b"XRef") || s.dict.type_is(b"ObjStm")));
    let id0 = random16().to_vec();
    doc.trailer.set("ID", Object::Array(vec![Object::String(id0.clone(), StringFormat::Hexadecimal), Object::String(id0, StringFormat::Hexadecimal)]));
    Ok((doc, true, as_owner))
}

// ═════════════════════════════ AES-256 加密 ═════════════════════════════

/// 权限位（ISO 32000 表 22）。未列出的保留位按规范置 1。
pub struct Permissions {
    pub print: bool,
    pub modify: bool,
    pub copy: bool,
    pub annotate: bool,
    pub fill_forms: bool,
    pub assemble: bool,
    pub print_high: bool,
}

impl Permissions {
    pub fn to_p(&self) -> i32 {
        let mut p: u32 = 0xFFFF_F0C0; // 位 7、8 及 13~32 置 1
        let bits = [
            (self.print, 1 << 2),
            (self.modify, 1 << 3),
            (self.copy, 1 << 4),
            (self.annotate, 1 << 5),
            (self.fill_forms, 1 << 8),
            (true, 1 << 9), // 无障碍提取始终允许
            (self.assemble, 1 << 10),
            (self.print_high, 1 << 11),
        ];
        for (on, b) in bits {
            if on {
                p |= b;
            }
        }
        p as i32
    }
}

fn encrypt_in_place(state: &CryptState, id: ObjectId, obj: &mut Object) {
    match obj {
        Object::String(s, _) => {
            *s = state.encrypt_bytes(id, state.str_, s);
        }
        Object::Array(a) => {
            for x in a.iter_mut() {
                encrypt_in_place(state, id, x);
            }
        }
        Object::Dictionary(d) => {
            for (_, v) in d.iter_mut() {
                encrypt_in_place(state, id, v);
            }
        }
        Object::Stream(st) => {
            if st.dict.type_is(b"XRef") {
                return;
            }
            for (_, v) in st.dict.iter_mut() {
                encrypt_in_place(state, id, v);
            }
            let c = state.encrypt_bytes(id, state.stm, &st.content);
            st.set_content(c);
        }
        _ => {}
    }
}

/// 以 AES-256（V5 R6）加密文档（原地）。user_pw 可为空（打开不需要密码，只限制权限）。
pub fn encrypt_document(doc: &mut Document, user_pw: &str, owner_pw: &str, perms: &Permissions) -> Result<(), String> {
    if encrypt_dict(doc).is_some() {
        return Err("这个 PDF 已经加密了，请先解锁再重新加密".into());
    }
    let upw = &user_pw.as_bytes()[..user_pw.len().min(127)];
    let opw_s = if owner_pw.is_empty() { user_pw } else { owner_pw };
    let opw = &opw_s.as_bytes()[..opw_s.len().min(127)];

    // 对象流 / 交叉引用流在重写时由 lopdf 自己处理，这里先展开，避免把旧的 ObjStm 当普通流加密
    let obj_streams: Vec<ObjectId> = doc
        .objects
        .iter()
        .filter(|(_, o)| matches!(o, Object::Stream(s) if s.dict.type_is(b"ObjStm") || s.dict.type_is(b"XRef")))
        .map(|(id, _)| *id)
        .collect();
    for id in obj_streams {
        doc.objects.remove(&id);
    }

    let file_key = random_bytes(32);
    let p = perms.to_p();
    let zero = [0u8; 16];

    // Algorithm 8：U / UE
    let u_val_salt = random_bytes(8);
    let u_key_salt = random_bytes(8);
    let mut u = hash_r6(upw, &u_val_salt, &[], 6);
    u.extend_from_slice(&u_val_salt);
    u.extend_from_slice(&u_key_salt);
    let ue = Aes::new(&hash_r6(upw, &u_key_salt, &[], 6))?.cbc_encrypt_nopad(&zero, &file_key);

    // Algorithm 9：O / OE
    let o_val_salt = random_bytes(8);
    let o_key_salt = random_bytes(8);
    let mut o = hash_r6(opw, &o_val_salt, &u, 6);
    o.extend_from_slice(&o_val_salt);
    o.extend_from_slice(&o_key_salt);
    let oe = Aes::new(&hash_r6(opw, &o_key_salt, &u, 6))?.cbc_encrypt_nopad(&zero, &file_key);

    // Algorithm 10：Perms
    let mut perms_block = [0u8; 16];
    perms_block[..4].copy_from_slice(&(p as u32).to_le_bytes());
    perms_block[4..8].copy_from_slice(&[0xFF; 4]);
    perms_block[8] = b'T';
    perms_block[9..12].copy_from_slice(b"adb");
    perms_block[12..16].copy_from_slice(&random_bytes(4));
    Aes::new(&file_key)?.encrypt_block(&mut perms_block);

    let state = CryptState {
        key: file_key,
        stm: Cipher::AesV3,
        str_: Cipher::AesV3,
        encrypt_metadata: true,
        revision: 6,
    };
    for (id, obj) in doc.objects.iter_mut() {
        encrypt_in_place(&state, *id, obj);
    }

    let enc = dictionary! {
        "Filter" => "Standard",
        "V" => 5,
        "R" => 6,
        "Length" => 256,
        "CF" => dictionary! {
            "StdCF" => dictionary! {
                "AuthEvent" => "DocOpen",
                "CFM" => "AESV3",
                "Length" => 32,
            },
        },
        "StmF" => "StdCF",
        "StrF" => "StdCF",
        "O" => Object::String(o, StringFormat::Hexadecimal),
        "U" => Object::String(u, StringFormat::Hexadecimal),
        "OE" => Object::String(oe, StringFormat::Hexadecimal),
        "UE" => Object::String(ue, StringFormat::Hexadecimal),
        "Perms" => Object::String(perms_block.to_vec(), StringFormat::Hexadecimal),
        "P" => p as i64,
        "EncryptMetadata" => true,
    };
    let enc_id = doc.add_object(enc);
    doc.trailer.set("Encrypt", Object::Reference(enc_id));
    let id0 = random16().to_vec();
    doc.trailer.set(
        "ID",
        Object::Array(vec![
            Object::String(id0.clone(), StringFormat::Hexadecimal),
            Object::String(id0, StringFormat::Hexadecimal),
        ]),
    );
    // AES-256 需要 PDF 1.7 扩展级别 8（或 PDF 2.0）
    let ver: f32 = doc.version.parse().unwrap_or(1.4);
    if ver < 1.7 {
        doc.version = "1.7".into();
    }
    if let Ok(root_id) = doc.trailer.get(b"Root").and_then(|o| o.as_reference()) {
        if let Ok(Object::Dictionary(cat)) = doc.get_object_mut(root_id) {
            cat.set(
                "Extensions",
                dictionary! { "ADBE" => dictionary! { "BaseVersion" => Object::Name(b"1.7".to_vec()), "ExtensionLevel" => 8 } },
            );
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(b: &[u8]) -> String {
        b.iter().map(|x| format!("{x:02x}")).collect()
    }

    #[test]
    fn md5_vectors() {
        assert_eq!(hex(&md5(b"")), "d41d8cd98f00b204e9800998ecf8427e");
        assert_eq!(hex(&md5(b"The quick brown fox jumps over the lazy dog")), "9e107d9d372bb6826bd81d3542a419d6");
    }

    #[test]
    fn rc4_vector() {
        assert_eq!(hex(&rc4(b"Key", b"Plaintext")), "bbf316e8d940af0ad3");
    }

    #[test]
    fn aes_vectors() {
        // FIPS-197 附录 C
        let pt: [u8; 16] = [0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff];
        let k128: Vec<u8> = (0u8..16).collect();
        let k256: Vec<u8> = (0u8..32).collect();
        let mut b = pt;
        let a = Aes::new(&k128).unwrap();
        a.encrypt_block(&mut b);
        assert_eq!(hex(&b), "69c4e0d86a7b0430d8cdb78070b4c55a");
        a.decrypt_block(&mut b);
        assert_eq!(b, pt);
        let mut b = pt;
        let a = Aes::new(&k256).unwrap();
        a.encrypt_block(&mut b);
        assert_eq!(hex(&b), "8ea2b7ca516745bfeafc49904b496089");
        a.decrypt_block(&mut b);
        assert_eq!(b, pt);
    }

    #[test]
    fn perms_value() {
        let p = Permissions { print: true, modify: false, copy: true, annotate: true, fill_forms: true, assemble: false, print_high: true };
        assert_eq!(p.to_p() as u32 & 0xFFF, 0xB34 | 0x0C0);
    }
}
