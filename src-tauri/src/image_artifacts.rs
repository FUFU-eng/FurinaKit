//! Task-owned bounded artifacts. No shell ZIP process and no whole-batch byte buffer.
use std::{fs::{self,File,OpenOptions},io::{self,Read,Write,Seek,SeekFrom},path::{Path,PathBuf}};
pub struct Scratch(pub PathBuf);
impl Scratch{pub fn create(parent:&Path,id:&str)->Result<Self,String>{fs::create_dir_all(parent).map_err(|e|e.to_string())?;let path=parent.join(format!("native-image-{id}"));fs::create_dir(&path).map_err(|e|e.to_string())?;Ok(Self(path))}}
impl Scratch {
    /// Windows directory handles may outlast child termination briefly. Retry only
    /// sharing/access/nonempty errors, within one second; preserve residue on failure.
    pub fn cleanup(&self)->Result<(),String>{
        let until=std::time::Instant::now()+std::time::Duration::from_secs(1);
        loop { match fs::remove_dir_all(&self.0) {
            Ok(())=>return Ok(()),
            Err(e) if e.kind()==io::ErrorKind::NotFound=>return Ok(()),
            Err(e) if cfg!(windows)&&matches!(e.raw_os_error(),Some(5|32|33|145))&&std::time::Instant::now()<until=>std::thread::sleep(std::time::Duration::from_millis(20)),
            Err(e)=>return Err(format!("Temporary workspace cleanup incomplete: {e}")),
        }}
    }
}
impl Drop for Scratch{fn drop(&mut self){if let Err(e)=self.cleanup(){let _=writeln!(io::stderr(),"{e}");}}}
pub struct LimitedFile{file:File,limit:u64}
impl LimitedFile{
    pub fn create(path:&Path,limit:u64)->Result<Self,String>{Ok(Self{file:OpenOptions::new().read(true).write(true).create_new(true).open(path).map_err(|e|e.to_string())?,limit})}
    pub fn sync(&mut self)->Result<(),String>{self.file.sync_all().map_err(|e|e.to_string())}
}
impl Write for LimitedFile{
    fn write(&mut self,data:&[u8])->io::Result<usize>{if self.file.stream_position()?.saturating_add(data.len() as u64)>self.limit{return Err(io::Error::new(io::ErrorKind::InvalidData,"产物超出大小限制 / Artifact size limit exceeded"));}self.file.write(data)}
    fn flush(&mut self)->io::Result<()>{self.file.flush()}
}
impl Seek for LimitedFile{fn seek(&mut self,pos:SeekFrom)->io::Result<u64>{self.file.seek(pos)}}
pub fn copy_new(source:&Path,target:&Path,limit:u64,check:&dyn Fn()->Result<(),String>)->Result<u64,String>{
    let mut source=File::open(source).map_err(|e|e.to_string())?;let mut output=LimitedFile::create(target,limit)?;
    let result=(||{let mut buffer=vec![0;1024*1024];let mut total=0;loop{check()?;let n=source.read(&mut buffer).map_err(|e|e.to_string())?;if n==0{break;}output.write_all(&buffer[..n]).map_err(|e|e.to_string())?;total+=n as u64;}output.sync()?;Ok(total)})();
    drop(output);if result.is_err(){let _=fs::remove_file(target);}result
}
fn crc_update(mut crc:u32,data:&[u8])->u32{
    static TABLE:std::sync::OnceLock<[u32;256]>=std::sync::OnceLock::new();
    let table=TABLE.get_or_init(||std::array::from_fn(|i|{let mut c=i as u32;for _ in 0..8{c=if c&1!=0{0xedb88320^(c>>1)}else{c>>1};}c}));
    for byte in data{crc=table[((crc^*byte as u32)&255) as usize]^(crc>>8);}crc
}
/// ZIP32, UTF-8 names, stored members. Input files are private immutable task outputs.
pub fn zip(entries:&[(String,PathBuf)],target:&Path,check:&dyn Fn()->Result<(),String>)->Result<(),String>{
    fn run(entries:&[(String,PathBuf)],out:&mut LimitedFile,check:&dyn Fn()->Result<(),String>)->Result<(),String>{
        let mut central=Vec::new();let mut buffer=vec![0;1024*1024];
        for (name,path) in entries{
            check()?;if name.is_empty()||name.len()>65535||name.contains(['/', '\\', '\0'])||name=="."||name==".."{return Err("Unsafe ZIP member name".into());}
            let mut input=File::open(path).map_err(|e|e.to_string())?;let size=input.metadata().map_err(|e|e.to_string())?.len();let size=u32::try_from(size).map_err(|_|"ZIP member too large")?;
            let offset=u32::try_from(out.stream_position().map_err(|e|e.to_string())?).map_err(|_|"ZIP offset overflow")?;
            let mut header=Vec::new();header.extend(0x04034b50u32.to_le_bytes());for n in [20u16,0x0800,0,0,33]{header.extend(n.to_le_bytes());}header.extend(0u32.to_le_bytes());header.extend(size.to_le_bytes());header.extend(size.to_le_bytes());header.extend((name.len() as u16).to_le_bytes());header.extend(0u16.to_le_bytes());header.extend(name.as_bytes());out.write_all(&header).map_err(|e|e.to_string())?;
            let mut crc=0xffffffff;let mut copied=0u64;
            loop{check()?;let n=input.read(&mut buffer).map_err(|e|e.to_string())?;if n==0{break;}out.write_all(&buffer[..n]).map_err(|e|e.to_string())?;crc=crc_update(crc,&buffer[..n]);copied+=n as u64;}
            if copied!=size as u64{return Err("Task artifact changed during ZIP creation".into());}let crc=crc^0xffffffff;
            let end=out.stream_position().map_err(|e|e.to_string())?;out.seek(SeekFrom::Start(offset as u64+14)).map_err(|e|e.to_string())?;out.write_all(&crc.to_le_bytes()).map_err(|e|e.to_string())?;out.seek(SeekFrom::Start(end)).map_err(|e|e.to_string())?;
            central.extend(0x02014b50u32.to_le_bytes());for n in [20u16,20,0x0800,0,0,33]{central.extend(n.to_le_bytes());}central.extend(crc.to_le_bytes());central.extend(size.to_le_bytes());central.extend(size.to_le_bytes());central.extend((name.len() as u16).to_le_bytes());for _ in 0..4{central.extend(0u16.to_le_bytes());}central.extend(0u32.to_le_bytes());central.extend(offset.to_le_bytes());central.extend(name.as_bytes());
        }
        check()?;let offset=out.stream_position().map_err(|e|e.to_string())? as u32;out.write_all(&central).map_err(|e|e.to_string())?;
        let mut end=Vec::new();end.extend(0x06054b50u32.to_le_bytes());end.extend([0;4]);let count=u16::try_from(entries.len()).map_err(|_|"Too many ZIP entries")?;end.extend(count.to_le_bytes());end.extend(count.to_le_bytes());end.extend((central.len() as u32).to_le_bytes());end.extend(offset.to_le_bytes());end.extend(0u16.to_le_bytes());out.write_all(&end).map_err(|e|e.to_string())?;out.sync()
    }
    let mut out=LimitedFile::create(target,2_000_000_000)?;let result=run(entries,&mut out,check);drop(out);if result.is_err(){let _=fs::remove_file(target);}result
}
#[cfg(all(test,windows))]mod scratch_cleanup_tests {
 use super::*;use std::{os::windows::fs::OpenOptionsExt,time::{Duration,Instant}};
 fn scratch(name:&str)->Scratch{Scratch::create(&PathBuf::from(std::env::var_os("FK_SCRATCH_TEST_ROOT").expect("isolated scratch test root")),name).unwrap()}
 fn hold(path:&Path)->File{OpenOptions::new().read(true).share_mode(3).custom_flags(0x02000000).open(path).unwrap()}
 #[test]fn delayed_directory_handle_release_is_retried(){let s=scratch("delayed");let h=hold(&s.0);let started=Instant::now();let worker=std::thread::spawn(move||{std::thread::sleep(Duration::from_millis(100));drop(h);});s.cleanup().unwrap();worker.join().unwrap();assert!(started.elapsed()>=Duration::from_millis(80));assert!(!s.0.exists());}
 #[test]fn persistent_directory_lock_is_bounded_and_residue_is_preserved(){let s=scratch("persistent");let h=hold(&s.0);let started=Instant::now();assert!(s.cleanup().is_err());assert!(started.elapsed()<Duration::from_secs(3));assert!(s.0.exists());drop(h);s.cleanup().unwrap();assert!(!s.0.exists());}
}
