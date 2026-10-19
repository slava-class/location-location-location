import { afterEach, expect, test } from "bun:test";
import { BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import {
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
import { checkSources } from "./source-check.ts";
import {
  rejectTrunkUserOverrides,
  runQuality,
  validateTrunkCheck,
} from "./quality.ts";
import { runCommand } from "./commands.ts";
import { BoundaryError } from "./projects.ts";
import { withOwnedLock } from "./locks.ts";

const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0))
    await rm(path, { recursive: true, force: true });
});
async function temporary() {
  const path = await realpath(await mkdtemp(join(tmpdir(), "modkit-quality-")));
  directories.push(path);
  return path;
}
const run = <A, E>(
  effect: Effect.Effect<A, E, import("effect").FileSystem.FileSystem>,
) => Effect.runPromise(effect.pipe(Effect.provide(BunServices.layer)));

test("Markdown links resolve relative to their document, decode filenames and ignore code/external anchors", async () => {
  const root = await temporary();
  await mkdir(join(root, "docs"));
  await writeFile(join(root, "a & (b)#.md"), "# Target\n");
  await writeFile(
    join(root, "docs", "source.md"),
    [
      "[target](../a%20%26%20%28b%29%23.md#ignored-heading)",
      "[reference][target]",
      "",
      "[target]: ../a%20%26%20%28b%29%23.md",
      "[external](https://example.invalid/missing)",
      "[anchor](#ignored-heading)",
      "`[code](missing.md)`",
      "```md",
      "[fenced](missing.md)",
      "```",
    ].join("\n"),
  );
  expect(await run(checkSources(root, ["docs/source.md"]))).toEqual([]);
});

test("source checks distinguish broken, nonportable and escaping links without following external symlinks", async () => {
  const root = await temporary(),
    outside = await temporary();
  await writeFile(join(outside, "private.md"), "# Outside\n");
  await symlink(join(outside, "private.md"), join(root, "escape.md"));
  await writeFile(
    join(root, "source.md"),
    [
      "[missing](missing.md)",
      "[machine](file:///tmp/private.md)",
      "[escape](../outside.md)",
      "[symlink](escape.md)",
      "[encoding](%FF.md)",
      "<<<<<<< unresolved",
    ].join("\n"),
  );
  const findings = await run(checkSources(root, ["source.md"]));
  expect(findings.map((issue) => issue.rule).sort()).toEqual([
    "escaping-link",
    "escaping-link",
    "invalid-link",
    "machine-local-link",
    "merge-conflict",
    "missing-link",
  ]);
  expect(run(checkSources(root, ["escape.md"]))).rejects.toBeInstanceOf(
    BoundaryError,
  );
  expect(run(checkSources(root, ["../outside.md"]))).rejects.toBeInstanceOf(
    BoundaryError,
  );
  expect(run(checkSources(root, []))).rejects.toBeInstanceOf(BoundaryError);
});

test("malformed source encodings and NUL bytes remain findings", async () => {
  const root = await temporary();
  await writeFile(join(root, "invalid.txt"), new Uint8Array([0xc3]));
  await writeFile(join(root, "nul.txt"), "before\0after");
  expect(
    (await run(checkSources(root, ["invalid.txt", "nul.txt"]))).map(
      (issue) => issue.rule,
    ),
  ).toEqual(["invalid-utf8", "nul-byte"]);
});

test("a source CLI finding keeps stdout valid SARIF while returning failure", async () => {
  const root = await temporary();
  await writeFile(join(root, "missing.md"), "[broken](absent.md)\n");
  const child = Bun.spawn(
    [process.execPath, join(import.meta.dir, "source-check.ts"), "missing.md"],
    { cwd: root, stdout: "pipe", stderr: "pipe" },
  );
  const [code, stdout] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code).toBe(1);
  const result = JSON.parse(stdout);
  expect(result.runs[0].results[0].ruleId).toBe("missing-link");
  expect(
    result.runs[0].results[0].locations[0].physicalLocation.artifactLocation
      .uri,
  ).toBe("missing.md");
});

test("unsealed project-local Trunk overrides cannot certify shared policy", async () => {
  const root = await temporary();
  await mkdir(join(root, ".trunk"));
  await writeFile(
    join(root, ".trunk", "user.yaml"),
    "lint:\n  disabled: [ALL]\n",
  );
  expect(
    run(
      rejectTrunkUserOverrides({
        repoRoot: root,
        outputRoot: join(root, "output"),
      }),
    ),
  ).rejects.toBeInstanceOf(BoundaryError);
});

test("adding child environment settings preserves executable lookup through the approved inherited PATH", async () => {
  const root = await temporary();
  const result = await Effect.runPromise(
    runCommand(
      { repoRoot: root, outputRoot: join(root, "output") },
      "environment-regression",
      ["bun", "--version"],
      { env: { TRUNK_TELEMETRY: "off" } },
    ).pipe(Effect.provide(BunServices.layer)),
  );
  expect(result.stdout.trim()).toBe(Bun.version);
});

test("a successful Trunk process cannot certify existing findings, partial selections or malformed output", async () => {
  for (const output of [
    "Checked 1 file\n2 existing issues\n✔ No new issues\n",
    "Checked 1 file\n✔ No issues\n",
    "Checked 2 files\n✔ No issues\nunexpected trailing diagnostic\n",
    "No files matched\n",
  ]) {
    expect(
      Effect.runPromise(validateTrunkCheck(output, 2)),
    ).rejects.toBeInstanceOf(BoundaryError);
  }
  await Effect.runPromise(
    validateTrunkCheck("Checked 2 files\n✔ No issues\n", 2),
  );
});

test("an occupied workspace quality lock blocks formatting before any source mutation", async () => {
  const root = await temporary();
  const source = "const unformatted=1\n";
  await writeFile(join(root, "source.ts"), source);
  expect(
    Effect.runPromise(
      withOwnedLock(
        join(root, ".factorio-test", "quality.lock"),
        "another product check",
        runQuality(
          {
            repoRoot: root,
            outputRoot: join(root, "different-product-output"),
          },
          "format",
        ),
      ).pipe(Effect.provide(BunServices.layer)),
    ),
  ).rejects.toMatchObject({
    _tag: "BoundaryError",
    boundary: join(root, ".factorio-test", "quality.lock"),
  });
  expect(await readFile(join(root, "source.ts"), "utf8")).toBe(source);
});
