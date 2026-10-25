import { afterEach, expect, test } from "bun:test";
import {
  cp,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "modkit-oxlint-")));
  roots.push(root);
  await mkdir(join(root, "selected"));
  await mkdir(join(root, "outside"));
  await symlink(
    resolve(import.meta.dir, "../node_modules"),
    join(root, "node_modules"),
  );
  await cp(
    resolve(import.meta.dir, "../.oxlintrc.json"),
    join(root, ".oxlintrc.json"),
  );
  await writeFile(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        module: "Preserve",
        moduleResolution: "Bundler",
        target: "ES2022",
        skipLibCheck: true,
      },
      include: ["selected/**/*.ts", "outside/**/*.ts"],
    }),
  );
  await writeFile(
    join(root, "selected/good.ts"),
    "export const value: number = 1;\n",
  );
  await writeFile(
    join(root, "outside/bad.ts"),
    "export const value: number = 'wrong';\n",
  );
  await writeFile(
    join(root, "selected/effect.ts"),
    'import { Effect, FileSystem } from "effect";\nexport const result = Effect.runPromise(FileSystem.FileSystem);\n',
  );
  return async (files: unknown) => {
    const selection = join(root, "selection.json");
    await writeFile(selection, JSON.stringify(files));
    const child = Bun.spawn(
      [process.execPath, join(import.meta.dir, "oxlint.ts"), selection],
      { cwd: root, stdout: "pipe", stderr: "pipe" },
    );
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { code, stdout, stderr };
  };
}

test("one selected-source check preserves wide/narrow scope and Effect service type errors", async () => {
  const invoke = await fixture();
  const narrow = await invoke(["selected/good.ts"]);
  expect(narrow.code).toBe(0);
  expect(
    JSON.parse(narrow.stdout).runs.flatMap(
      (run: { results: unknown[] }) => run.results,
    ),
  ).toEqual([]);
  const wide = await invoke(["selected/good.ts", "outside/bad.ts"]);
  expect(wide.code).not.toBe(0);
  expect(wide.stdout).toContain("outside/bad.ts");
  expect((await invoke(["selected/good.ts"])).code).toBe(0);
  const effect = await invoke(["selected/effect.ts"]);
  expect(effect.code).not.toBe(0);
  expect(effect.stdout).toContain("selected/effect.ts");
}, 30000);

test("malformed, escaping and non-code selections cannot become a successful empty check", async () => {
  const invoke = await fixture();
  for (const files of [
    [],
    ["../outside.ts"],
    ["README.md"],
    { files: ["selected/good.ts"] },
  ]) {
    const result = await invoke(files);
    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe("");
  }
}, 30000);
