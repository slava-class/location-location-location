#!/usr/bin/env python3
"""Generate minimum-version Factorio types and explicit EmmyLua compatibility adapters."""
from pathlib import Path
import hashlib
import json
import re
import shutil
import subprocess
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / '.factorio-test/types'
VERSION = '2.1.20'
DOCS = {'runtime-api': '1ff275cc085347fafddc01b5ba53df10259319339e78cd6e5b4e0d067e1daeb6', 'prototype-api': '5d2aab6483f33d1582d2fdfd661b4b9f6ff6a1f97548311524d062ecc32f200b'}
FLIB_SHA = '0a48c15dc0fc6c13bb3fe8293ba6cb35a07f3b0f37d37acb50ab30e32e8e019d'

def main():
    docs = CACHE / 'api' / VERSION
    docs.mkdir(parents=True, exist_ok=True)
    for name, digest in DOCS.items():
        path = docs / (name + '.json')
        if not path.exists():
            with urllib.request.urlopen(f'https://lua-api.factorio.com/{VERSION}/{name}.json') as response, path.open('wb') as output:
                shutil.copyfileobj(response, output)
        if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise RuntimeError(f'API checksum mismatch: {name}; refusing changed definitions')
    archive = ROOT / '.factorio-test/mods/flib_0.17.2.zip'
    if not archive.exists():
        raise RuntimeError('Run mise run setup to prepare the pinned flib type source')
    if hashlib.sha256(archive.read_bytes()).hexdigest() != FLIB_SHA:
        raise RuntimeError('flib 0.17.2 archive checksum mismatch')
    subprocess.run(['bun', str(ROOT / 'node_modules/factoriomod-debug/dist/fmtk-cli.js'), 'docs', '--docs', str(docs / 'runtime-api.json'), '--protos', str(docs / 'prototype-api.json'), '--docbase', f'https://lua-api.factorio.com/{VERSION}', str(CACHE / ('factorio-' + VERSION))], check=True, cwd=ROOT, stdout=subprocess.DEVNULL)
    library = CACHE / ('factorio-' + VERSION) / 'factorio/library'
    # Missing dictionary keys return nil. FMTK's table<string,T> omits that fact.
    for relative in ['runtime-api/LuaBootstrap.lua', 'runtime-api/LuaPrototypes.lua', 'runtime-api/LuaGameScript.lua']:
        path = library / relative
        source = path.read_text()
        if 'Bootstrap' in relative:
            source = source.replace('table<string,string>', 'table<string,string?>')
        else:
            source = re.sub(r'table<([^,>]+),([^>]+)>', r'table<\1,\2?>', source)
        path.write_text(source)
    mods = library / 'data/mods.lua'
    mods.write_text(mods.read_text().replace('{[string]: string}', '{[string]: string?}'))
    storage = library / 'runtime/storage.lua'
    storage.write_text(storage.read_text().replace('---@type table', '---@type LLLStorage'))
    dependencies = CACHE / 'dependencies'
    with zipfile.ZipFile(archive) as package:
        for item in package.infolist():
            if item.is_dir() or not item.filename.endswith('.lua'):
                continue
            target = (dependencies / item.filename).resolve()
            if not target.is_relative_to(dependencies.resolve()):
                raise RuntimeError('Unsafe flib archive path')
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(package.read(item))
    gui = dependencies / 'flib_0.17.2/gui.lua'
    source = gui.read_text().replace('style_mods LuaStyle?', 'style_mods LLLStyleMods?')
    # LuaLS union inheritance is not supported by EmmyLua. Keep the complete native
    # field vocabulary/types while allowing flib's heterogeneous element definitions.
    source = re.sub(r'--- @class flib.GuiElemDef:.*', '--- @class flib.GuiElemDef', source)
    fields = {}
    active = False
    for line in (library / 'runtime-api/LuaGuiElement.lua').read_text().splitlines():
        if line.startswith('---@class'):
            active = 'LuaGuiElement.add_param.' in line
        if active and line.startswith('---@field '):
            match = re.match(r'---@field (\w+)\?? (.+)', line)
            if match:
                fields.setdefault(match[1], set()).add(match[2])
    definitions = '\n'.join('--- @field ' + name + (' ' if name == 'type' else '? ') + '|'.join('(' + item + ')' for item in sorted(types)) for name, types in fields.items())
    gui.write_text(source.replace('--- @class flib.GuiElemDef', '--- @class flib.GuiElemDef\n' + definitions))
    print('FMTK 2.1.9 types ready for Factorio 2.1.20; dictionary and flib adapters applied.')

if __name__ == '__main__':
    main()
