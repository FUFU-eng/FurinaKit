//! Strict offline v1 torrent metadata boundary. No file I/O, networking or downloads.
//! `info_bytes` borrows the ORIGINAL bencoded bytes; hash those, never a re-encoding.
//! Not yet wired to IPC: callers must enforce filesystem/reparse-point safety.
use std::collections::{BTreeMap, BTreeSet};

const MAX_INPUT: usize = 8 * 1024 * 1024;
const MAX_NODES: usize = 100_000;
const MAX_FILES: usize = 10_000;
type Result<T> = std::result::Result<T, String>;
#[derive(Debug)]
enum Value<'a> {
    Int(i64),
    Bytes(&'a [u8]),
    List(Vec<Node<'a>>),
    Dict(BTreeMap<&'a [u8], Node<'a>>),
}
#[derive(Debug)]
struct Node<'a> {
    start: usize,
    end: usize,
    value: Value<'a>,
}
struct Parser<'a> {
    data: &'a [u8],
    pos: usize,
    nodes: usize,
}
impl<'a> Parser<'a> {
    fn bytes(&mut self) -> Result<&'a [u8]> {
        let start = self.pos;
        while self.data.get(self.pos).is_some_and(u8::is_ascii_digit) {
            self.pos += 1;
        }
        let digits = &self.data[start..self.pos];
        if digits.is_empty()
            || (digits.len() > 1 && digits[0] == b'0')
            || self.data.get(self.pos) != Some(&b':')
        {
            return Err("Invalid byte-string length".into());
        }
        let len = std::str::from_utf8(digits)
            .unwrap()
            .parse::<usize>()
            .map_err(|_| "Length overflow")?;
        self.pos += 1;
        let end = self
            .pos
            .checked_add(len)
            .filter(|&v| v <= self.data.len())
            .ok_or("Truncated byte string")?;
        let bytes = &self.data[self.pos..end];
        self.pos = end;
        Ok(bytes)
    }
    fn node(&mut self, depth: usize) -> Result<Node<'a>> {
        self.nodes += 1;
        if depth > 32 || self.nodes > MAX_NODES {
            return Err("Bencode complexity limit".into());
        }
        let start = self.pos;
        let value = match self
            .data
            .get(self.pos)
            .copied()
            .ok_or("Truncated bencode")?
        {
            b'0'..=b'9' => Value::Bytes(self.bytes()?),
            b'i' => {
                self.pos += 1;
                let s = self.pos;
                while self.data.get(self.pos).is_some_and(|b| *b != b'e') {
                    self.pos += 1;
                }
                if self.data.get(self.pos) != Some(&b'e') {
                    return Err("Unterminated integer".into());
                }
                let raw = &self.data[s..self.pos];
                self.pos += 1;
                let digits = raw.strip_prefix(b"-").unwrap_or(raw);
                if digits.is_empty()
                    || !digits.iter().all(u8::is_ascii_digit)
                    || (digits.len() > 1 && digits[0] == b'0')
                    || raw == b"-0"
                {
                    return Err("Noncanonical integer".into());
                }
                Value::Int(
                    std::str::from_utf8(raw)
                        .unwrap()
                        .parse()
                        .map_err(|_| "Integer overflow")?,
                )
            }
            b'l' => {
                self.pos += 1;
                let mut list = Vec::new();
                while self.data.get(self.pos) != Some(&b'e') {
                    list.push(self.node(depth + 1)?);
                }
                self.pos += 1;
                Value::List(list)
            }
            b'd' => {
                self.pos += 1;
                let mut map = BTreeMap::new();
                let mut previous: Option<&[u8]> = None;
                while self.data.get(self.pos) != Some(&b'e') {
                    let key = self.bytes()?;
                    if previous.is_some_and(|p| p >= key) {
                        return Err("Duplicate or unsorted dictionary key".into());
                    }
                    previous = Some(key);
                    map.insert(key, self.node(depth + 1)?);
                }
                self.pos += 1;
                Value::Dict(map)
            }
            _ => return Err("Invalid bencode token".into()),
        };
        Ok(Node {
            start,
            end: self.pos,
            value,
        })
    }
}
fn dict<'n, 'a>(n: &'n Node<'a>) -> Result<&'n BTreeMap<&'a [u8], Node<'a>>> {
    if let Value::Dict(v) = &n.value {
        Ok(v)
    } else {
        Err("Expected dictionary".into())
    }
}
fn bytes<'a>(n: &Node<'a>) -> Result<&'a [u8]> {
    if let Value::Bytes(v) = n.value {
        Ok(v)
    } else {
        Err("Expected bytes".into())
    }
}
fn number(n: &Node<'_>) -> Result<u64> {
    if let Value::Int(v) = n.value {
        u64::try_from(v).map_err(|_| "Negative length".into())
    } else {
        Err("Expected integer".into())
    }
}
fn get<'n, 'a>(d: &'n BTreeMap<&'a [u8], Node<'a>>, k: &[u8]) -> Result<&'n Node<'a>> {
    d.get(k)
        .ok_or_else(|| format!("Missing {}", String::from_utf8_lossy(k)))
}
fn component(raw: &[u8]) -> Result<String> {
    let s = std::str::from_utf8(raw).map_err(|_| "Path must be UTF-8")?;
    // Conservative portable Windows subset. Refuse ambiguous names rather than rename
    // them (renaming changes torrent paths). Also allow basic CJK unified ideographs,
    // which have no case mappings. Other Unicode/normalization forms remain unsupported.
    if s.is_empty()
        || s.len() > 120
        || !s.chars().all(|c| {
            c.is_ascii()
                || ('\u{3400}'..='\u{4dbf}').contains(&c)
                || ('\u{4e00}'..='\u{9fff}').contains(&c)
        })
        || s == "."
        || s == ".."
        || s.ends_with(['.', ' '])
        || s.chars()
            .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
    {
        return Err("Unsafe or unsupported Windows path component".into());
    }
    let stem = s
        .split('.')
        .next()
        .unwrap()
        .trim_end_matches(' ')
        .to_ascii_uppercase();
    if ["CON", "PRN", "AUX", "NUL", "CLOCK$", "CONIN$", "CONOUT$"].contains(&stem.as_str())
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && matches!(stem.as_bytes()[3], b'0'..=b'9'))
    {
        return Err("Windows reserved device name".into());
    }
    Ok(s.into())
}
#[derive(Debug, PartialEq)]
pub struct TorrentFile {
    pub path: Vec<String>,
    pub length: u64,
}
#[derive(Debug)]
pub struct TorrentMeta<'a> {
    pub name: String,
    pub files: Vec<TorrentFile>,
    pub total_length: u64,
    pub piece_length: u64,
    pub pieces: &'a [u8],
    pub info_bytes: &'a [u8],
}
/// Strict v1 only. Hybrid/v2, symlinks, paths outside ASCII/basic CJK, legacy encodings and
/// alternate UTF-8 path fields are explicitly rejected in this first boundary.
pub fn parse(data: &[u8]) -> Result<TorrentMeta<'_>> {
    if data.is_empty() || data.len() > MAX_INPUT {
        return Err("Torrent size limit (8 MiB)".into());
    }
    let mut p = Parser {
        data,
        pos: 0,
        nodes: 0,
    };
    let root = p.node(0)?;
    if p.pos != data.len() {
        return Err("Trailing bencode data".into());
    }
    let top = dict(&root)?;
    let info_node = get(top, b"info")?;
    let info = dict(info_node)?;
    for k in [
        b"meta version".as_slice(),
        b"file tree",
        b"name.utf-8",
        b"symlink path",
        b"attr",
    ] {
        if info.contains_key(k) {
            return Err("Unsupported v2/hybrid/alternate path or file attributes".into());
        }
    }
    if let Some(v) = info.get(b"private".as_slice()) {
        if number(v)? > 1 {
            return Err("Invalid private flag".into());
        }
    }
    let name = component(bytes(get(info, b"name")?)?)?;
    let piece_length = number(get(info, b"piece length")?)?;
    if piece_length == 0 || piece_length > 64 * 1024 * 1024 {
        return Err("Unsupported piece length".into());
    }
    let pieces = bytes(get(info, b"pieces")?)?;
    let mut files = Vec::new();
    match (
        info.get(b"length".as_slice()),
        info.get(b"files".as_slice()),
    ) {
        (Some(n), None) => files.push(TorrentFile {
            path: vec![name.clone()],
            length: number(n)?,
        }),
        (None, Some(n)) => {
            let list = if let Value::List(l) = &n.value {
                l
            } else {
                return Err("Expected file list".into());
            };
            if list.is_empty() || list.len() > MAX_FILES {
                return Err("File count limit".into());
            }
            for n in list {
                let f = dict(n)?;
                // Ignore no filesystem-affecting extension: reject unknown file fields.
                if f.keys()
                    .any(|k| ![b"length".as_slice(), b"path", b"md5sum"].contains(k))
                {
                    return Err("Unsupported file attributes".into());
                }
                let path_node = get(f, b"path")?;
                let path_list = if let Value::List(l) = &path_node.value {
                    l
                } else {
                    return Err("Expected path list".into());
                };
                if path_list.is_empty() || path_list.len() > 16 {
                    return Err("Path depth limit".into());
                }
                let mut path = vec![name.clone()];
                for c in path_list {
                    path.push(component(bytes(c)?)?);
                }
                if path.iter().map(|s| s.len() + 1).sum::<usize>() > 200 {
                    return Err("Relative path too long".into());
                }
                files.push(TorrentFile {
                    path,
                    length: number(get(f, b"length")?)?,
                });
            }
        }
        _ => return Err("Require exactly one of length/files".into()),
    }
    let mut seen = BTreeSet::new();
    let mut dirs = BTreeSet::new();
    let mut total = 0u64;
    for f in &files {
        let path = f.path.join("/").to_ascii_lowercase();
        if dirs.contains(&path) || !seen.insert(path) {
            return Err("Duplicate/case-colliding file or directory".into());
        }
        for n in 1..f.path.len() {
            let parent = f.path[..n].join("/").to_ascii_lowercase();
            if seen.contains(&parent) {
                return Err("File/directory collision".into());
            }
            dirs.insert(parent);
        }
        total = total.checked_add(f.length).ok_or("Total size overflow")?;
    }
    let count = total / piece_length + u64::from(total % piece_length != 0);
    if pieces.len() % 20 != 0 || pieces.len() as u64 / 20 != count {
        return Err("Piece hashes do not match total size".into());
    }
    Ok(TorrentMeta {
        name,
        files,
        total_length: total,
        piece_length,
        pieces,
        info_bytes: &data[info_node.start..info_node.end],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn torrent(info: &[u8]) -> Vec<u8> {
        [b"d4:info".as_slice(), info, b"e"].concat()
    }
    fn single(name: &str, length: u64, piece_length: u64, pieces: &[u8]) -> Vec<u8> {
        [
            format!(
                "d6:lengthi{length}e4:name{}:{name}12:piece lengthi{piece_length}e6:pieces{}:",
                name.len(),
                pieces.len()
            )
            .as_bytes(),
            pieces,
            b"e",
        ]
        .concat()
    }
    fn multi(paths: &[&[&str]]) -> Vec<u8> {
        let mut s = "d5:filesl".to_string();
        for path in paths {
            s.push_str("d6:lengthi1e4:pathl");
            for c in *path {
                s.push_str(&format!("{}:{c}", c.len()));
            }
            s.push_str("ee");
        }
        s.push_str("e4:name4:root12:piece lengthi16e6:pieces20:12345678901234567890e");
        torrent(s.as_bytes())
    }
    #[test]
    fn single_raw_info() {
        let i = single("file.bin", 3, 16, &[0xff; 20]);
        let t = torrent(&i);
        let m = parse(&t).unwrap();
        assert_eq!(m.info_bytes, i);
        assert_eq!(m.total_length, 3);
        assert_eq!(m.pieces, &[0xff; 20]);
        assert_eq!(m.piece_length, 16);
        assert_eq!(m.name, "file.bin");
    }
    #[test]
    fn multi_manifest() {
        let t = multi(&[&["a"], &["sub", "b"]]);
        let m = parse(&t).unwrap();
        assert_eq!(m.files.len(), 2);
        assert_eq!(m.total_length, 2);
        assert_eq!(m.files[1].path, ["root", "sub", "b"]);
    }
    #[test]
    fn zero_length() {
        assert!(parse(&torrent(&single("empty", 0, 16, b""))).is_ok());
    }
    #[test]
    fn path_attacks() {
        for name in [
            "", ".", "..", "../x", "a\\b", "C:x", "x:ads", "NUL.txt", "com1", "LPT9.x", "a.", "a ",
            "a?b", "CONIN$", "\0", "é",
        ] {
            assert!(
                parse(&torrent(&single(name, 1, 16, &[0; 20]))).is_err(),
                "{name:?}"
            );
        }
    }
    #[test]
    fn duplicate_and_prefix_paths() {
        for paths in [
            vec![&["a"][..], &["A"]],
            vec![&["a"][..], &["a", "b"]],
            vec![&["a", "b"][..], &["A"]],
        ] {
            assert!(parse(&multi(&paths)).is_err());
        }
    }
    #[test]
    fn counts_and_lengths() {
        for (len, pl, hashes) in [
            (1, 0, 20),
            (1, 16, 0),
            (17, 16, 20),
            (1, 16, 21),
            (0, 16, 20),
            (1, 67108865, 20),
        ] {
            assert!(parse(&torrent(&single("a", len, pl, &vec![0; hashes]))).is_err());
        }
    }
    #[test]
    fn canonical_bencode() {
        for raw in [
            b"i-0e".as_slice(),
            b"i01e",
            b"i+1e",
            b"i-e",
            b"i9223372036854775808e",
            b"01:a",
            b"d1:ai1e1:ai2ee",
            b"d1:bi1e1:ai2ee",
            b"999999999999999999999999:x",
            b"1:",
            b"d",
            b"l",
            b"x",
        ] {
            let mut p = Parser {
                data: raw,
                pos: 0,
                nodes: 0,
            };
            assert!(p.node(0).is_err(), "{raw:?}");
        }
    }
    #[test]
    fn trailing_and_truncations() {
        let t = torrent(&single("a", 1, 16, &[0; 20]));
        for n in 0..t.len() {
            assert!(parse(&t[..n]).is_err(), "prefix {n}");
        }
        let mut x = t;
        x.push(b'e');
        assert!(parse(&x).is_err());
    }
    #[test]
    fn depth_and_size_limits() {
        let t = [vec![b'l'; 40], vec![b'e'; 40]].concat();
        assert!(parse(&t).is_err());
        assert!(parse(&vec![0; MAX_INPUT + 1]).is_err());
    }
    fn with_field(key: &[u8], value: &[u8]) -> Vec<u8> {
        let i = single("a", 1, 16, &[0; 20]);
        let mut p = Parser {
            data: &i,
            pos: 0,
            nodes: 0,
        };
        let n = p.node(0).unwrap();
        let mut fields: BTreeMap<Vec<u8>, Vec<u8>> = dict(&n)
            .unwrap()
            .iter()
            .map(|(k, v)| (k.to_vec(), i[v.start..v.end].to_vec()))
            .collect();
        fields.insert(key.to_vec(), value.to_vec());
        let mut encoded = vec![b'd'];
        for (k, v) in fields {
            encoded.extend(format!("{}:", k.len()).bytes());
            encoded.extend(k);
            encoded.extend(v);
        }
        encoded.push(b'e');
        torrent(&encoded)
    }
    #[test]
    fn reject_v2_and_attributes() {
        for (k, v) in [
            (b"meta version".as_slice(), b"i2e".as_slice()),
            (b"file tree", b"de"),
            (b"name.utf-8", b"1:x"),
            (b"attr", b"1:l"),
            (b"symlink path", b"l1:xe"),
        ] {
            assert!(parse(&with_field(k, v))
                .unwrap_err()
                .contains("Unsupported v2"));
        }
    }
    #[test]
    fn private_flag() {
        for v in [b"i0e".as_slice(), b"i1e"] {
            assert!(parse(&with_field(b"private", v)).is_ok());
        }
        for v in [b"i2e".as_slice(), b"i-1e", b"1:1"] {
            assert!(parse(&with_field(b"private", v)).is_err());
        }
    }
    #[test]
    fn ambiguous_layout() {
        assert!(parse(&with_field(b"files", b"le"))
            .unwrap_err()
            .contains("exactly one"));
    }
    #[test]
    fn binary_unknown_fields_preserve_info() {
        let t = with_field(b"source", b"3:\xff\x00\xfe");
        let m = parse(&t).unwrap();
        assert!(m.info_bytes.windows(3).any(|s| s == b"\xff\x00\xfe"));
        assert_eq!(m.info_bytes, &t[7..t.len() - 1]);
    }
    #[test]
    fn wrong_types_and_negative_length() {
        for (k, v) in [
            (b"length".as_slice(), b"i-1e".as_slice()),
            (b"length", b"1:1"),
            (b"name", b"i1e"),
            (b"pieces", b"le"),
            (b"piece length", b"1:1"),
        ] {
            assert!(parse(&with_field(k, v)).is_err());
        }
    }
    #[test]
    fn path_depth_and_length() {
        let deep = vec!["a"; 17];
        assert!(parse(&multi(&[&deep])).is_err());
        let long = "a".repeat(121);
        assert!(parse(&multi(&[&[&long]])).is_err());
        let segment = "b".repeat(100);
        assert!(parse(&multi(&[&[&segment, &segment]])).is_err());
    }
    #[test]
    fn node_limit() {
        let raw = [b"l".as_slice(), &b"0:".repeat(MAX_NODES), b"e"].concat();
        let mut p = Parser {
            data: &raw,
            pos: 0,
            nodes: 0,
        };
        assert!(p.node(0).unwrap_err().contains("complexity"));
    }
    #[test]
    fn file_limit_and_empty_paths() {
        let paths = vec![&["a"][..]; MAX_FILES + 1];
        assert!(parse(&multi(&paths)).unwrap_err().contains("File count"));
        assert!(parse(&multi(&[&[]])).unwrap_err().contains("Path depth"));
        assert!(parse(&multi(&[])).unwrap_err().contains("File count"));
    }
    #[test]
    fn reject_symlink_file_fields() {
        let original = multi(&[&["a"]]);
        let mut modified = original.clone();
        let start = original
            .windows(10)
            .position(|s| s == b"d6:lengthi")
            .unwrap();
        modified.splice(start + 1..start + 1, b"4:attr1:l".iter().copied());
        assert!(parse(&modified)
            .unwrap_err()
            .contains("Unsupported file attributes"));
    }
    #[test]
    fn malformed_never_panics() {
        let mut seed = 7u64;
        for len in 0..512 {
            let mut bytes = vec![0; len];
            for b in &mut bytes {
                seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
                *b = (seed >> 32) as u8;
            }
            let _ = parse(&bytes);
        }
    }
}

#[cfg(test)]
mod cjk_tests {
    use super::*;
    #[test]
    fn chinese_component_preserved() {
        assert_eq!(
            component("中文文件.txt".as_bytes()).unwrap(),
            "中文文件.txt"
        );
    }
    #[test]
    fn unsupported_unicode_explicit() {
        for v in ["é", "e\u{301}", "K", "Ａ", "a\u{202e}exe", "😀", "COM¹"] {
            assert!(component(v.as_bytes()).is_err(), "{v}");
        }
    }
    #[test]
    fn cjk_does_not_hide_path_attack() {
        for v in ["中文/文件", "中文:数据", "中文.", "中文 ", "../中文"] {
            assert!(component(v.as_bytes()).is_err(), "{v}");
        }
    }
}
