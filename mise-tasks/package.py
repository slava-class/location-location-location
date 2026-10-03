#!/usr/bin/env python3
"""Build a deterministic release ZIP and compare every member with its source."""
from pathlib import Path
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parent.parent

def main():
    metadata = json.loads((ROOT / 'info.json').read_text())
    name, version = metadata['name'], metadata['version']
    if name != 'location-location-location' or version != '1.0.0':
        raise RuntimeError('Unexpected release identity')
    prefix = f'{name}_{version}'
    files = [ROOT / path for path in ['info.json', 'control.lua', 'data.lua', 'changelog.txt', 'license.txt', 'thumbnail.png']]
    for folder in ['location_location_location', 'locale', 'tests']:
        files.extend(path for path in (ROOT / folder).rglob('*') if path.is_file())
    for path in files:
        if path.is_symlink() or path.suffix not in ['.json', '.lua', '.txt', '.png', '.cfg']:
            raise RuntimeError(f'Unexpected release member: {path}')
    files.sort(key=lambda path: path.relative_to(ROOT).as_posix())
    output = ROOT / f'{prefix}.zip'
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
        if json.loads(archive.read(prefix + '/info.json')) != metadata:
            raise RuntimeError('Packaged metadata differs')
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    (ROOT / (output.name + '.sha256')).write_text(f'{digest}  {output.name}\n')
    cache = ROOT / '.factorio-test'
    cache.mkdir(exist_ok=True)
    (cache / 'package-manifest.json').write_text(json.dumps({'archive': output.name, 'sha256': digest, 'files': {path.relative_to(ROOT).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest() for path in files}}, indent=2) + '\n')
    print(f'{output.name}: {len(files)} members; all bytes match source; SHA256 {digest}')

if __name__ == '__main__':
    main()
