import {copyFile, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, unlink, writeFile} from 'node:fs/promises';
import {createReadStream, constants} from 'node:fs';
import {createHash, randomUUID} from 'node:crypto';
import {basename, dirname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {homedir} from 'node:os';
import {parseArgs, isDeepStrictEqual} from 'node:util';
import {spawnSync} from 'node:child_process';

const tool = import.meta.path;
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const namePattern = /^[A-Za-z0-9_-]+$/;
const usage = 'local-mod.mjs status <mod> | load <zip> --save <save.zip> | unload <mod> --save <save.zip> | restore <receipt.json> [--profile <write-data-directory>] [--dry-run]';

function modName(name) {
  if (typeof name !== 'string' || !namePattern.test(name) || ['base', 'core'].includes(name)) throw new Error('Expected a non-core Factorio mod ID');
  return name;
}
function version(value) {
  if (typeof value !== 'string' || !versionPattern.test(value) || value.split('.').some(n => Number(n) > 65535)) throw new Error(`Invalid mod version: ${value}`);
  return value;
}
function inside(root, path) {
  const suffix = relative(root, path);
  return suffix !== '' && suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix);
}
async function exists(path) {
  try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
function command(program, args, maxBuffer = 16 * 1024 * 1024) {
  const result = spawnSync(program, args, {encoding: 'utf8', maxBuffer});
  if (result.error || result.status !== 0) throw new Error(`${program} failed: ${result.error?.message || result.stderr || result.stdout}`);
  return result.stdout;
}
async function archiveInfo(path) {
  const members = command('unzip', ['-Z1', path]).trimEnd().split('\n');
  const manifests = members.filter(name => /^[^/]+\/info\.json$/.test(name));
  if (manifests.length !== 1) throw new Error('Archive must contain exactly one top-level mod/info.json');
  const info = JSON.parse(command('unzip', ['-p', path, manifests[0]], 1024 * 1024));
  modName(info.name); version(info.version);
  const prefix = `${info.name}_${info.version}/`;
  if (new Set(members).size !== members.length || members.some(name => !name.startsWith(prefix) || name.includes('\\') || name.split('/').includes('..'))) throw new Error('Unsafe, duplicated, or incorrectly rooted ZIP members');
  command('unzip', ['-tq', path]);
  return {name: info.name, version: info.version, factorio_version: info.factorio_version, dependencies: info.dependencies || ['base'], file: `${info.name}_${info.version}.zip`, sha256: await sha256(path)};
}
async function profilePath(value) {
  if (!value && process.platform !== 'darwin') throw new Error('Specify --profile on non-macOS hosts');
  const profile = await realpath(value || join(homedir(), 'Library/Application Support/factorio'));
  if (await realpath(join(profile, 'mods')) !== join(profile, 'mods')) throw new Error('Symlinked mods directories require an explicitly managed real profile');
  return profile;
}
async function assertClosed(profile) {
  const lock = join(profile, '.lock');
  if (!await exists(lock)) return;
  const result = spawnSync('lsof', ['-t', '--', lock], {encoding: 'utf8'});
  if (result.error || result.stderr || ![0, 1].includes(result.status)) throw new Error(`Cannot establish profile lock ownership: ${result.error?.message || result.stderr || result.status}`);
  if (result.stdout.trim()) throw new Error(`Factorio profile is in use (PIDs ${result.stdout.trim().split('\n').join(', ')}). Save and quit before changing mods.`);
}
async function modList(profile, name) {
  const path = join(profile, 'mods', 'mod-list.json');
  const bytes = await readFile(path, 'utf8');
  const value = JSON.parse(bytes);
  if (!Array.isArray(value.mods)) throw new Error('Invalid mod-list.json: missing mods array');
  const matches = value.mods.filter(mod => mod.name === name);
  if (matches.length > 1) throw new Error(`Duplicate mod-list entries for ${name}`);
  return {path, bytes, value, entry: matches[0] || null};
}
function fileVersion(name, file) {
  if (!file.startsWith(`${name}_`) || !file.endsWith('.zip')) return null;
  const candidate = file.slice(name.length + 1, -4);
  return versionPattern.test(candidate) ? candidate : null;
}
async function inventory(profile, name) {
  const files = [];
  for (const entry of await readdir(join(profile, 'mods'), {withFileTypes: true})) {
    const candidate = fileVersion(name, entry.name);
    const folder = entry.name === name || (entry.name.startsWith(`${name}_`) && versionPattern.test(entry.name.slice(name.length + 1)));
    if (folder || (candidate && !entry.isFile())) throw new Error(`Unpacked or symlinked target mod: ${entry.name}; refusing to move a potential source checkout`);
    if (candidate) files.push({file: entry.name, version: candidate, sha256: await sha256(join(profile, 'mods', entry.name))});
  }
  return files.sort((a, b) => a.file.localeCompare(b.file));
}
async function state(profile, name) {
  const list = await modList(profile, name);
  return {list, snapshot: {entry: list.entry, files: await inventory(profile, name)}};
}
async function savePath(profile, value) {
  if (!value) throw new Error('Mutations require --save with the exact current save filename or path');
  const path = await realpath(isAbsolute(value) ? value : join(profile, 'saves', value));
  if (!inside(join(profile, 'saves'), path) || !path.endsWith('.zip') || !(await lstat(path)).isFile()) throw new Error('Choose a ZIP save inside this profile’s saves directory');
  return path;
}
async function verifiedCopy(source, destination, expected) {
  await copyFile(source, destination, constants.COPYFILE_EXCL);
  if (await sha256(destination) !== expected) throw new Error(`Backup or staged file checksum mismatch: ${destination}`);
}
async function atomicText(path, text) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, text, {flag: 'wx'});
  try { await rename(temporary, path); } finally { if (await exists(temporary)) await unlink(temporary); }
}
function updatedList(list, name, entry) {
  const value = structuredClone(list.value);
  const index = value.mods.findIndex(mod => mod.name === name);
  if (entry === null) value.mods = value.mods.filter(mod => mod.name !== name);
  else if (index < 0) value.mods.push(entry);
  else value.mods[index] = entry;
  return isDeepStrictEqual(list.entry, entry) ? list.bytes : `${JSON.stringify(value, null, 2)}\n`;
}
async function protectedFiles(profile, save) {
  const files = [save, join(profile, 'mods', 'mod-settings.dat')];
  const result = {};
  for (const path of files) result[path] = await exists(path) ? await sha256(path) : null;
  return result;
}
async function assertProtected(files) {
  for (const [path, expected] of Object.entries(files)) {
    const actual = await exists(path) ? await sha256(path) : null;
    if (actual !== expected) throw new Error(`Save/settings changed during the operation: ${path}`);
  }
}
async function transition(profile, name, before, after, sources, directory) {
  const stage = join(directory, 'stage'), removed = join(directory, 'removed');
  await mkdir(stage); await mkdir(removed);
  const replaceFiles = !isDeepStrictEqual(before.snapshot.files, after.files);
  if (replaceFiles) for (const file of after.files) await verifiedCopy(sources.get(file.file), join(stage, file.file), file.sha256);
  const nextText = updatedList(before.list, name, after.entry);
  await assertClosed(profile);
  const current = await state(profile, name);
  if (current.list.bytes !== before.list.bytes || !isDeepStrictEqual(current.snapshot, before.snapshot)) throw new Error('Mod profile changed during preparation; nothing was activated');
  const moved = [], installed = [];
  try {
    if (replaceFiles) {
      for (const file of before.snapshot.files) {
        await rename(join(profile, 'mods', file.file), join(removed, file.file));
        moved.push(file);
      }
      for (const file of after.files) {
        await rename(join(stage, file.file), join(profile, 'mods', file.file));
        installed.push(file);
      }
    }
    if (nextText !== before.list.bytes) await atomicText(before.list.path, nextText);
    if (!isDeepStrictEqual((await state(profile, name)).snapshot, after)) throw new Error('Installed mod state failed readback');
  } catch (error) {
    // Undo this operation only; never overwrite a concurrent edit while rolling back.
    for (const file of installed) {
      const path = join(profile, 'mods', file.file);
      if (await sha256(path) !== file.sha256) throw new Error(`Concurrent archive change; recover from ${directory}`);
      await unlink(path);
    }
    for (const file of moved) {
      const path = join(profile, 'mods', file.file);
      if (await exists(path)) throw new Error(`Concurrent archive replacement; recover from ${directory}`);
      await rename(join(removed, file.file), path);
    }
    const text = await readFile(before.list.path, 'utf8');
    if (text === nextText && text !== before.list.bytes) await atomicText(before.list.path, before.list.bytes);
    else if (text !== before.list.bytes) throw new Error(`Concurrent mod-list edit; recover from ${directory}`);
    throw error;
  }
}
async function locked(profile, fn) {
  const root = join(profile, 'mod-backups', 'local-mods');
  await mkdir(root, {recursive: true});
  const path = join(root, '.operation.lock');
  const handle = await open(path, 'wx').catch(error => {
    if (error.code === 'EEXIST') throw new Error(`Another operation or interrupted run owns ${path}; inspect its recorded PID before removing a stale lock`);
    throw error;
  });
  try { await handle.writeFile(`${process.pid}\n`); return await fn(root); }
  finally { await handle.close(); await unlink(path); }
}
async function mutate(action, target, options) {
  const incoming = action === 'load' ? await archiveInfo(await realpath(target)) : null;
  const name = incoming?.name || modName(target);
  const profile = await profilePath(options.profile);
  const save = await savePath(profile, options.save);
  await assertClosed(profile);
  const run = async root => {
    const before = await state(profile, name);
    if (action === 'unload' && !before.list.entry && !before.snapshot.files.length) throw new Error(`Mod is not installed: ${name}`);
    if (action === 'load' && before.list.entry?.version && before.list.entry.version !== incoming.version) throw new Error('An explicit version field is present in mod-list.json; resolve it deliberately before loading a different version');
    const entry = {...(before.list.entry || {name}), enabled: action === 'load'};
    const after = {entry, files: incoming ? [{file: incoming.file, version: incoming.version, sha256: incoming.sha256}] : before.snapshot.files};
    const summary = {action, profile, save, mod: name, incoming, before: before.snapshot, after};
    if (isDeepStrictEqual(before.snapshot, after)) return {...summary, outcome: 'unchanged'};
    if (options['dry-run']) return {...summary, outcome: 'preview'};
    const directory = await mkdtemp(join(root, `${new Date().toISOString().replaceAll(':', '-')}-${action}-${name}-`));
    const backup = join(directory, 'before');
    await mkdir(join(backup, 'mods'), {recursive: true});
    await mkdir(join(backup, 'saves'));
    const protectedState = await protectedFiles(profile, save);
    const saveBackup = join(backup, 'saves', basename(save));
    await verifiedCopy(save, saveBackup, protectedState[save]);
    await writeFile(join(backup, 'mod-list.json'), before.list.bytes, {flag: 'wx'});
    for (const file of before.snapshot.files) await verifiedCopy(join(profile, 'mods', file.file), join(backup, 'mods', file.file), file.sha256);
    const receiptPath = join(directory, 'receipt.json');
    const receipt = {format: 1, state: 'prepared', ...summary, save: {path: save, backup: saveBackup, sha256: protectedState[save]}, protected: protectedState, restore_argv: ['bun', tool, 'restore', receiptPath]};
    await atomicText(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    try {
      await assertProtected(protectedState);
      const sources = new Map(incoming ? [[incoming.file, await realpath(target)]] : []);
      await transition(profile, name, before, after, sources, directory);
      receipt.state = 'applied';
      await atomicText(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
      await assertProtected(protectedState);
    } catch (error) {
      const observed = (await state(profile, name)).snapshot;
      receipt.state = isDeepStrictEqual(observed, after) ? 'applied' : isDeepStrictEqual(observed, before.snapshot) ? 'rolled-back' : 'interrupted';
      receipt.error = error.message;
      await atomicText(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
      throw new Error(`${error.message}; receipt: ${receiptPath}`);
    }
    return {...summary, outcome: 'applied', receipt: receiptPath, save_backup: saveBackup, preserved_save_sha256: protectedState[save], restore_argv: receipt.restore_argv, note: 'Restart Factorio and load with the installed mods. No save, settings, or unrelated mod was changed.'};
  };
  return options['dry-run'] ? run() : locked(profile, run);
}
async function restore(target, options) {
  const receiptPath = await realpath(target);
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  if (receipt.format !== 1 || receipt.state !== 'applied') throw new Error('Restore requires an applied format-1 receipt');
  const name = modName(receipt.mod), profile = await profilePath(receipt.profile);
  if (options.profile && await profilePath(options.profile) !== profile) throw new Error('Receipt belongs to a different profile');
  const directory = dirname(receiptPath);
  if (!inside(join(profile, 'mod-backups', 'local-mods'), directory) || basename(receiptPath) !== 'receipt.json') throw new Error('Receipt is outside its declared profile backup directory');
  for (const file of [...receipt.before.files, ...receipt.after.files]) {
    if (!fileVersion(name, file.file) || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('Invalid receipt archive identity');
  }
  await assertClosed(profile);
  const run = async () => {
    const current = await state(profile, name);
    if (!isDeepStrictEqual(current.snapshot, receipt.after)) throw new Error('This mod changed after the recorded operation; refusing to overwrite newer files or settings');
    const sources = new Map();
    for (const file of receipt.before.files) {
      const source = join(directory, 'before', 'mods', file.file);
      if (await sha256(source) !== file.sha256) throw new Error(`Backup checksum mismatch: ${source}`);
      sources.set(file.file, source);
    }
    const summary = {action: 'restore', mod: name, profile, before: current.snapshot, after: receipt.before, save_backup: receipt.save.backup, note: 'Only mod files and this mod-list entry are restored. For an older mod version, use the pre-change save backup; no save migration is reversed.'};
    if (options['dry-run']) return {...summary, outcome: 'preview'};
    const undo = await mkdtemp(join(directory, 'restore-'));
    const protectedState = await protectedFiles(profile, await savePath(profile, receipt.save.path));
    await transition(profile, name, current, receipt.before, sources, undo);
    receipt.state = 'restored';
    receipt.restored_at = new Date().toISOString();
    await atomicText(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    await assertProtected(protectedState);
    return {...summary, outcome: 'restored', receipt: receiptPath};
  };
  return options['dry-run'] ? run() : locked(profile, run);
}
async function main() {
  const {values, positionals} = parseArgs({args: process.argv.slice(2), allowPositionals: true, options: {profile: {type: 'string'}, save: {type: 'string'}, 'dry-run': {type: 'boolean', default: false}}});
  const [action, target] = positionals;
  if (positionals.length !== 2 || !['status', 'load', 'unload', 'restore'].includes(action)) throw new Error(usage);
  if (action === 'restore') return restore(target, values);
  if (action === 'load' || action === 'unload') return mutate(action, target, values);
  const name = modName(target), profile = await profilePath(values.profile);
  return {action, profile, mod: name, ...(await state(profile, name)).snapshot};
}
if (import.meta.main) main().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
