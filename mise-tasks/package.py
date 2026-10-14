#!/usr/bin/env python3
"""Build and byte-verify a deterministic ZIP, following the LLL release pattern."""
from pathlib import Path
import hashlib
import json
import re
import zipfile

ROOT = Path(__file__).resolve().parent.parent

def main():
    metadata = json.loads((ROOT / 'info.json').read_text())
    name, version = metadata['name'], metadata['version']
    if name != 'py-research-dossier' or not re.fullmatch(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)', version) or any(int(part) > 65535 for part in version.split('.')):
        raise RuntimeError('Unexpected mod ID or invalid Factorio version')
    prefix = f'{name}_{version}'
    files = [ROOT / path for path in ['info.json', 'data.lua', 'data-final-fixes.lua', 'control.lua', 'changelog.txt', 'license.txt']]
    for folder in ['dossier', 'locale']:
        files.extend(path for path in (ROOT / folder).rglob('*') if path.is_file())
    for path in files:
        if path.is_symlink() or not path.resolve().is_relative_to(ROOT) or path.suffix not in ['.json', '.lua', '.txt', '.cfg']:
            raise RuntimeError(f'Unexpected release member: {path}')
    files.sort(key=lambda path: path.relative_to(ROOT).as_posix())
    output = ROOT / 'dist' / f'{prefix}.zip'
    output.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in files:
            member = zipfile.ZipInfo(prefix + '/' + path.relative_to(ROOT).as_posix(), (1980, 1, 1, 0, 0, 0))
            member.compress_type = zipfile.ZIP_DEFLATED
            member.external_attr = 0o100644 << 16
            archive.writestr(member, path.read_bytes(), compresslevel=9)
    with zipfile.ZipFile(output) as archive:
        if archive.testzip() is not None or len(archive.namelist()) != len(files):
            raise RuntimeError('ZIP integrity check failed')
        for path in files:
            if archive.read(prefix + '/' + path.relative_to(ROOT).as_posix()) != path.read_bytes():
                raise RuntimeError(f'Packaged bytes differ: {path}')
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_suffix('.zip.sha256').write_text(f'{digest}  {output.name}\n')
    cache = ROOT / '.factorio-test'
    cache.mkdir(exist_ok=True)
    (cache / 'package-manifest.json').write_text(json.dumps({'archive': str(output.relative_to(ROOT)), 'sha256': digest, 'files': {path.relative_to(ROOT).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest() for path in files}}, indent=2) + '\n')
    print(f'{output.relative_to(ROOT)}: {len(files)} members; all bytes match source; SHA256 {digest}')

if __name__ == '__main__':
    main()
