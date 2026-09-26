"""Fetch the version-pinned base resources. Windows installer models remain optional.

Run with Python 3.11 or newer: python scripts/fetch_build_resources.py
Use --archive PATH for an already downloaded, hash-identical ZIP.
"""
from pathlib import Path, PurePosixPath
import argparse,hashlib,json,os,shutil,stat,urllib.request,zipfile
ROOT=Path(__file__).resolve().parents[1]

def digest(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f,'sha256').hexdigest()

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive',type=Path,help='Use a local archive; size and SHA-256 are still verified')
    args=parser.parse_args()
    manifest=json.loads((ROOT/'scripts/build-resources.json').read_text(encoding='utf-8'))
    cache=ROOT/'release-work/cache';cache.mkdir(parents=True,exist_ok=True)
    archive=args.archive or cache/('FurinaKit.BuildResources.'+manifest['version']+'.zip')
    if args.archive:
        if not archive.is_file():raise SystemExit('Specified archive does not exist.')
    elif not archive.is_file() or archive.stat().st_size!=manifest['bytes'] or digest(archive)!=manifest['sha256']:
        errors=[]
        for url in [manifest['url'],*manifest.get('mirrors',[])]:
            part=archive.with_suffix('.download')
            try:
                print('Downloading:',url,flush=True)
                request=urllib.request.Request(url,headers={'User-Agent':'FurinaKit-build-resources/2.1.0'})
                with urllib.request.urlopen(request,timeout=90) as r,part.open('wb') as f:
                    shutil.copyfileobj(r,f,1024*1024)
                if part.stat().st_size!=manifest['bytes'] or digest(part)!=manifest['sha256']:
                    raise ValueError('Downloaded archive size or SHA-256 mismatch')
                part.replace(archive);break
            except Exception as e:
                errors.append(str(e));part.unlink(missing_ok=True)
        else:raise SystemExit('All resource sources failed: '+'; '.join(errors))
    if archive.stat().st_size!=manifest['bytes'] or digest(archive)!=manifest['sha256']:
        raise SystemExit('Archive integrity verification failed; nothing was extracted.')
    expected={record['path']:record for record in manifest['files']}
    with zipfile.ZipFile(archive) as z:
        actual={item.filename for item in z.infolist() if not item.is_dir()}
        if actual!=set(expected):raise SystemExit('Archive file inventory differs from the pinned manifest.')
        # Validate every destination and every member before writing any files.
        for item in z.infolist():
            path=PurePosixPath(item.filename)
            if item.is_dir():continue
            target=(ROOT/Path(*path.parts)).resolve()
            if path.is_absolute() or '..' in path.parts or not target.is_relative_to(ROOT.resolve()) or stat.S_ISLNK(item.external_attr>>16):
                raise SystemExit('Unsafe archive path: '+item.filename)
            record=expected[item.filename]
            if item.file_size!=record['bytes']:
                raise SystemExit('Member size mismatch: '+item.filename)
            with z.open(item) as f:
                if hashlib.file_digest(f,'sha256').hexdigest()!=record['sha256']:
                    raise SystemExit('Member hash mismatch: '+item.filename)
            if target.exists() and digest(target)!=record['sha256']:
                raise SystemExit('Existing resource differs; back it up and remove it before retrying: '+str(target))
        for name in sorted(expected):
            target=ROOT/Path(*PurePosixPath(name).parts)
            if not target.exists():
                target.parent.mkdir(parents=True,exist_ok=True)
                with z.open(name) as src,target.open('xb') as dest:shutil.copyfileobj(src,dest,1024*1024)
    print('Verified and prepared',len(expected),'base resource files. No optional component was installed.')

if __name__=='__main__':main()
