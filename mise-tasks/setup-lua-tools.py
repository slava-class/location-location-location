#!/usr/bin/env python3
"""LLL's pinned, project-local Lua lint setup, without runtime/engine tooling."""
import hashlib
import os
import platform
from pathlib import Path
import shutil
import subprocess
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / '.factorio-test/tools'
SOURCES = {
    'luacheck-1.2.0': ('https://codeload.github.com/lunarmodules/luacheck/tar.gz/refs/tags/v1.2.0', '8efe62a7da4fdb32c0c22ec1f7c9306cbc397d7d40493c29988221a059636e25'),
    'argparse-0.7.1': ('https://codeload.github.com/luarocks/argparse/tar.gz/refs/tags/0.7.1', 'd344e49404c3e7b3e7fa4fe6741c106f25909d9b24923cb08dcceda1f9754809'),
    'luafilesystem-1_8_0': ('https://codeload.github.com/lunarmodules/luafilesystem/tar.gz/refs/tags/v1_8_0', '16d17c788b8093f2047325343f5e9b74cccb1ea96001e45914a58bbae8932495'),
}

def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    for name, (url, digest) in SOURCES.items():
        archive = CACHE / (name + '.tar.gz')
        if not archive.exists():
            temporary = archive.with_suffix('.download')
            with urllib.request.urlopen(url) as response, temporary.open('wb') as output:
                shutil.copyfileobj(response, output)
            temporary.replace(archive)
        if hashlib.sha256(archive.read_bytes()).hexdigest() != digest:
            raise RuntimeError(f'Checksum mismatch: {archive.name}')
        if not (CACHE / name).exists():
            with tarfile.open(archive) as package:
                package.extractall(CACHE, filter='data')
    lua = Path(shutil.which('lua') or '')
    if not lua.is_file():
        raise RuntimeError('Run through mise with Lua 5.2.4 on PATH')
    version = subprocess.check_output([str(lua), '-v'], stderr=subprocess.STDOUT, text=True)
    if not version.startswith('Lua 5.2.4'):
        raise RuntimeError(f'Expected Lua 5.2.4, got {version.strip()}')
    if not (CACHE / 'lfs.so').exists():
        include = lua.resolve().parent.parent / 'include'
        flags = ['-bundle', '-undefined', 'dynamic_lookup'] if platform.system() == 'Darwin' else ['-shared', '-fPIC']
        subprocess.run([os.environ.get('CC', 'cc'), '-O2', *flags, '-I' + str(include), str(CACHE / 'luafilesystem-1_8_0/src/lfs.c'), '-o', str(CACHE / 'lfs.so')], check=True)
    print('Pinned Luacheck 1.2.0 ready; no Factorio executable used.')

if __name__ == '__main__':
    main()
