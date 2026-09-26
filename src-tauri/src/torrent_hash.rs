//! BitTorrent v1 SHA-1 via the Windows CNG provider (not a hand-written hash).
//! SHA-1 here is a protocol checksum, NOT a signature or collision-resistant trust anchor.
use std::ffi::c_void;
type Handle = *mut c_void;
#[link(name = "bcrypt")]
extern "system" {
    fn BCryptOpenAlgorithmProvider(
        out: *mut Handle,
        name: *const u16,
        implementation: *const u16,
        flags: u32,
    ) -> i32;
    fn BCryptCloseAlgorithmProvider(algorithm: Handle, flags: u32) -> i32;
    fn BCryptCreateHash(
        algorithm: Handle,
        out: *mut Handle,
        object: *mut u8,
        object_len: u32,
        secret: *const u8,
        secret_len: u32,
        flags: u32,
    ) -> i32;
    fn BCryptHashData(hash: Handle, data: *const u8, len: u32, flags: u32) -> i32;
    fn BCryptFinishHash(hash: Handle, out: *mut u8, len: u32, flags: u32) -> i32;
    fn BCryptDestroyHash(hash: Handle) -> i32;
}
fn status(code: i32, op: &str) -> Result<(), String> {
    if code >= 0 {
        Ok(())
    } else {
        Err(format!("{op}: NTSTATUS 0x{:08x}", code as u32))
    }
}
struct Algorithm(Handle);
impl Drop for Algorithm {
    fn drop(&mut self) {
        unsafe {
            BCryptCloseAlgorithmProvider(self.0, 0);
        }
    }
}
pub struct Sha1 {
    hash: Handle,
    _algorithm: Algorithm,
}
impl Sha1 {
    pub fn new() -> Result<Self, String> {
        let name: Vec<u16> = "SHA1\0".encode_utf16().collect();
        let mut raw = std::ptr::null_mut();
        status(
            unsafe { BCryptOpenAlgorithmProvider(&mut raw, name.as_ptr(), std::ptr::null(), 0) },
            "Open SHA1 provider",
        )?;
        let algorithm = Algorithm(raw);
        let mut hash = std::ptr::null_mut();
        // Windows 7+ CNG allocates/frees its hash-object buffer when NULL/0 is passed.
        status(
            unsafe {
                BCryptCreateHash(
                    raw,
                    &mut hash,
                    std::ptr::null_mut(),
                    0,
                    std::ptr::null(),
                    0,
                    0,
                )
            },
            "Create SHA1 hash",
        )?;
        Ok(Self {
            hash,
            _algorithm: algorithm,
        })
    }
    pub fn update(&mut self, bytes: &[u8]) -> Result<(), String> {
        for chunk in bytes.chunks(1024 * 1024) {
            status(
                unsafe { BCryptHashData(self.hash, chunk.as_ptr(), chunk.len() as u32, 0) },
                "Update SHA1",
            )?;
        }
        Ok(())
    }
    pub fn finish(self) -> Result<[u8; 20], String> {
        let mut result = [0u8; 20];
        status(
            unsafe { BCryptFinishHash(self.hash, result.as_mut_ptr(), 20, 0) },
            "Finish SHA1",
        )?;
        Ok(result)
    }
}
impl Drop for Sha1 {
    fn drop(&mut self) {
        unsafe {
            BCryptDestroyHash(self.hash);
        }
    }
}
pub fn digest(bytes: &[u8]) -> Result<[u8; 20], String> {
    let mut hash = Sha1::new()?;
    hash.update(bytes)?;
    hash.finish()
}
pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn known_vectors() {
        for (input, expected) in [
            (b"".as_slice(), "da39a3ee5e6b4b0d3255bfef95601890afd80709"),
            (b"abc", "a9993e364706816aba3e25717850c26c9cd0d89d"),
            (
                b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
                "84983e441c3bd26ebaae4aa1f95129e5e54670f1",
            ),
        ] {
            assert_eq!(hex(&digest(input).unwrap()), expected);
        }
    }
    #[test]
    fn million_a_streaming() {
        let mut hash = Sha1::new().unwrap();
        for _ in 0..1000 {
            hash.update(&[b'a'; 1000]).unwrap();
        }
        assert_eq!(
            hex(&hash.finish().unwrap()),
            "34aa973cd4c4daa4f61eeb2bdbad27316534016f"
        );
    }
    #[test]
    fn chunk_boundaries() {
        let bytes: Vec<u8> = (0..2097193).map(|i| (i % 251) as u8).collect();
        let expected = digest(&bytes).unwrap();
        for chunk in [1, 55, 56, 63, 64, 65, 65536] {
            let mut hash = Sha1::new().unwrap();
            for part in bytes.chunks(chunk) {
                hash.update(part).unwrap();
            }
            assert_eq!(hash.finish().unwrap(), expected);
        }
    }
}
