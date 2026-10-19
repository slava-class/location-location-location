import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import type { Server } from "node:net";
import { dockerCacheSuffix, dockerSettings } from "./backend.ts";
import { dockerConnection } from "./docker.ts";
import { runFiles } from "./fixtures/release.ts";
import { BoundaryError, resolveWorkspace } from "./projects.ts";
import { withProcess } from "./process.ts";
import { newRun } from "./runs.ts";
import { readRun } from "./run-status.ts";

const roots: string[] = [];
const sockets: Server[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0))
    await new Promise<void>((resolve, reject) =>
      socket.close((error) => (error ? reject(error) : resolve())),
    );
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

// A local executable models daemon protocol faults, not Linux/Factorio compatibility.
// Actual Docker execution is exercised separately through the public CLI.
async function fixture(
  mode: "foreign-owner" | "create-unknown" | "remove-unknown" | "success",
) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "modkit-docker-")));
  roots.push(root);
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  const workspace = await runFiles(resolveWorkspace(root));
  const run = await runFiles(newRun(workspace, "container-protocol"));
  const engineRoot = join(root, dockerCacheSuffix, "factorio");
  const bunDirectory = join(root, dockerCacheSuffix, "bun-linux-aarch64");
  for (const directory of [
    engineRoot,
    bunDirectory,
    join(root, "node_modules"),
  ])
    await mkdir(directory, { recursive: true });
  const bun = join(bunDirectory, "bun"),
    client = join(root, "docker-fixture"),
    socket = join(root, "s");
  await writeFile(bun, "protocol fixture, not an executable runtime");
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socket, resolve);
  });
  sockets.push(server);
  const history = join(root, "calls.txt"),
    state = join(root, "daemon-state.json");
  await writeFile(
    client,
    `#!${process.execPath}
import {appendFile,readFile,writeFile,rm} from 'node:fs/promises';
const mode=${JSON.stringify(mode)}, state=${JSON.stringify(state)}, history=${JSON.stringify(history)};
const args=process.argv.slice(2);
if(args[0]!=='--host') throw new Error('Missing explicit local endpoint');
const command=args[2];
await appendFile(history,command+'\\n');
if(command==='create') {
  await writeFile(state,JSON.stringify({Id:'1'.repeat(64),Name:'/modkit-${run.runId}',Config:{Labels:{'dev.modkit.run':mode==='foreign-owner'?'unrelated-run':'${run.runId}'}},State:{Status:'created',Running:false,OOMKilled:false,ExitCode:0,Error:'',StartedAt:'',FinishedAt:''}}));
  if(mode==='create-unknown') process.exit(42);
  console.log('1'.repeat(64));
} else if(command==='container') {
  console.log('['+await readFile(state,'utf8')+']');
} else if(command==='start') {
  const value=JSON.parse(await readFile(state,'utf8'));
  value.State.Status='exited';
  await writeFile(state,JSON.stringify(value));
  console.log('engine-finished');
} else if(command==='rm') {
  await rm(state);
  if(mode==='remove-unknown') process.exit(42);
  console.log('1'.repeat(64));
} else throw new Error('Unexpected mutation: '+command);
`,
  );
  await chmod(client, 0o755);
  const request = {
    ...run,
    command: ["/opt/bun", "-e", "console.log('engine-finished')"],
    docker: {
      client,
      socket,
      ...dockerSettings,
      engineRoot,
      engineSha256: "0".repeat(64),
      bun,
      bunSha256: "0".repeat(64),
    },
  };
  const calls = async () =>
    (await readFile(history, "utf8")).trim().split("\n");
  return { workspace, request, calls };
}

test("Docker control rejects remote endpoints before resolving executable or socket", async () => {
  for (const endpoint of [
    "tcp://127.0.0.1:2375",
    "ssh://host",
    "npipe:////./pipe/docker_engine",
    "unix://remote/socket",
  ])
    expect(
      await runFiles(
        Effect.flip(dockerConnection("/missing-client", endpoint)),
      ),
    ).toBeInstanceOf(BoundaryError);
});

test("Unix socket resolution accepts a real socket and rejects files and leaf aliases", async () => {
  const f = await fixture("success");
  const { client, socket, bun } = f.request.docker;
  expect(
    (await runFiles(dockerConnection(client, "unix://" + socket))).socket,
  ).toBe(socket);
  const alias = join(f.request.directory, "socket-alias");
  await symlink(socket, alias);
  for (const path of [bun, alias])
    expect(
      await runFiles(Effect.flip(dockerConnection(client, "unix://" + path))),
    ).toBeInstanceOf(BoundaryError);
});

test("an ownership mismatch never authorizes stopping or removing that container", async () => {
  const f = await fixture("foreign-owner");
  expect(
    await runFiles(
      Effect.flip(withProcess(f.request, (owned) => owned.waitForExit)),
    ),
  ).toBeInstanceOf(BoundaryError);
  const calls = await f.calls();
  expect(calls.filter((command) => command === "create")).toHaveLength(1);
  expect(calls).not.toContain("stop");
  expect(calls).not.toContain("rm");
  const result = await runFiles(readRun(f.workspace, f.request.runId));
  expect(result.status).toBe("failed");
  expect(result.container?.cleanup).toBe("failed");
});

test("an unknown create outcome is inspected and cleaned by exact ownership, never created again", async () => {
  const f = await fixture("create-unknown");
  expect(
    await runFiles(
      Effect.flip(withProcess(f.request, (owned) => owned.waitForExit)),
    ),
  ).toBeInstanceOf(BoundaryError);
  const calls = await f.calls();
  expect(calls.filter((command) => command === "create")).toHaveLength(1);
  expect(calls.filter((command) => command === "rm")).toHaveLength(1);
  expect(calls).not.toContain("start");
  const result = await runFiles(readRun(f.workspace, f.request.runId));
  expect(result.status).toBe("failed");
  expect(result.container?.cleanup).toBe("removed");
  expect(result.container?.state?.Status).toBe("created");
});

test("ambiguous removal fails the run without retrying a mutation", async () => {
  const f = await fixture("remove-unknown");
  expect(
    await runFiles(
      Effect.flip(withProcess(f.request, (owned) => owned.waitForExit)),
    ),
  ).toBeInstanceOf(BoundaryError);
  expect((await f.calls()).filter((command) => command === "rm")).toHaveLength(
    1,
  );
  const result = await runFiles(readRun(f.workspace, f.request.runId));
  expect(result.status).toBe("failed");
  expect(result.container?.cleanup).toBe("failed");
  expect(result.log.closed).toBe(true);
});

test("a passed client cannot qualify missing, mismatched, OOM, running, or unremoved container evidence", async () => {
  const f = await fixture("success");
  await runFiles(withProcess(f.request, (owned) => owned.waitForExit));
  const result = await runFiles(readRun(f.workspace, f.request.runId));
  expect(result.status).toBe("passed");
  const original = result.container!;
  const path = join(f.request.directory, "container.json");
  for (const changed of [
    { ...original, cleanup: "pending" },
    { ...original, id: null },
    { ...original, runId: crypto.randomUUID() },
    { ...original, state: { ...original.state, OOMKilled: true } },
    { ...original, state: { ...original.state, ExitCode: 42 } },
    {
      ...original,
      state: { ...original.state, Status: "running", Running: true },
    },
  ]) {
    await writeFile(path, JSON.stringify(changed));
    expect(
      await runFiles(Effect.flip(readRun(f.workspace, f.request.runId))),
    ).toBeInstanceOf(BoundaryError);
  }
  await rm(path);
  expect(
    await runFiles(Effect.flip(readRun(f.workspace, f.request.runId))),
  ).toBeInstanceOf(BoundaryError);
});
