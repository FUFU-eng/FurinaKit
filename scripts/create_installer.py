"""Compile a verified, already assembled desktop directory with NSIS 3.

Example (Windows):
  python scripts/create_installer.py --payload release-work/local-desktop/FurinaKit
Supply --makensis and --webview-bootstrapper if not available in the existing Tauri tool cache.
The bootstrapper must be obtained from Microsoft's official WebView2 distribution.
No installer is executed, no user application is stopped, and no existing output is overwritten.
"""
from pathlib import Path
import argparse, hashlib, json, os, shutil, subprocess

ROOT = Path(__file__).resolve().parents[1]

def digest(file):
    with file.open('rb') as f: return hashlib.file_digest(f, 'sha256').hexdigest()

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--payload', type=Path, required=True)
    p.add_argument('--output', type=Path, default=Path('release-work/local-installer/FurinaKit.Setup.2.1.0.exe'))
    p.add_argument('--makensis', type=Path)
    p.add_argument('--webview-bootstrapper', type=Path)
    a = p.parse_args()
    payload = (ROOT/a.payload).resolve(); output = (ROOT/a.output).resolve()
    if not payload.is_relative_to(ROOT/'release-work') or not output.is_relative_to(ROOT/'release-work'):
        raise SystemExit('Use an owned release-work directory for payload and output')
    if output.exists(): raise SystemExit('Output already exists; choose a new filename')
    inventory = json.loads((payload/'FurinaKit-files.json').read_text(encoding='utf-8'))
    expected = {v['path']:v for v in inventory['files']}
    actual = {f.relative_to(payload).as_posix():f for f in payload.rglob('*') if f.is_file()}
    if set(actual) != set(expected)|{'FurinaKit-files.json'}: raise SystemExit('Payload inventory differs')
    for rel,v in expected.items():
        f = actual[rel]
        if f.is_symlink() or not f.resolve().is_relative_to(payload) or f.stat().st_size != v['bytes'] or digest(f) != v['sha256']:
            raise SystemExit('Payload failed integrity: '+rel)
    local = Path(os.environ.get('LOCALAPPDATA',''))/'tauri'
    compiler = a.makensis or Path(shutil.which('makensis.exe') or local/'NSIS/makensis.exe')
    bootstrap = a.webview_bootstrapper or local/'MicrosoftEdgeWebview2Setup.exe'
    if not compiler.is_file(): raise SystemExit('Install/provide the NSIS 3 compiler with --makensis')
    if not bootstrap.is_file(): raise SystemExit('Provide the official Microsoft WebView2 bootstrapper with --webview-bootstrapper')
    output.parent.mkdir(parents=True, exist_ok=True)
    definitions = {'PROJECT_ROOT':str(ROOT),'PAYLOAD_DIR':str(payload),'OUTPUT_FILE':str(output),'WEBVIEW_BOOTSTRAPPER':str(bootstrap),'INSTALLED_SIZE_KB':str((sum(f.stat().st_size for f in actual.values())+1023)//1024)}
    args = [str(compiler),'/V2'] + ['/D'+key+'='+value.replace('$','$$') for key,value in definitions.items()] + [str(ROOT/'packaging/FurinaKit.nsi')]
    result = subprocess.run(args,cwd=ROOT,text=True,encoding='utf-8',errors='replace',capture_output=True)
    output.with_suffix('.nsis.log').write_text(result.stdout+'\n'+result.stderr,encoding='utf-8')
    if result.returncode: raise SystemExit('NSIS failed; see '+str(output.with_suffix('.nsis.log')))
    print(json.dumps({'installer':str(output),'bytes':output.stat().st_size,'sha256':digest(output)},indent=2))

if __name__ == '__main__': main()
