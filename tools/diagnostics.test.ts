import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  mkdtemp,
  realpath,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectEngineDiagnostics } from "./engine-diagnostics.ts";
import { runFiles } from "./fixtures/release.ts";
import { TextRedactor, withProcess } from "./process.ts";
import { BoundaryError, resolveWorkspace } from "./projects.ts";
import { readRun } from "./run-status.ts";
import { newRun } from "./runs.ts";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "modkit-diagnostics-")),
  );
  roots.push(root);
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  const context = await runFiles(resolveWorkspace(root));
  const run = await runFiles(newRun(context, "failure-probe"));
  const paths = {
    current: join(run.directory, "factorio-current.log"),
    previous: join(run.directory, "factorio-previous.log"),
  };
  return { root, context, run, paths };
}
const runtime =
  " 1.000 Error Util.cpp:1: The mod Probe (1.0.0) caused a non-recoverable error.\nPlease report this error to the mod author.\n\nError while running event probe::on_tick (ID 0)\n__probe__/control.lua:3: deliberate runtime error\nstack traceback:\n\t[C]: in function 'error'\n";

test("multiline Lua failures are retained and redacted without being called native crashes", async () => {
  const f = await fixture();
  const secret = "sensitive-token-at-chunk-boundary";
  const input =
    runtime + "x".repeat(8190 - runtime.length) + secret + "\n 2.000 Goodbye\n";
  await writeFile(f.paths.current, input);
  const report = await runFiles(
    collectEngineDiagnostics(
      f.run.directory,
      f.paths,
      () => new TextRedactor([secret]),
    ),
  );
  const current = report.files[1]!;
  expect(current.state).toBe("read");
  if (current.state !== "read") throw new Error("Missing diagnostic file");
  expect(current.errors.map((error) => error.kind)).toEqual(["runtime-lua"]);
  expect(current.errors[0]?.text).toContain("stack traceback:");
  expect(current.errors[0]?.text).toContain("[REDACTED]");
  expect(JSON.stringify(report)).not.toContain(secret);
  expect(current.sha256).toBe(Bun.CryptoHasher.hash("sha256", input, "hex"));
  expect(current.tail).toEndWith(" 2.000 Goodbye\n");
  expect(report.files[0]).toEqual({ path: f.paths.previous, state: "missing" });
});

test("failure excerpts and long lines are bounded without losing the final diagnostic window", async () => {
  const f = await fixture();
  const input =
    Array.from(
      { length: 12 },
      (_, i) =>
        ` ${i}.000 Error ModManager.cpp:1: Failed to load mods: invalid prototype\n${"x".repeat(i === 0 ? 100000 : 20)}\n`,
    ).join("") + " 20.000 final shutdown record\n";
  await writeFile(f.paths.current, input);
  await writeFile(
    join(f.run.directory, "factorio-dump-current.dmp"),
    "owned diagnostic fixture",
  );
  await writeFile(join(f.root, "unrelated.dmp"), "outside this run");
  const report = await runFiles(
    collectEngineDiagnostics(
      f.run.directory,
      f.paths,
      () => new TextRedactor([]),
    ),
  );
  const current = report.files[1]!;
  if (current.state !== "read") throw new Error("Missing diagnostic file");
  expect(current.errors).toHaveLength(8);
  expect(current.omittedErrors).toBe(4);
  expect(current.errors[0]?.truncated).toBe(true);
  expect(current.errors[0]?.text.length).toBe(16384);
  expect(current.errors.every((error) => error.kind === "mod-load")).toBe(true);
  expect(current.tail).toEndWith(" 20.000 final shutdown record\n");
  expect(current.sha256).toBe(Bun.CryptoHasher.hash("sha256", input, "hex"));
  expect(report.artifacts).toEqual([
    { path: join(f.run.directory, "factorio-dump-current.dmp"), bytes: 24 },
  ]);
});

test("diagnostic inputs reject aliases and oversized files instead of inspecting unrelated data", async () => {
  const f = await fixture();
  const foreign = join(f.root, "foreign.log");
  await writeFile(foreign, runtime);
  await symlink(foreign, f.paths.current);
  expect(
    await runFiles(
      Effect.flip(
        collectEngineDiagnostics(
          f.run.directory,
          f.paths,
          () => new TextRedactor([]),
        ),
      ),
    ),
  ).toBeInstanceOf(BoundaryError);
  await rm(f.paths.current);
  await writeFile(f.paths.current, "");
  await truncate(f.paths.current, 32 * 1024 * 1024 + 1);
  expect(
    await runFiles(
      Effect.flip(
        collectEngineDiagnostics(
          f.run.directory,
          f.paths,
          () => new TextRedactor([]),
        ),
      ),
    ),
  ).toBeInstanceOf(BoundaryError);
});

test("qualified run readback separates Lua failure, launch failure and suspected native crash markers", async () => {
  for (const [text, expected] of [
    [runtime, "runtime-lua"],
    [
      " 1.000 Error CrashHandler.cpp:1: Unexpected crash\n",
      "suspected-native-crash",
    ],
  ] as const) {
    const f = await fixture();
    const command = [
      process.execPath,
      "-e",
      `require('node:fs').writeFileSync(${JSON.stringify(f.paths.current)},${JSON.stringify(text)});process.exit(1);`,
    ];
    await runFiles(
      Effect.flip(
        withProcess(
          { ...f.run, command, gameLog: f.paths },
          (owned) => owned.waitForExit,
        ),
      ),
    );
    const report = await runFiles(readRun(f.context, f.run.runId));
    expect(report.status).toBe("failed");
    expect(report.diagnostics.kinds).toEqual([expected]);
    expect(report.process?.engineDiagnostics?.files[1]?.state).toBe("read");
  }
  const f = await fixture();
  await runFiles(
    Effect.flip(
      withProcess(
        { ...f.run, command: [join(f.root, "missing-executable")] },
        (owned) => owned.waitForExit,
      ),
    ),
  );
  expect(
    (await runFiles(readRun(f.context, f.run.runId))).diagnostics.kinds,
  ).toEqual(["launch"]);
});

test("quiet and noisy children both hit the overall deadline even when shutdown exits zero", async () => {
  for (const noisy of [false, true]) {
    const f = await fixture();
    const program = `process.stdin.resume();process.on('SIGTERM',()=>process.exit(0));console.log('ready');${noisy ? "setInterval(()=>console.log('still alive'),10);" : ""}`;
    await runFiles(
      Effect.flip(
        withProcess(
          {
            ...f.run,
            command: [process.execPath, "-e", program],
            deadlineMs: 1000,
          },
          (owned) =>
            Effect.gen(function* () {
              yield* owned.waitForText(/ready/, "ready", 2000);
              yield* owned.phase("waiting-for-completion");
              return yield* owned.waitForExit;
            }),
        ),
      ),
    );
    const report = await runFiles(readRun(f.context, f.run.runId));
    expect(report.status).toBe("failed");
    expect(report.process?.exit?.code).toBe(0);
    expect(report.process?.deadline).toEqual({
      phase: "waiting-for-completion",
      limitMs: 1000,
    });
    expect(report.diagnostics.kinds).toContain("timeout");
  }
});
