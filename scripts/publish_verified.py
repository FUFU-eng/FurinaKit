"""CI publisher for this owner-approved, hash-pinned release. Never reads credential stores."""
from pathlib import Path, PurePosixPath
import hashlib,json,os,re,subprocess,sys,tempfile,time,urllib.request,zipfile,concurrent.futures
ROOT=Path(__file__).resolve().parents[1]
REPO='FUFU-eng/FurinaKit'; TAG='v2.1.0'
def digest(p):
    with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def gh(*args,required=True):
    p=subprocess.run(['gh',*args],text=True,capture_output=True)
    if required and p.returncode:raise RuntimeError('GitHub operation failed: '+p.stderr)
    return p
def api(endpoint):
    p=gh('api',endpoint,required=False)
    return json.loads(p.stdout) if p.returncode==0 else None

def main():
    if os.environ.get('GITHUB_REPOSITORY')!=REPO or os.environ.get('GITHUB_REF_NAME')!='release/2.1.0-20260926':
        raise SystemExit('Publication restricted to the approved repository/release branch')
    commit=os.environ['GITHUB_SHA']; mf=ROOT/'release/publication-assets.json'; m=json.loads(mf.read_text())
    if m['schema']!=1 or m['repository']!=REPO or m['tag']!=TAG:raise ValueError('Wrong release manifest')
    assets=m['assets']; names=[a['name'] for a in assets]
    if len(names)!=len(set(names)):raise ValueError('Duplicate asset name')
    marker='<!-- verified-publication source='+commit+' manifest='+digest(mf)+' -->'
    release=api('repos/'+REPO+'/releases/tags/'+TAG)
    if release and (not release.get('draft') or release.get('target_commitish')!=commit or marker not in release.get('body','')):
        raise RuntimeError('Existing public/unrelated release will not be overwritten')
    ref=api('repos/'+REPO+'/git/ref/tags/'+TAG)
    if ref and ref.get('object',{}).get('sha')!=commit:raise RuntimeError('Existing tag differs; no force updates')
    tmp=Path(tempfile.mkdtemp(prefix='furinakit-publish-'))
    for a in assets:
        if not re.fullmatch(r'[A-Za-z0-9._-]{1,150}',a['name']) or not re.fullmatch(r'[a-f0-9]{64}',a['sha256']) or not 0<a['bytes']<2_000_000_000 or not a['url'].startswith('https://'):raise ValueError('Invalid asset entry')
        p=tmp/a['name'];parts=tmp/(a['name']+'.parts');parts.mkdir()
        print('DOWNLOADING_IN_CHUNKS',a['name'],flush=True)
        block=4*1024*1024
        offsets=list(range(0,a['bytes'],block))
        def transfer_part(start):
            end=min(a['bytes']-1,start+block-1);segment=parts/str(start);headers=parts/(str(start)+'.headers')
            url=a['url']+('&' if '?' in a['url'] else '?')+'verifiedPart='+str(start)+'&digest='+a['sha256'][:16]
            result=subprocess.run(['curl','--http1.1','--fail','--location','--silent','--show-error','--proto','=https','--proto-redir','=https','--retry','5','--retry-all-errors','--retry-max-time','240','--connect-timeout','15','--max-time','120','--range',str(start)+'-'+str(end),'--max-filesize',str(end-start+1),'--dump-header',str(headers),'--output',str(segment),url],text=True,capture_output=True)
            if result.returncode:raise RuntimeError('Asset chunk transfer failed: '+a['name']+' offset '+str(start)+': '+result.stderr[-800:])
            if segment.stat().st_size!=end-start+1:raise ValueError('Chunk size differs')
            ranges=re.findall(r'(?im)^content-range:\s*bytes (\d+)-(\d+)/(\d+)',headers.read_text(errors='replace'))
            if not ranges or tuple(map(int,ranges[-1]))!=(start,end,a['bytes']):raise ValueError('Server did not confirm the requested byte range')
            return start
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            for _ in pool.map(transfer_part,offsets):pass
        with p.open('xb') as output:
            for start in offsets:
                with (parts/str(start)).open('rb') as source:
                    while True:
                        data=source.read(1024*1024)
                        if not data:break
                        output.write(data)
        if p.stat().st_size!=a['bytes'] or digest(p)!=a['sha256']:raise ValueError('Asset integrity failed: '+a['name'])
        print('VERIFIED',a['name'],p.stat().st_size,flush=True)
    models=json.loads((tmp/'MODEL-DOWNLOADS.json').read_text())
    if models['status']!='completed' or models['files']!=16 or models['optionalModelsBundled'] is not False:raise ValueError('Model verification incomplete')
    unpack=tmp/'portable';unpack.mkdir()
    with zipfile.ZipFile(tmp/'FurinaKit-v2.1.0-windows-x64.zip') as z:
        items=z.infolist()
        if len(items)>1000 or sum(i.file_size for i in items)>500_000_000:raise ValueError('Unexpected ZIP inventory')
        if len({i.filename for i in items})!=len(items):raise ValueError('Duplicate ZIP paths')
        for i in items:
            p=PurePosixPath(i.filename)
            if p.is_absolute() or '..' in p.parts or '\\' in i.filename or ':' in i.filename or not i.filename.startswith('FurinaKit/') or ((i.external_attr>>16)&0o170000)==0o120000:raise ValueError('Unsafe ZIP member')
        inventory=json.loads(z.read('FurinaKit/FurinaKit-files.json'));expected={'FurinaKit/'+f['path']:f for f in inventory['files']}
        if {i.filename for i in items if not i.is_dir()}!=set(expected)|{'FurinaKit/FurinaKit-files.json'}:raise ValueError('ZIP file set differs')
        for name,f in expected.items():
            with z.open(name) as stream:h=hashlib.file_digest(stream,'sha256').hexdigest()
            if h!=f['sha256'] or z.getinfo(name).file_size!=f['bytes']:raise ValueError('ZIP member integrity failed')
        z.extractall(unpack)
    subprocess.run([sys.executable,'scripts/fetch_build_resources.py','--archive',str(tmp/'FurinaKit.BuildResources.2.1.0.zip')],cwd=ROOT,check=True)
    subprocess.run([sys.executable,'scripts/assemble_desktop.py','--exe',str(unpack/'FurinaKit/FurinaKit.exe'),'--output','release-work/ci-assembly/FurinaKit'],cwd=ROOT,check=True)
    for f in inventory['files']:
        if f['path'] in ['FurinaKit-runtime.json','README.txt']:continue
        if digest(ROOT/'release-work/ci-assembly/FurinaKit'/f['path'])!=f['sha256']:raise ValueError('Fresh source assembly differs: '+f['path'])
    if not release:
        note=tmp/'notes.md';note.write_text((ROOT/'docs/releases/v2.1.0.md').read_text(encoding='utf-8')+'\n\n'+marker+'\n',encoding='utf-8')
        gh('release','create',TAG,'--repo',REPO,'--target',commit,'--title','FurinaKit v2.1.0 · Tauri 原生版','--draft','--notes-file',str(note))
        release=api('repos/'+REPO+'/releases/tags/'+TAG)
    existing={a['name']:a for a in release['assets']}
    if set(existing)-set(names):raise ValueError('Unrecognized draft attachment')
    for a in assets:
        if a['name'] in existing:
            e=existing[a['name']]
            if e['size']!=a['bytes'] or e.get('digest')!='sha256:'+a['sha256']:raise ValueError('Existing attachment differs')
        else:gh('release','upload',TAG,str(tmp/a['name']),'--repo',REPO)
    for attempt in range(12):
        release=api('repos/'+REPO+'/releases/tags/'+TAG);uploaded={a['name']:a for a in release['assets']}
        if set(uploaded)==set(names) and all(uploaded[a['name']]['size']==a['bytes'] and uploaded[a['name']].get('digest')=='sha256:'+a['sha256'] and uploaded[a['name']]['state']=='uploaded' for a in assets):break
        if attempt==11:raise ValueError('GitHub attachment hashes not confirmed')
        time.sleep(5)
    gh('release','edit',TAG,'--repo',REPO,'--draft=false','--latest')
    release=api('repos/'+REPO+'/releases/tags/'+TAG)
    if release['draft']:raise ValueError('Public release not confirmed')
    print('PUBLIC_RELEASE',release['html_url'],flush=True)
    summary=os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary,'a',encoding='utf-8') as f:
            f.write('## Verified release\n\n'+release['html_url']+'\n\nCommit: `'+commit+'`\n\n')
            for a in assets:f.write('- `'+a['name']+'`: `'+a['sha256']+'`\n')
if __name__=='__main__':
    try:main()
    except Exception as error:
        message=str(error).replace('%','%25').replace('\r','%0D').replace('\n','%0A')
        print('::error title=Release verification failed::'+message,flush=True)
        raise
