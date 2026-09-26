"""Publish verified release assets by release ID; safely resume only an owned draft."""
from pathlib import Path,PurePosixPath
import concurrent.futures,hashlib,json,os,re,shutil,subprocess,sys,tempfile,time,zipfile
ROOT=Path(__file__).resolve().parents[1];REPO='FUFU-eng/FurinaKit';TAG='v2.1.0'
KNOWN_SOURCES={'3ef204e31533d0162f3da648d8fa057797bb9ead'}
def digest(p):
    with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def gh(*args,required=True,output=None):
    p=subprocess.run(['gh',*args],text=output is None,stdout=output or subprocess.PIPE,stderr=subprocess.PIPE)
    if required and p.returncode:raise RuntimeError('GitHub operation failed: '+(p.stderr.decode(errors='replace') if isinstance(p.stderr,bytes) else p.stderr))
    return p
def api(endpoint,missing=False):
    p=gh('api',endpoint,required=False)
    if p.returncode:
        if missing and 'HTTP 404' in p.stderr:return None
        raise RuntimeError('GitHub API read failed: '+p.stderr)
    return json.loads(p.stdout)
def mutate(endpoint,method,body,tmp):
    request=tmp/'api-request.json';request.write_text(json.dumps(body,ensure_ascii=False),encoding='utf-8')
    return json.loads(gh('api','--method',method,endpoint,'--input',str(request)).stdout)
def find_release():
    rows=api('repos/'+REPO+'/releases?per_page=100')
    matches=[x for x in rows if x['tag_name']==TAG]
    if len(matches)>1:raise RuntimeError('Multiple same-tag drafts/releases; manual review required')
    return matches[0] if matches else None

def main():
    if os.environ.get('GITHUB_REPOSITORY')!=REPO or os.environ.get('GITHUB_REF_NAME')!='release/2.1.0-20260926':raise RuntimeError('Unapproved repository/ref')
    commit=os.environ['GITHUB_SHA'];mf=ROOT/'release/publication-assets.json';m=json.loads(mf.read_text());mh=digest(mf)
    if m['schema']!=1 or m['repository']!=REPO or m['tag']!=TAG:raise ValueError('Wrong manifest')
    assets=m['assets'];names={a['name'] for a in assets}
    if len(names)!=len(assets):raise ValueError('Duplicate names')
    for a in assets:
        if not re.fullmatch(r'[A-Za-z0-9._-]{1,150}',a['name']) or not re.fullmatch(r'[a-f0-9]{64}',a['sha256']) or not 0<a['bytes']<2_000_000_000 or not a['url'].startswith('https://'):raise ValueError('Invalid asset')
    marker='<!-- verified-publication source='+commit+' manifest='+mh+' -->'
    note=(ROOT/'docs/releases/v2.1.0.md').read_text(encoding='utf-8')+'\n\n'+marker+'\n'
    tmp=Path(tempfile.mkdtemp(prefix='furinakit-publish-'))
    release=find_release()
    if release:
        old=release.get('target_commitish')
        old_marker='<!-- verified-publication source='+str(old)+' manifest='+mh+' -->'
        if not release.get('draft') or old not in KNOWN_SOURCES|{commit} or old_marker not in release.get('body',''):raise RuntimeError('Existing public/unrelated release will not be modified')
    ref=api('repos/'+REPO+'/git/ref/tags/'+TAG,missing=True)
    if ref and ref.get('object',{}).get('sha')!=commit:raise RuntimeError('Tag already points elsewhere; no forced retagging')
    if not release:
        release=mutate('repos/'+REPO+'/releases','POST',{'tag_name':TAG,'target_commitish':commit,'name':'FurinaKit v2.1.0 · Tauri 原生版','body':note,'draft':True,'prerelease':False,'make_latest':'false'},tmp)
    rid=release['id'];print('OWNED_DRAFT_ID',rid,flush=True)
    existing={a['name']:a for a in release['assets']}
    if set(existing)-names:raise ValueError('Unexpected draft asset')
    for a in assets:
        if a['name'] in existing:
            v=existing[a['name']]
            if v['state']!='uploaded' or v['size']!=a['bytes'] or v.get('digest')!='sha256:'+a['sha256']:raise ValueError('Existing draft asset differs: '+a['name'])
    def transfer(a):
        p=tmp/a['name']
        if a['name'] in existing:
            with p.open('xb') as f:gh('api','repos/'+REPO+'/releases/assets/'+str(existing[a['name']]['id']),'-H','Accept: application/octet-stream','--allow-escape-sequences',output=f)
        elif a['name'] in ['ffmpeg.exe','ffprobe.exe'] and (tmp/'FurinaKit-v2.1.0-windows-x64.zip').exists():
            with zipfile.ZipFile(tmp/'FurinaKit-v2.1.0-windows-x64.zip') as z,z.open('FurinaKit/tools/engines/ffmpeg/'+a['name']) as source,p.open('xb') as target:shutil.copyfileobj(source,target,1024*1024)
            print('REUSED_VERIFIED_PORTABLE_ENGINE',a['name'],flush=True)
        else:
            parts=tmp/(a['name']+'.parts');parts.mkdir();block=4*1024*1024;offsets=list(range(0,a['bytes'],block))
            def segment(start):
                end=min(a['bytes']-1,start+block-1);part=parts/str(start);headers=parts/(str(start)+'.headers')
                url=a['url']+('&' if '?' in a['url'] else '?')+'verifiedPart='+str(start)+'&digest='+a['sha256'][:16]
                r=subprocess.run(['curl','--http1.1','--fail','--location','--silent','--show-error','--proto','=https','--proto-redir','=https','--retry','5','--retry-all-errors','--retry-max-time','240','--connect-timeout','15','--max-time','120','--range',str(start)+'-'+str(end),'--max-filesize',str(end-start+1),'--dump-header',str(headers),'--output',str(part),url],capture_output=True,text=True)
                if r.returncode:raise RuntimeError('Asset chunk failed: '+a['name']+' offset '+str(start)+': '+r.stderr[-800:])
                ranges=re.findall(r'(?im)^content-range:\s*bytes (\d+)-(\d+)/(\d+)',headers.read_text(errors='replace'))
                if part.stat().st_size!=end-start+1 or not ranges or tuple(map(int,ranges[-1]))!=(start,end,a['bytes']):raise ValueError('Invalid byte-range response')
            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:list(pool.map(segment,offsets))
            with p.open('xb') as target:
                for offset in offsets:
                    with (parts/str(offset)).open('rb') as source:shutil.copyfileobj(source,target,1024*1024)
        if p.stat().st_size!=a['bytes'] or digest(p)!=a['sha256']:raise ValueError('Asset hash/size mismatch: '+a['name'])
        print('VERIFIED',a['name'],flush=True)
        if a['name'] not in existing:
            url='https://uploads.github.com/repos/'+REPO+'/releases/'+str(rid)+'/assets?name='+a['name']
            uploaded=json.loads(gh('api','--method','POST',url,'-H','Content-Type: application/octet-stream','--input',str(p)).stdout)
            if uploaded['size']!=a['bytes']:raise ValueError('Upload size differs')
            print('UPLOADED_TO_OWNED_DRAFT',a['name'],flush=True)
    # Small files first, then portable-before-engines so engines do not cross the slow bridge twice.
    order=['MODEL-DOWNLOADS.json','SHA256SUMS.txt','FurinaKit.Setup.2.1.0.exe','FurinaKit-v2.1.0-windows-x64.zip','FurinaKit.BuildResources.2.1.0.zip','ffmpeg.exe','ffprobe.exe']
    for name in order:transfer(next(a for a in assets if a['name']==name))
    models=json.loads((tmp/'MODEL-DOWNLOADS.json').read_text())
    if models['status']!='completed' or models['files']!=16 or models['optionalModelsBundled'] is not False:raise ValueError('Model QA incomplete')
    unpack=tmp/'portable';unpack.mkdir()
    with zipfile.ZipFile(tmp/'FurinaKit-v2.1.0-windows-x64.zip') as z:
        entries=z.infolist()
        if len(entries)>1000 or sum(i.file_size for i in entries)>500_000_000 or len({i.filename for i in entries})!=len(entries):raise ValueError('Unexpected portable inventory')
        for i in entries:
            p=PurePosixPath(i.filename)
            if p.is_absolute() or '..' in p.parts or '\\' in i.filename or ':' in i.filename or not i.filename.startswith('FurinaKit/') or ((i.external_attr>>16)&0o170000)==0o120000:raise ValueError('Unsafe ZIP path')
        inventory=json.loads(z.read('FurinaKit/FurinaKit-files.json'));expected={'FurinaKit/'+f['path']:f for f in inventory['files']}
        if {i.filename for i in entries if not i.is_dir()}!=set(expected)|{'FurinaKit/FurinaKit-files.json'}:raise ValueError('ZIP set differs')
        for name,f in expected.items():
            with z.open(name) as stream:h=hashlib.file_digest(stream,'sha256').hexdigest()
            if h!=f['sha256'] or z.getinfo(name).file_size!=f['bytes']:raise ValueError('ZIP member integrity failed')
        z.extractall(unpack)
    subprocess.run([sys.executable,'scripts/fetch_build_resources.py','--archive',str(tmp/'FurinaKit.BuildResources.2.1.0.zip')],cwd=ROOT,check=True)
    subprocess.run([sys.executable,'scripts/assemble_desktop.py','--exe',str(unpack/'FurinaKit/FurinaKit.exe'),'--output','release-work/ci-assembly/FurinaKit'],cwd=ROOT,check=True)
    for f in inventory['files']:
        if f['path'] not in ['FurinaKit-runtime.json','README.txt'] and digest(ROOT/'release-work/ci-assembly/FurinaKit'/f['path'])!=f['sha256']:raise ValueError('Fresh source assembly differs')
    for attempt in range(12):
        current=api('repos/'+REPO+'/releases/'+str(rid));uploaded={a['name']:a for a in current['assets']}
        if set(uploaded)==names and all(uploaded[a['name']]['state']=='uploaded' and uploaded[a['name']]['size']==a['bytes'] and uploaded[a['name']].get('digest')=='sha256:'+a['sha256'] for a in assets):break
        if attempt==11:raise ValueError('GitHub asset digests not confirmed')
        time.sleep(5)
    release=mutate('repos/'+REPO+'/releases/'+str(rid),'PATCH',{'target_commitish':commit,'body':note,'draft':False,'make_latest':'true'},tmp)
    if release['draft']:raise RuntimeError('Public release not confirmed')
    print('PUBLIC_RELEASE',release['html_url'],flush=True)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'],'a',encoding='utf-8') as f:f.write('## Verified public release\n\n'+release['html_url']+'\n\nSource: `'+commit+'`\n')
if __name__=='__main__':
    try:main()
    except Exception as e:
        print('::error title=Release verification failed::'+str(e).replace('%','%25').replace('\r','%0D').replace('\n','%0A'),flush=True)
        raise
