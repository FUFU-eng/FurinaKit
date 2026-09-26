"""Assemble a relocatable Windows desktop directory from verified base resources.

Python is a developer packaging tool only, never a runtime dependency.
Run after fetching resources and building the desktop executable:
  python scripts/assemble_desktop.py --output release-work/local-desktop/FurinaKit
Existing directories are never merged, emptied or replaced.
"""
from pathlib import Path, PurePosixPath
import argparse, hashlib, json, shutil, stat, struct

ROOT = Path(__file__).resolve().parents[1]

def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def relative_file(root, value):
    if not isinstance(value, str) or '\\' in value or ':' in value:
        raise ValueError('Unsafe relative file name')
    p = PurePosixPath(value)
    if p.is_absolute() or '..' in p.parts or not p.parts:
        raise ValueError('Unsafe relative file name')
    target = root.joinpath(*p.parts)
    if not target.resolve().is_relative_to(root.resolve()):
        raise ValueError('Resource escapes the project')
    return target

def regular_file(path):
    s = path.lstat()
    return stat.S_ISREG(s.st_mode) and not path.is_symlink() and not (getattr(s, 'st_file_attributes', 0) & 0x400)

def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

def assemble(executable, output, channel):
    layout = json.loads((ROOT/'scripts/runtime-layout.json').read_text(encoding='utf-8'))
    if layout['schema'] != 1 or layout['version'] != '2.1.0':
        raise ValueError('Unknown runtime layout')
    if not output.resolve().is_relative_to((ROOT/'release-work').resolve()):
        raise ValueError('Keep generated output inside the project release-work directory')
    if output.exists():
        raise FileExistsError('Output exists; choose a new directory instead of overwriting it')
    if not regular_file(executable):
        raise ValueError('Desktop executable is not a regular file')
    with executable.open('rb') as f:
        header = f.read(64)
        if header[:2] != b'MZ': raise ValueError('Not a Windows executable')
        f.seek(struct.unpack_from('<I', header, 0x3c)[0])
        signature = f.read(6)
        if signature[:4] != b'PE\0\0' or signature[4:] != b'\x64\x86':
            raise ValueError('The public desktop build must be Windows x64')
    sources = []
    destinations = set()
    optional = set(layout['excludedOptionalFiles'])
    for row in layout['files']:
        source = relative_file(ROOT, row['source'])
        target = relative_file(output, row['target'])
        if row['target'].lower() in destinations:
            raise ValueError('Duplicate runtime destination')
        destinations.add(row['target'].lower())
        if target.name.lower() in optional:
            raise ValueError('A Settings-downloadable file leaked into the base installer')
        if not regular_file(source) or source.stat().st_size != row['bytes'] or digest(source) != row['sha256']:
            raise ValueError('Missing/changed base resource: ' + row['source'] + '; run fetch_build_resources.py first')
        sources.append((source, target))
    # All sources pass before any output directory is created.
    output.mkdir(parents=True)
    for source, target in sources:
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    shutil.copy2(executable, output/'FurinaKit.exe')
    runtime = json.loads((ROOT/'scripts/runtime-template.json').read_text(encoding='utf-8'))
    runtime['packageChannel'] = channel
    runtime['releaseReady'] = channel == 'stable'
    write_json(output/'FurinaKit-runtime.json', runtime)
    (output/'README.txt').write_text(
        '\ufeffFurinaKit v2.1.0\n\n'
        '请保留完整目录运行 FurinaKit.exe；运行前先从托盘退出旧版本。\n'
        '音视频引擎与基础 OCR / 轻量超分资源已内置，设置中可下载的模型仍按需下载。\n'
        'ARCHPR 是第三方商业软件，无授权环境为 Trial，本包不含激活信息。\n'
        '下载与源码：https://github.com/FUFU-eng/FurinaKit\n', encoding='utf-8')
    inventory = []
    for file in sorted(output.rglob('*')):
        if file.is_file():
            inventory.append({'path':file.relative_to(output).as_posix(), 'bytes':file.stat().st_size, 'sha256':digest(file)})
    write_json(output/'FurinaKit-files.json', {'schemaVersion':1, 'version':layout['version'], 'files':inventory})
    return {'completed':True, 'output':str(output), 'files':len(inventory)+1, 'exeSha256':digest(output/'FurinaKit.exe'), 'optionalModelsBundled':False}

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--exe', type=Path, default=ROOT/'src-tauri/target/release/furinakit-desktop.exe')
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--channel', choices=['development','stable'], default='development')
    args = p.parse_args()
    output = args.output if args.output.is_absolute() else ROOT/args.output
    print(json.dumps(assemble(args.exe, output, args.channel), ensure_ascii=False, indent=2))

if __name__ == '__main__': main()
