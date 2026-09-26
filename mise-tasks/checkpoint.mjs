import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const message = process.env.usage_message?.trim();
if (!message) throw new Error('Supply a descriptive commit message: mise run vac -- "message"');

async function run(args, {capture = false, env = {}, allowFailure = false} = {}) {
  const process = Bun.spawn(args, {
    env: {...globalThis.process.env, ...env},
    stdin: 'ignore', stdout: capture ? 'pipe' : 'inherit', stderr: 'inherit',
  });
  const output = capture ? await new Response(process.stdout).text() : '';
  const code = await process.exited;
  if (code !== 0 && !allowFailure) throw new Error(`${args[0]} ${args[1]} failed (${code}); checkpoint stopped.`);
  return {code, output: output.trim()};
}
const git = async (...args) => (await run(['git', ...args], {capture: true})).output;
const head = await git('rev-parse', 'HEAD');
const temp = await mkdtemp(join(tmpdir(), 'map-tag-checkpoint-'));
const indexEnv = {GIT_INDEX_FILE: join(temp, 'index')};
try {
  // A private index fingerprints tracked and untracked changes without disturbing staging.
  await run(['git', 'read-tree', head], {env: indexEnv});
  const snapshot = async () => {
    await run(['git', 'add', '-A'], {env: indexEnv});
    return (await run(['git', 'write-tree'], {env: indexEnv, capture: true})).output;
  };
  const verifiedTree = await snapshot();
  await run(['mise', 'run', 'verify'], {env: indexEnv});
  if (await git('rev-parse', 'HEAD') !== head || await snapshot() !== verifiedTree) {
    throw new Error('Files or HEAD changed during verification. Nothing committed; rerun vac on the new state.');
  }
  if (verifiedTree === await git('rev-parse', 'HEAD^{tree}')) {
    console.log('Verification passed; no working-tree changes to commit. Existing staging was left untouched.');
  } else {
    await run(['git', 'add', '-A']);
    if (await git('write-tree') !== verifiedTree) throw new Error('Files changed while staging; nothing committed.');
    await run(['git', 'commit', '-m', message]);
    const commit = await git('rev-parse', 'HEAD');
    console.log(`Checkpoint: ${commit}`);
    if (await git('rev-parse', 'HEAD^{tree}') !== verifiedTree) {
      throw new Error('A commit hook changed the verified tree. Checkpoint exists locally but will not be pushed.');
    }
    const branch = await git('branch', '--show-current');
    if (!branch) {
      console.log('Detached HEAD: checkpoint retained locally; push skipped.');
    } else {
      const pushed = await run(['git', 'push', '--set-upstream', 'origin', branch], {
        allowFailure: true,
        env: {GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '/usr/bin/false', SSH_ASKPASS: '/usr/bin/false',
          GIT_SSH_COMMAND: 'ssh -o BatchMode=yes'},
      });
      console.log(pushed.code === 0 ? `Pushed origin/${branch}.`
        : 'WARNING: push failed. The verified checkpoint exists locally; remote synchronization is still pending.');
    }
  }
} finally {
  await rm(temp, {recursive: true, force: true});
}
