#!/usr/bin/env python3
"""Prepare project-local, checksum-pinned Lua tools (macOS/Linux)."""
import hashlib
import os
import platform
from pathlib import Path
import shutil
import subprocess
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / '.factorio-test' / 'tools'
SOURCES = {
    'luacheck-1.2.0': ('https://codeload.github.com/lunarmodules/luacheck/tar.gz/refs/tags/v1.2.0', '8efe62a7da4fdb32c0c22ec1f7c9306cbc397d7d40493c29988221a059636e25'),
    'argparse-0.7.1': ('https://codeload.github.com/luarocks/argparse/tar.gz/refs/tags/0.7.1', 'd344e49404c3e7b3e7fa4fe6741c106f25909d9b24923cb08dcceda1f9754809'),
    'luafilesystem-1_8_0': ('https://codeload.github.com/lunarmodules/luafilesystem/tar.gz/refs/tags/v1_8_0', '16d17c788b8093f2047325343f5e9b74cccb1ea96001e45914a58bbae8932495'),
}
EMMY = {
    ('Darwin', 'arm64'): ('darwin-arm64', 'eeaad59d173cb8d7cb0fe778936d7b584fe114a3eb46587ef3e4aec24b605af4'),
    ('Darwin', 'x86_64'): ('darwin-x64', 'e91fe82c361d8dece8e2ce9aeb2313b8809b4714f72bbbeab5a27e754d8de2c6'),
    ('Linux', 'aarch64'): ('linux-aarch64-glibc2.17', '62a9a56d3ff5d0e108909332cb91582a0c1a4ebbfdce1a4422e7ae74d4a7f8b1'),
    ('Linux', 'x86_64'): ('linux-x64-glibc2.17', 'e4a700af4921e2d908e2f7299eaa86e3e1b3b265e27225ab33c7eb03ebc2187d'),
}

def archive(name, url, digest):
    path = CACHE / (name + '.tar.gz')
    if not path.exists():
        temporary = path.with_suffix('.download')
        with urllib.request.urlopen(url) as response, temporary.open('wb') as output:
            shutil.copyfileobj(response, output)
        temporary.replace(path)
    if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
        raise RuntimeError(f'Checksum mismatch: {path.name}; remove it and retry')
    return path

def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    for name, (url, digest) in SOURCES.items():
        source = archive(name, url, digest)
        if not (CACHE / name).exists():
            with tarfile.open(source) as package:
                for member in package.getmembers():
                    target = (CACHE / member.name).resolve()
                    if not target.is_relative_to(CACHE.resolve()) or member.issym() or member.islnk():
                        raise RuntimeError(f'Unsafe archive member: {member.name}')
                package.extractall(CACHE)
    lua = Path(shutil.which('lua') or '')
    if not lua.is_file():
        raise RuntimeError('Run through mise: Lua 5.2.4 must be on PATH')
    version = subprocess.check_output([str(lua), '-v'], stderr=subprocess.STDOUT, text=True)
    if not version.startswith('Lua 5.2.4'):
        raise RuntimeError(f'Expected Lua 5.2.4, got {version.strip()}')
    include = lua.resolve().parent.parent / 'include'
    if not (CACHE / 'lfs.so').exists():
        flags = ['-bundle', '-undefined', 'dynamic_lookup'] if platform.system() == 'Darwin' else ['-shared', '-fPIC']
        subprocess.run([os.environ.get('CC', 'cc'), '-O2', *flags, '-I' + str(include), str(CACHE / 'luafilesystem-1_8_0/src/lfs.c'), '-o', str(CACHE / 'lfs.so')], check=True)
    target, digest = EMMY[(platform.system(), platform.machine())]
    source = archive('emmylua_check-' + target, f'https://github.com/EmmyLuaLs/emmylua-analyzer-rust/releases/download/0.25.1/emmylua_check-{target}.tar.gz', digest)
    if not (CACHE / 'emmylua_check').exists():
        with tarfile.open(source) as package:
            member = next(m for m in package.getmembers() if m.name.lstrip('./') == 'emmylua_check' and m.isfile())
            with package.extractfile(member) as input_file, (CACHE / 'emmylua_check').open('wb') as output:
                shutil.copyfileobj(input_file, output)
        (CACHE / 'emmylua_check').chmod(0o755)
    print('Pinned Lua tools ready (Luacheck 1.2.0; EmmyLua Check 0.25.1).')

if __name__ == '__main__':
    main()
