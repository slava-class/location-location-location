import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runCommand } from "./commands.ts";
import { runFiles } from "./fixtures/release.ts";
import { emptyModSettings } from "./mod-settings.ts";
import { resolveWorkspace } from "./projects.ts";
import { RunAnnouncements } from "./runs.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

test("native FMTK can populate all empty settings scopes without changing other values", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "modkit-settings-")),
  );
  roots.push(root);
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  await writeFile(
    join(root, "mod-settings.dat"),
    await Effect.runPromise(emptyModSettings("2.1.21")),
  );
  const workspace = await runFiles(resolveWorkspace(root));
  const invoke = (...args: string[]) =>
    runFiles(
      runCommand(workspace, "fmtk-settings", [
        process.execPath,
        resolve(
          import.meta.dir,
          "../node_modules/factoriomod-debug/dist/fmtk-cli.js",
        ),
        "settings",
        "--modsPath",
        root,
        ...args,
      ]).pipe(
        Effect.provideService(RunAnnouncements, { write: () => Effect.void }),
      ),
    );
  const cases = [
    ["startup", "fixture-text", "enabled", "enabled"],
    ["runtime-global", "fixture-bool", "false", false],
    ["runtime-per-user", "fixture-number", "2.5", 2.5],
  ] as const;
  for (const [scope, name, value] of cases)
    await invoke("set", scope, name, value);
  for (const [scope, name, , expected] of cases) {
    const result = await invoke("get", scope, name);
    expect(JSON.parse(result.stdout)).toBe(expected);
  }
}, 10000);

test("settings headers reject truncated, out-of-range and noncanonical versions", async () => {
  for (const version of ["2.1", "65536.0.0", "2.1.21\n", "2.1.21-1"]) {
    const error = await Effect.runPromise(
      Effect.flip(emptyModSettings(version)),
    );
    expect(error._tag).toBe("BoundaryError");
  }
});
