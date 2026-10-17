import {afterEach, expect, test} from 'bun:test';
import {copyFile, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, dirname, join} from 'node:path';
import {createHash} from 'node:crypto';

const roots = [];
const tool = join(import.meta.dir, 'local-mod.mjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, {recursive: true, force: true}); });

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'factorio-local-mod-')));
  roots.push(root);
  const profile = join(root, 'profile with spaces');
  const builds = join(root, 'builds');
  await mkdir(join(profile, 'mods'), {recursive: true});
  await mkdir(join(profile, 'saves'));
  await mkdir(builds);
  const save = join(profile, 'saves', 'current run.zip');
  const settings = join(profile, 'mods', 'mod-settings.dat');
  const listPath = join(profile, 'mods', 'mod-list.json');
  await writeFile(save, 'durable save fixture');
  await writeFile(settings, Buffer.from([0, 1, 9, 42, 255]));
  await writeFile(listPath, JSON.stringify({mods: [{name: 'example', enabled: true}, {name: 'unrelated', enabled: false, custom: 'keep'}], custom: {keep: true}}));
  await writeFile(join(profile, 'mods', 'unrelated_5.0.0.zip'), 'unrelated archive fixture');
  async function run(args, cwd = root) {
    const child = Bun.spawn(args, {cwd, stdout: 'pipe', stderr: 'pipe'});
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return {stdout, stderr, code};
  }
  async function archive(version, metadata = {}) {
    const folder = `example_${version}`;
    await mkdir(join(builds, folder));
    await writeFile(join(builds, folder, 'info.json'), JSON.stringify({name: 'example', version, factorio_version: '2.1', ...metadata}));
    await writeFile(join(builds, folder, 'control.lua'), `-- fixture ${version}\n`);
    const path = join(builds, `${folder}.zip`);
    const result = await run(['zip', '-qr', path, folder], builds);
    expect(result.code, result.stderr).toBe(0);
    return path;
  }
  async function cli(...args) {
    const result = await run(['bun', tool, ...args, '--profile', profile]);
    return {...result, data: result.code === 0 ? JSON.parse(result.stdout) : null};
  }
  async function load(path, ...args) { return cli('load', path, '--save', basename(save), ...args); }
  async function install(version) {
    const path = await archive(version);
    await copyFile(path, join(profile, 'mods', basename(path)));
    return path;
  }
  return {root, profile, save, settings, listPath, archive, cli, load, install,
    list: async () => JSON.parse(await readFile(listPath, 'utf8')),
    files: async () => (await readdir(join(profile, 'mods'))).sort(),
  };
}

test('load replaces all target versions, preserves saves/settings, and restores only the target after unrelated changes', async () => {
  const f = await fixture();
  const oldest = await f.install('0.9.0');
  const old = await f.install('1.0.0');
  const incoming = await f.archive('1.1.0');
  const before = await readFile(f.listPath, 'utf8');
  const result = await f.load(incoming);
  expect(result.code, result.stderr).toBe(0);
  expect(result.data.after.files.map(file => file.version)).toEqual(['1.1.0']);
  expect(await f.files()).toEqual(['example_1.1.0.zip', 'mod-list.json', 'mod-settings.dat', 'unrelated_5.0.0.zip']);
  expect(hash(await readFile(join(f.profile, 'mods', 'example_1.1.0.zip')))).toBe(hash(await readFile(incoming)));
  expect(await readFile(f.listPath, 'utf8')).toBe(before);
  expect(await readFile(result.data.save_backup, 'utf8')).toBe('durable save fixture');
  expect(await readFile(f.save, 'utf8')).toBe('durable save fixture');
  expect([...await readFile(f.settings)]).toEqual([0, 1, 9, 42, 255]);
  const changed = await f.list();
  changed.mods[1].enabled = true;
  changed.mods.push({name: 'later-mod', enabled: true});
  await writeFile(f.listPath, JSON.stringify(changed));
  const restored = await f.cli('restore', result.data.receipt);
  expect(restored.code, restored.stderr).toBe(0);
  expect(restored.data.after.files.map(file => file.version)).toEqual(['0.9.0', '1.0.0']);
  for (const source of [oldest, old]) expect(hash(await readFile(join(f.profile, 'mods', basename(source))))).toBe(hash(await readFile(source)));
  expect((await f.list()).mods).toEqual(changed.mods);
  expect(await readFile(join(f.profile, 'mods', 'unrelated_5.0.0.zip'), 'utf8')).toBe('unrelated archive fixture');
  expect(await readFile(f.save, 'utf8')).toBe('durable save fixture');
});

test('unload disables only the requested mod and retains its archive for exact restoration', async () => {
  const f = await fixture();
  const archive = await f.install('1.0.0');
  const originalHash = hash(await readFile(archive));
  const result = await f.cli('unload', 'example', '--save', f.save);
  expect(result.code, result.stderr).toBe(0);
  expect((await f.list()).mods).toEqual([{name: 'example', enabled: false}, {name: 'unrelated', enabled: false, custom: 'keep'}]);
  expect(hash(await readFile(join(f.profile, 'mods', basename(archive))))).toBe(originalHash);
  expect((await f.cli('restore', result.data.receipt)).code).toBe(0);
  expect((await f.list()).mods[0].enabled).toBe(true);
  expect(await readFile(f.save, 'utf8')).toBe('durable save fixture');
});

test('an already installed identical build is a no-op and preview writes nothing to the profile', async () => {
  const f = await fixture();
  const old = await f.install('1.0.0');
  const next = await f.archive('1.1.0');
  const directories = await readdir(f.profile);
  const files = await f.files();
  const preview = await f.load(next, '--dry-run');
  expect(preview.code, preview.stderr).toBe(0);
  expect(preview.data.outcome).toBe('preview');
  expect(await readdir(f.profile)).toEqual(directories);
  expect(await f.files()).toEqual(files);
  const repeated = await f.load(old);
  expect(repeated.code, repeated.stderr).toBe(0);
  expect(repeated.data.outcome).toBe('unchanged');
  expect(await f.files()).toEqual(files);
});

test('a live profile lock refuses activation without changing the active files', async () => {
  const f = await fixture();
  await f.install('1.0.0');
  const incoming = await f.archive('1.1.0');
  const lock = await open(join(f.profile, '.lock'), 'wx');
  const files = await f.files();
  try {
    const result = await f.load(incoming);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('profile is in use');
    expect(await f.files()).toEqual(files);
  } finally { await lock.close(); }
});

test('restore refuses a target archive changed after deployment', async () => {
  const f = await fixture();
  await f.install('1.0.0');
  const incoming = await f.archive('1.1.0');
  const deployed = await f.load(incoming);
  expect(deployed.code, deployed.stderr).toBe(0);
  const installed = join(f.profile, 'mods', 'example_1.1.0.zip');
  await writeFile(installed, 'a later custom edit');
  const result = await f.cli('restore', deployed.data.receipt);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain('changed after the recorded operation');
  expect(await readFile(installed, 'utf8')).toBe('a later custom edit');
  expect((await f.list()).mods[0].enabled).toBe(true);
});

test('restore refuses a damaged backup without replacing the active build', async () => {
  const f = await fixture();
  await f.install('1.0.0');
  const incoming = await f.archive('1.1.0');
  const deployed = await f.load(incoming);
  expect(deployed.code, deployed.stderr).toBe(0);
  await writeFile(join(dirname(deployed.data.receipt), 'before', 'mods', 'example_1.0.0.zip'), 'damaged backup');
  const result = await f.cli('restore', deployed.data.receipt);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain('Backup checksum mismatch');
  expect(hash(await readFile(join(f.profile, 'mods', 'example_1.1.0.zip')))).toBe(hash(await readFile(incoming)));
});

test('malformed archive identity and saves outside the selected profile fail before mutation', async () => {
  const f = await fixture();
  const malformed = await f.archive('1.0.0', {name: null});
  const result = await f.load(malformed);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain('mod ID');
  const mismatched = await f.archive('1.0.1', {name: 'different'});
  expect((await f.load(mismatched)).stderr).toContain('incorrectly rooted');
  const valid = await f.archive('1.1.0');
  const outside = join(f.root, 'outside.zip');
  await writeFile(outside, 'not this profile');
  expect((await f.cli('load', valid, '--save', outside)).stderr).toContain('inside this profile');
  expect(await f.files()).toEqual(['mod-list.json', 'mod-settings.dat', 'unrelated_5.0.0.zip']);
});

test('restoring a newly added mod removes its entry without reverting other mod-list edits', async () => {
  const f = await fixture();
  const list = await f.list();
  list.mods = list.mods.filter(mod => mod.name !== 'example');
  await writeFile(f.listPath, JSON.stringify(list));
  const deployed = await f.load(await f.archive('1.1.0'));
  expect(deployed.code, deployed.stderr).toBe(0);
  expect((await f.list()).mods.find(mod => mod.name === 'example').enabled).toBe(true);
  const restored = await f.cli('restore', deployed.data.receipt);
  expect(restored.code, restored.stderr).toBe(0);
  expect(await f.list()).toEqual(list);
  expect(await f.files()).toEqual(['mod-list.json', 'mod-settings.dat', 'unrelated_5.0.0.zip']);
});
