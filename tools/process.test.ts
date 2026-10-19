import { afterEach, expect, test } from "bun:test";
import { BunServices } from "@effect/platform-bun";
import { Deferred, Effect, Fiber } from "effect";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { readLogPage } from "./logs.ts";
import { TextRedactor, withProcess } from "./process.ts";
import type { Request } from "./process.ts";
import { inheritedEnvironment } from "./runs.ts";
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function request(
  program: string,
  overrides: Partial<Request> = {},
): Promise<Request> {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "factorio-process-")),
  );
  directories.push(directory);
  return {
    runId: randomUUID(),
    modId: "boundary-probe",
    profile: "process-proof",
    repository: directory,
    directory,
    cwd: directory,
    command: [process.execPath, "-e", program],
    env: inheritedEnvironment(),
    redact: [],
    deadlineMs: 5000,
    shutdownMs: 500,
    ...overrides,
  };
}
const serve =
  "process.stdin.resume();process.on('SIGTERM',()=>process.stderr.write('shutdown-drain\\n',()=>process.exit(0)));console.log('ready');";
test("readiness and two durable readers work while the child is alive, with final stderr retained", async () => {
  const input = await request(serve);
  const result = await Effect.runPromise(
    withProcess(input, (owned) =>
      Effect.gen(function* () {
        yield* owned.waitForText(/ready/, "ready", 2000);
        const first = yield* readLogPage(owned.logs, {
          runId: input.runId,
          sequence: 0,
        });
        const second = yield* readLogPage(owned.logs, {
          runId: input.runId,
          sequence: 0,
        });
        expect(first.complete).toBe(false);
        expect(first.records.map((r) => r.text).join("")).toContain("ready");
        expect(second.records).toEqual(first.records);
        return yield* owned.stop;
      }),
    ).pipe(Effect.provide(BunServices.layer)),
  );
  expect(result.code).toBe(0);
  const final = await Effect.runPromise(
    readLogPage(join(input.directory, "logs"), {
      runId: input.runId,
      sequence: 0,
    }).pipe(Effect.provide(BunServices.layer)),
  );
  expect(final.complete).toBe(true);
  expect(final.records.map((r) => r.text).join("")).toContain("shutdown-drain");
  expect(
    JSON.parse(await readFile(join(input.directory, "process.json"), "utf8"))
      .status,
  ).toBe("passed");
});
test("a failed diagnostic seal cannot leave a passed process receipt", async () => {
  const input = await request("console.log('completed');");
  expect(
    Effect.runPromise(
      withProcess(input, (owned) =>
        Effect.gen(function* () {
          yield* owned.waitForExit;
          yield* Effect.promise(() =>
            mkdir(join(owned.logs, "log-final.json")),
          );
        }),
      ).pipe(Effect.provide(BunServices.layer)),
    ),
  ).rejects.toThrow();
  const receipt = JSON.parse(
    await readFile(join(input.directory, "process.json"), "utf8"),
  );
  expect(receipt.exit).toEqual({ code: 0, signal: null });
  expect(receipt.status).toBe("failed");
});
test("live game logs retain split UTF-8 and every byte across an engine-style rotation", async () => {
  const base = await request(`
    const fs = require("node:fs");
    const current = "factorio-current.log", previous = "factorio-previous.log";
    const first = Buffer.from("first α\\n");
    fs.writeFileSync(current, first.subarray(0, first.length - 2));
    for await (const chunk of Bun.stdin.stream()) {
      const command = new TextDecoder().decode(chunk).trim();
      if (command === "complete") fs.appendFileSync(current, first.subarray(first.length - 2));
      if (command === "rotate") {
        fs.renameSync(current, previous);
        fs.appendFileSync(previous, "late old\\n");
        fs.writeFileSync(current, "second β\\n");
      }
      if (command === "finish") {
        fs.appendFileSync(current, "last\\n");
        process.exit(0);
      }
    }
  `);
  const input = {
    ...base,
    gameLog: {
      current: join(base.directory, "factorio-current.log"),
      previous: join(base.directory, "factorio-previous.log"),
    },
  };
  await Effect.runPromise(
    withProcess(input, (owned) =>
      Effect.gen(function* () {
        yield* owned.waitForText(/first /, "first partial file chunk", 2000);
        yield* owned.send("complete\n");
        yield* owned.waitForText(/first α/, "completed UTF-8", 2000);
        yield* owned.send("rotate\n");
        yield* owned.waitForText(/second β/, "rotated file", 2000);
        yield* owned.send("finish\n");
        yield* owned.waitForExit;
      }),
    ).pipe(Effect.provide(BunServices.layer)),
  );
  const page = await Effect.runPromise(
    readLogPage(join(input.directory, "logs"), {
      runId: input.runId,
      sequence: 0,
    }).pipe(Effect.provide(BunServices.layer)),
  );
  expect(page.complete).toBe(true);
  expect(
    page.records
      .filter((record) => record.channel === "game")
      .map((record) => record.text)
      .join(""),
  ).toBe("first α\nlate old\nsecond β\nlast\n");
});
test("rotation immediately before exit retains the final generation", async () => {
  const base = await request(`
    const fs = require("node:fs");
    fs.writeFileSync("factorio-current.log", "ready-marker\\n");
    for await (const _ of Bun.stdin.stream()) {
      fs.renameSync("factorio-current.log", "factorio-previous.log");
      fs.appendFileSync("factorio-previous.log", "old end\\n");
      fs.writeFileSync("factorio-current.log", "new end\\n");
      process.exit(0);
    }
  `);
  const input = {
    ...base,
    gameLog: {
      current: join(base.directory, "factorio-current.log"),
      previous: join(base.directory, "factorio-previous.log"),
    },
  };
  await Effect.runPromise(
    withProcess(input, (owned) =>
      Effect.gen(function* () {
        yield* owned.waitForText(/ready-marker/, "initial game log", 2000);
        yield* owned.send("finish\n");
        yield* owned.waitForExit;
      }),
    ).pipe(Effect.provide(BunServices.layer)),
  );
  const page = await Effect.runPromise(
    readLogPage(join(input.directory, "logs"), {
      runId: input.runId,
      sequence: 0,
    }).pipe(Effect.provide(BunServices.layer)),
  );
  expect(page.complete).toBe(true);
  expect(
    page.records
      .filter((record) => record.channel === "game")
      .map((record) => record.text)
      .join(""),
  ).toBe("ready-marker\nold end\nnew end\n");
});
test("engine-file collection outlives the launcher until its owned descendant finishes", async () => {
  const descendant = `
    const fs = require("node:fs");
    process.on("SIGTERM", () => setTimeout(() => {
      fs.appendFileSync("factorio-current.log", "descendant shutdown complete\\n");
      process.exit(0);
    }, 150));
    setInterval(() => {}, 1000);
    console.log("descendant-ready");
  `;
  const base = await request(`
    require("node:fs").writeFileSync("factorio-current.log", "engine started\\n");
    const child = require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(descendant)}], { stdio: ["ignore", "pipe", "ignore"] });
    child.stdout.once("data", () => console.log("descendant-ready"));
    process.stdin.once("data", () => process.exit(0));
  `);
  const input = {
    ...base,
    gameLog: {
      current: join(base.directory, "factorio-current.log"),
      previous: join(base.directory, "factorio-previous.log"),
    },
  };
  await Effect.runPromise(
    withProcess(input, (owned) =>
      Effect.gen(function* () {
        yield* owned.waitForText(
          /descendant-ready/,
          "descendant startup",
          2000,
        );
        yield* owned.waitForText(/engine started/, "initial game log", 2000);
        yield* owned.send("finish\n");
        yield* owned.waitForExit;
      }),
    ).pipe(Effect.provide(BunServices.layer)),
  );
  const page = await Effect.runPromise(
    readLogPage(join(input.directory, "logs"), {
      runId: input.runId,
      sequence: 0,
    }).pipe(Effect.provide(BunServices.layer)),
  );
  expect(page.complete).toBe(true);
  expect(
    page.records
      .filter((record) => record.channel === "game")
      .map((record) => record.text)
      .join(""),
  ).toBe("engine started\ndescendant shutdown complete\n");
});
test("an in-place log rewrite preserves prior observations and exposes the complete replacement", async () => {
  const before = "initial-marker\n" + "old\n".repeat(100);
  const after = "replacement-marker\n" + "new\n".repeat(250);
  const base = await request(`
    const fs = require("node:fs");
    fs.writeFileSync("factorio-current.log", ${JSON.stringify(before)});
    for await (const chunk of Bun.stdin.stream()) {
      if (new TextDecoder().decode(chunk).trim() === "replace")
        fs.writeFileSync("factorio-current.log", ${JSON.stringify(after)});
      else process.exit(0);
    }
  `);
  const input = {
    ...base,
    gameLog: {
      current: join(base.directory, "factorio-current.log"),
      previous: join(base.directory, "factorio-previous.log"),
    },
  };
  await Effect.runPromise(
    withProcess(input, (owned) =>
      Effect.gen(function* () {
        yield* owned.waitForText(/initial-marker/, "first file revision", 2000);
        yield* owned.send("replace\n");
        yield* owned.waitForText(
          /replacement-marker/,
          "replacement file revision",
          2000,
        );
        yield* owned.send("finish\n");
        yield* owned.waitForExit;
      }),
    ).pipe(Effect.provide(BunServices.layer)),
  );
  const page = await Effect.runPromise(
    readLogPage(join(input.directory, "logs"), {
      runId: input.runId,
      sequence: 0,
    }).pipe(Effect.provide(BunServices.layer)),
  );
  const generations = new Map<string, string>();
  for (const record of page.records)
    if (record.channel === "game") {
      const identity = record.metadata.file!.identity;
      generations.set(
        identity,
        (generations.get(identity) ?? "") + record.text,
      );
    }
  expect([...generations.values()]).toEqual([before, after]);
  expect(page.complete).toBe(true);
});
test("a same-size middle edit cannot leave a falsely complete game log", async () => {
  const before = "head\n" + "x".repeat(30000) + "\nready-tail\n";
  const after = before.slice(0, 15000) + "changed" + before.slice(15007);
  const base = await request(`
    const fs = require("node:fs");
    fs.writeFileSync("factorio-current.log", ${JSON.stringify(before)});
    for await (const _ of Bun.stdin.stream()) {
      const fd = fs.openSync("factorio-current.log", "r+");
      fs.writeSync(fd, "changed", 15000);
      fs.closeSync(fd);
      process.exit(0);
    }
  `);
  const input = {
    ...base,
    gameLog: {
      current: join(base.directory, "factorio-current.log"),
      previous: join(base.directory, "factorio-previous.log"),
    },
  };
  await Effect.runPromise(
    withProcess(input, (owned) =>
      Effect.gen(function* () {
        yield* owned.waitForText(/ready-tail/, "complete initial log", 2000);
        yield* owned.send("edit\n");
        yield* owned.waitForExit;
      }),
    ).pipe(Effect.provide(BunServices.layer)),
  );
  const page = await Effect.runPromise(
    readLogPage(
      join(input.directory, "logs"),
      { runId: input.runId, sequence: 0 },
      64,
    ).pipe(Effect.provide(BunServices.layer)),
  );
  const generations = new Map<string, string>();
  for (const record of page.records)
    if (record.channel === "game") {
      const identity = record.metadata.file!.identity;
      generations.set(
        identity,
        (generations.get(identity) ?? "") + record.text,
      );
    }
  expect([...generations.values()]).toEqual([before, after]);
  expect(page.complete).toBe(true);
});
test("an empty final log and skipped rotations cannot qualify as complete diagnostics", async () => {
  for (const mode of ["truncate", "skip-rotation"]) {
    const base = await request(`
      const fs = require("node:fs");
      const current = "factorio-current.log", previous = "factorio-previous.log";
      fs.writeFileSync(current, "initial-marker\\n");
      for await (const _ of Bun.stdin.stream()) {
        if (${JSON.stringify(mode)} === "truncate") { fs.writeFileSync(current, ""); process.exit(0); }
        else {
          fs.renameSync(current, previous);
          fs.writeFileSync(current, "missed middle file\\n");
          fs.renameSync(current, previous);
          fs.writeFileSync(current, "last file\\n");
        }
      }
    `);
    const input = {
      ...base,
      gameLog: {
        current: join(base.directory, "factorio-current.log"),
        previous: join(base.directory, "factorio-previous.log"),
      },
    };
    await Effect.runPromise(
      withProcess(input, (owned) =>
        Effect.gen(function* () {
          yield* owned.waitForText(/initial-marker/, "initial game log", 2000);
          yield* owned.send("break\n");
          yield* owned.waitForExit;
        }),
      ).pipe(Effect.flip, Effect.provide(BunServices.layer)),
    );
    const receipt = JSON.parse(
      await readFile(join(input.directory, "process.json"), "utf8"),
    );
    expect(receipt.status).toBe("failed");
  }
});
test("exit zero without the required engine log is failed evidence", async () => {
  const base = await request("process.exit(0)");
  const input = {
    ...base,
    gameLog: {
      current: join(base.directory, "factorio-current.log"),
      previous: join(base.directory, "factorio-previous.log"),
    },
  };
  const error = await Effect.runPromise(
    withProcess(input, (owned) => owned.waitForExit).pipe(
      Effect.flip,
      Effect.provide(BunServices.layer),
    ),
  );
  expect(String(error)).toContain("diagnostic");
  const receipt = JSON.parse(
    await readFile(join(input.directory, "process.json"), "utf8"),
  );
  expect(receipt.status).toBe("failed");
  expect(receipt.exit).toEqual({ code: 0, signal: null });
  expect(receipt.error).toContain("Expected game log was never created");
});
test("successive stdin writes do not close transport or replay a command", async () => {
  const input = await request(
    "let n=0;console.log('ready');for await(const chunk of Bun.stdin.stream()){for(const line of new TextDecoder().decode(chunk).trim().split('\\n')){console.log(++n+':'+line);if(line==='finish')process.exit(0)}}",
  );
  await Effect.runPromise(
    withProcess(input, (owned) =>
      Effect.gen(function* () {
        yield* owned.waitForText(/ready/, "ready", 2000);
        yield* owned.send("one\n");
        yield* owned.waitForText(/1:one/, "first command", 2000);
        yield* owned.send("finish\n");
        yield* owned.waitForExit;
      }),
    ).pipe(Effect.provide(BunServices.layer)),
  );
  const page = await Effect.runPromise(
    readLogPage(join(input.directory, "logs"), {
      runId: input.runId,
      sequence: 0,
    }).pipe(Effect.provide(BunServices.layer)),
  );
  expect(page.records.map((r) => r.text).join("")).toContain("2:finish");
});
test("nonzero exit and a real deadline fail, preserving receipts and shutdown output", async () => {
  const failed = await request(
    "console.error('intentional failure');process.exit(7)",
  );
  expect(
    Effect.runPromise(
      withProcess(failed, (owned) => owned.waitForExit).pipe(
        Effect.provide(BunServices.layer),
      ),
    ),
  ).rejects.toThrow("exit=7");
  expect(
    JSON.parse(await readFile(join(failed.directory, "process.json"), "utf8"))
      .exit.code,
  ).toBe(7);
  const timeout = await request(serve);
  // A real OS child must acknowledge readiness before this deliberate platform-clock deadline.
  // Fake timers cannot establish whether SIGTERM output drains through the actual pipe.
  expect(
    Effect.runPromise(
      withProcess(timeout, (owned) =>
        Effect.gen(function* () {
          yield* owned.waitForText(/ready/, "ready", 2000);
          return yield* owned.waitForText(/never-finished/, "completion", 20);
        }),
      ).pipe(Effect.provide(BunServices.layer)),
    ),
  ).rejects.toThrow();
  const receipt = JSON.parse(
    await readFile(join(timeout.directory, "process.json"), "utf8"),
  );
  expect(receipt.status).toBe("failed");
  expect(receipt.termination).toBe("scope-cleanup");
  expect(receipt.deadline).toEqual({ phase: "completion", limitMs: 20 });
  expect(receipt.interrupted).toBe(false);
  const page = await Effect.runPromise(
    readLogPage(join(timeout.directory, "logs"), {
      runId: timeout.runId,
      sequence: 0,
    }).pipe(Effect.provide(BunServices.layer)),
  );
  expect(page.records.map((r) => r.text).join("")).toContain("shutdown-drain");
});
test("stream redaction covers split secrets and overlapping secret values", () => {
  const filter = new TextRedactor(["secret", "secret-long"]);
  const output =
    filter.push("ready sec") +
    filter.push("ret-long\n") +
    filter.push("tail", true);
  expect(output).toBe("ready [REDACTED]\ntail");
});
test("an explicitly expected diagnostic exit is retained rather than rewritten to zero", async () => {
  const input = await request("process.exit(7)", { allowedExitCodes: [7] });
  const result = await Effect.runPromise(
    withProcess(input, (owned) => owned.waitForExit).pipe(
      Effect.provide(BunServices.layer),
    ),
  );
  expect(result).toEqual({ code: 7, signal: null });
  const receipt = JSON.parse(
    await readFile(join(input.directory, "process.json"), "utf8"),
  );
  expect(receipt.status).toBe("passed");
  expect(receipt.allowedExitCodes).toEqual([7]);
  expect(receipt.exit.code).toBe(7);
});
test("cancelling the owning fiber records cancellation and drains shutdown diagnostics", async () => {
  const input = await request(serve);
  await Effect.runPromise(
    Effect.gen(function* () {
      const ready = yield* Deferred.make<void>();
      const worker = yield* Effect.forkChild(
        withProcess(input, (owned) =>
          Effect.gen(function* () {
            yield* owned.waitForText(/ready/, "ready", 2000);
            yield* Deferred.succeed(ready, undefined);
            return yield* Effect.never;
          }),
        ),
      );
      yield* Deferred.await(ready);
      yield* Fiber.interrupt(worker);
    }).pipe(Effect.provide(BunServices.layer)),
  );
  const receipt = JSON.parse(
    await readFile(join(input.directory, "process.json"), "utf8"),
  );
  expect(receipt.status).toBe("cancelled");
  expect(receipt.termination).toBe("scope-cleanup");
  expect(receipt.interrupted).toBe(true);
  expect(receipt.deadline).toBeNull();
  const page = await Effect.runPromise(
    readLogPage(join(input.directory, "logs"), {
      runId: input.runId,
      sequence: 0,
    }).pipe(Effect.provide(BunServices.layer)),
  );
  expect(
    page.records
      .filter((record) => record.channel === "stderr")
      .map((record) => record.text)
      .join(""),
  ).toContain("shutdown-drain");
});
test("stopping an owned process group stops its descendant but leaves a separate group usable", async () => {
  const descendant =
    "const server=Bun.serve({port:0,fetch:()=>new Response('ready')});process.on('SIGTERM',()=>{server.stop(true);process.stderr.write('descendant-stopped\\n',()=>process.exit(0))});console.log('descendant-ready');";
  const parent = await request(
    `Bun.spawn([process.execPath,'-e',${JSON.stringify(descendant)}],{stdout:'inherit',stderr:'inherit'});process.stdin.resume();`,
  );
  const separate = await request(
    "process.stdin.on('data',chunk=>console.log('ack:'+chunk.toString().trim()));process.on('SIGTERM',()=>process.exit(0));console.log('separate-ready');",
  );
  await Effect.runPromise(
    withProcess(separate, (other) =>
      Effect.gen(function* () {
        yield* other.waitForText(/separate-ready/, "ready", 2000);
        yield* withProcess(parent, (owned) =>
          Effect.gen(function* () {
            yield* owned.waitForText(
              /descendant-ready/,
              "descendant ready",
              2000,
            );
            yield* owned.stop;
          }),
        );
        yield* other.send("still-alive\n");
        yield* other.waitForText(
          /ack:still-alive/,
          "unrelated group alive",
          2000,
        );
        yield* other.stop;
      }),
    ).pipe(Effect.provide(BunServices.layer)),
  );
  const page = await Effect.runPromise(
    readLogPage(join(parent.directory, "logs"), {
      runId: parent.runId,
      sequence: 0,
    }).pipe(Effect.provide(BunServices.layer)),
  );
  expect(
    page.records
      .filter((record) => record.channel === "stderr")
      .map((record) => record.text)
      .join(""),
  ).toContain("descendant-stopped");
});
