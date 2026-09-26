import {test, expect, afterEach} from 'bun:test';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const roots = [];
const checkpoint = join(import.meta.dir, 'checkpoint.mjs');
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, {recursive: true, force: true}); });

async function fixture(verify = 'git diff --check HEAD') {
  const root = await mkdtemp(join(tmpdir(), 'map-tag-vac-test-'));
  roots.push(root);
  const cwd = join(root, 'work');
  await mkdir(cwd);
  const env = {...process.env, MISE_TRUSTED_CONFIG_PATHS: root};
  delete env.GIT_INDEX_FILE;
  async function run(args, extraEnv = {}) {
    const child = Bun.spawn(args, {cwd, env: {...env, ...extraEnv}, stdout: 'pipe', stderr: 'pipe'});
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    return {stdout: stdout.trim(), stderr, code};
  }
  async function git(...args) {
    const result = await run(['git', ...args]);
    if (result.code !== 0) throw new Error(result.stderr);
    return result.stdout;
  }
  await git('init', '-q', '--initial-branch=main');
  await git('config', 'user.name', 'Checkpoint Test');
  await git('config', 'user.email', 'checkpoint@example.invalid');
  await git('config', 'commit.gpgsign', 'false');
  await git('config', 'core.hooksPath', join(root, 'no-hooks'));
  await writeFile(join(cwd, '.mise.toml'), `[tasks.verify]\nrun = ${JSON.stringify(verify)}\n`);
  await writeFile(join(cwd, 'content.txt'), 'initial\n');
  await git('add', '-A');
  await git('commit', '-qm', 'initial');
  return {root, cwd, run, git,
    vac: message => run(['bun', checkpoint], {usage_message: message}),
    change: text => writeFile(join(cwd, 'content.txt'), text),
  };
}

test('vac commits the verified tree and pushes to a local remote with a literal message', async () => {
  const f = await fixture();
  const remote = join(f.root, 'remote.git');
  await f.git('init', '--bare', '-q', remote);
  await f.git('remote', 'add', 'origin', remote);
  await f.change('verified change\n');
  const message = 'Keep "quotes", $variables, and ; punctuation literal';
  const result = await f.vac(message);
  expect(result.code, result.stderr).toBe(0);
  expect(await f.git('log', '-1', '--format=%s')).toBe(message);
  expect(await f.git('show', 'HEAD:content.txt')).toBe('verified change');
  expect(await f.git('--git-dir', remote, 'rev-parse', 'refs/heads/main')).toBe(await f.git('rev-parse', 'HEAD'));
});

test('failed verification preserves HEAD and the original staging', async () => {
  const f = await fixture('false');
  await f.change('staged\n');
  await f.git('add', 'content.txt');
  const head = await f.git('rev-parse', 'HEAD');
  const index = await f.git('write-tree');
  await f.change('unstaged\n');
  expect((await f.vac('Must not commit')).code).not.toBe(0);
  expect(await f.git('rev-parse', 'HEAD')).toBe(head);
  expect(await f.git('write-tree')).toBe(index);
});

test('untracked whitespace errors fail before staging or committing', async () => {
  const f = await fixture();
  const head = await f.git('rev-parse', 'HEAD');
  await writeFile(join(f.cwd, 'new.txt'), 'trailing whitespace  \n');
  expect((await f.vac('Must not commit whitespace')).code).not.toBe(0);
  expect(await f.git('rev-parse', 'HEAD')).toBe(head);
  expect(await f.git('diff', '--cached', '--name-only')).toBe('');
});

test('files changed by verification are not committed', async () => {
  const f = await fixture('bun drift.mjs');
  await writeFile(join(f.cwd, 'drift.mjs'), "await Bun.write('content.txt', 'changed during verification\\n');\n");
  const head = await f.git('rev-parse', 'HEAD');
  expect((await f.vac('Must not commit drift')).code).not.toBe(0);
  expect(await f.git('rev-parse', 'HEAD')).toBe(head);
  expect(await f.git('diff', '--cached', '--name-only')).toBe('');
});

test('push failure retains a successful local checkpoint', async () => {
  const f = await fixture();
  await f.change('local checkpoint\n');
  const result = await f.vac('Local checkpoint');
  expect(result.code, result.stderr).toBe(0);
  expect(await f.git('show', 'HEAD:content.txt')).toBe('local checkpoint');
  expect(result.stdout).toContain('WARNING: push failed');
});

test('blank messages and unchanged trees do not create commits', async () => {
  const f = await fixture();
  const head = await f.git('rev-parse', 'HEAD');
  expect((await f.vac('   ')).code).not.toBe(0);
  expect((await f.vac('Nothing changed')).code).toBe(0);
  expect(await f.git('rev-parse', 'HEAD')).toBe(head);
});
