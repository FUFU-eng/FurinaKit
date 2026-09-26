//! Verify v1 payload streams in manifest order, including pieces spanning files.
//! This layer does NOT open paths: callers must enforce owned-directory, reparse-point,
//! exclusive-write and manifest-only output rules before supplying trusted handles.
use crate::torrent_hash::{self, Sha1};
use crate::torrent_meta::{TorrentFile, TorrentMeta};
use std::io::Read;

pub fn info_hash(meta: &TorrentMeta<'_>) -> Result<String, String> {
    Ok(torrent_hash::hex(&torrent_hash::digest(meta.info_bytes)?))
}
#[derive(Debug, PartialEq)]
pub struct Verified {
    pub bytes: u64,
    pub files: usize,
    pub pieces: usize,
}
/// Readers must be finite and local. Cancel is checked between bounded 64 KiB reads;
/// it cannot interrupt a caller-supplied blocking Read implementation.
pub fn verify<'a>(
    meta: &TorrentMeta<'_>,
    mut open: impl FnMut(&TorrentFile) -> Result<Box<dyn Read + 'a>, String>,
    mut cancelled: impl FnMut() -> bool,
) -> Result<Verified, String> {
    if meta.piece_length == 0 || meta.pieces.len() % 20 != 0 {
        return Err("Invalid verification metadata".into());
    }
    let mut hash = Sha1::new()?;
    let mut piece_used = 0u64;
    let mut piece_index = 0usize;
    let mut total = 0u64;
    let mut buffer = [0u8; 65536];
    for file in &meta.files {
        if cancelled() {
            return Err("Verification cancelled".into());
        }
        let mut reader = open(file)?;
        let mut remaining = file.length;
        while remaining > 0 {
            if cancelled() {
                return Err("Verification cancelled".into());
            }
            let amount = remaining
                .min(meta.piece_length - piece_used)
                .min(buffer.len() as u64) as usize;
            let n = match reader.read(&mut buffer[..amount]) {
                Ok(0) => return Err(format!("Truncated payload: {}", file.path.join("/"))),
                Ok(n) => n,
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(e) => return Err(format!("Payload read failed: {e}")),
            };
            hash.update(&buffer[..n])?;
            remaining -= n as u64;
            piece_used += n as u64;
            total = total.checked_add(n as u64).ok_or("Payload size overflow")?;
            if piece_used == meta.piece_length {
                check_piece(hash.finish()?, meta.pieces, piece_index)?;
                piece_index += 1;
                piece_used = 0;
                hash = Sha1::new()?;
            }
        }
        loop {
            if cancelled() {
                return Err("Verification cancelled".into());
            }
            match reader.read(&mut buffer[..1]) {
                Ok(0) => break,
                Ok(_) => return Err(format!("Oversized payload: {}", file.path.join("/"))),
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(e) => return Err(format!("Payload trailing-byte check failed: {e}")),
            }
        }
    }
    if piece_used > 0 {
        check_piece(hash.finish()?, meta.pieces, piece_index)?;
        piece_index += 1;
    }
    if cancelled() {
        return Err("Verification cancelled".into());
    }
    if total != meta.total_length || piece_index != meta.pieces.len() / 20 {
        return Err("Payload manifest mismatch".into());
    }
    Ok(Verified {
        bytes: total,
        files: meta.files.len(),
        pieces: piece_index,
    })
}
fn check_piece(actual: [u8; 20], expected: &[u8], index: usize) -> Result<(), String> {
    let start = index.checked_mul(20).ok_or("Piece index overflow")?;
    let end = start.checked_add(20).ok_or("Piece index overflow")?;
    if expected.get(start..end) != Some(actual.as_slice()) {
        return Err(format!("Piece {index} SHA-1 mismatch"));
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    fn meta<'a>(pieces: &'a [u8]) -> TorrentMeta<'a> {
        TorrentMeta {
            name: "root".into(),
            files: vec![
                TorrentFile {
                    path: vec!["a".into()],
                    length: 2,
                },
                TorrentFile {
                    path: vec!["empty".into()],
                    length: 0,
                },
                TorrentFile {
                    path: vec!["b".into()],
                    length: 5,
                },
            ],
            total_length: 7,
            piece_length: 4,
            pieces,
            info_bytes: b"de",
        }
    }
    fn hashes() -> Vec<u8> {
        [
            torrent_hash::digest(b"abcd").unwrap(),
            torrent_hash::digest(b"efg").unwrap(),
        ]
        .concat()
    }
    fn readers(f: &TorrentFile) -> Result<Box<dyn Read>, String> {
        Ok(Box::new(Cursor::new(match f.path[0].as_str() {
            "a" => b"ab".to_vec(),
            "b" => b"cdefg".to_vec(),
            _ => vec![],
        })))
    }
    #[test]
    fn crosses_files_and_empty_file() {
        let h = hashes();
        assert_eq!(
            verify(&meta(&h), readers, || false).unwrap(),
            Verified {
                bytes: 7,
                files: 3,
                pieces: 2
            }
        );
    }
    #[test]
    fn corruption_rejected() {
        let mut h = hashes();
        h[0] ^= 1;
        assert!(verify(&meta(&h), readers, || false)
            .unwrap_err()
            .contains("SHA-1 mismatch"));
    }
    #[test]
    fn short_and_long_rejected() {
        let h = hashes();
        for data in [b"a".to_vec(), b"abc".to_vec()] {
            let error = verify(
                &meta(&h),
                |_| Ok(Box::new(Cursor::new(data.clone()))),
                || false,
            )
            .unwrap_err();
            assert!(error.contains("Truncated") || error.contains("Oversized"));
        }
    }
    #[test]
    fn missing_file_rejected() {
        let h = hashes();
        assert!(verify(&meta(&h), |_| Err("missing".into()), || false).is_err());
    }
    #[test]
    fn cancellation_before_and_during() {
        let h = hashes();
        assert!(verify(&meta(&h), |_| panic!("must not open"), || true)
            .unwrap_err()
            .contains("cancelled"));
        let mut checks = 0;
        assert!(verify(&meta(&h), readers, || {
            checks += 1;
            checks > 3
        })
        .unwrap_err()
        .contains("cancelled"));
    }
    #[test]
    fn exact_piece_and_zero_payload() {
        let h = torrent_hash::digest(b"abcd").unwrap();
        let mut m = meta(&h);
        m.files = vec![TorrentFile {
            path: vec!["a".into()],
            length: 4,
        }];
        m.total_length = 4;
        assert_eq!(
            verify(&m, |_| Ok(Box::new(Cursor::new(b"abcd"))), || false)
                .unwrap()
                .pieces,
            1
        );
        m.files[0].length = 0;
        m.total_length = 0;
        m.pieces = b"";
        assert_eq!(
            verify(&m, |_| Ok(Box::new(Cursor::new(b""))), || false)
                .unwrap()
                .pieces,
            0
        );
    }
    #[test]
    fn malformed_public_metadata_is_rejected() {
        let h = hashes();
        let mut m = meta(&h);
        m.piece_length = 0;
        assert!(verify(&m, readers, || false).is_err());
        m.piece_length = 4;
        m.total_length = 8;
        assert!(verify(&m, readers, || false).is_err());
    }
}
