import { afterEach, expect, test } from "bun:test";
import { BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  provisionDependencies,
  provisionDependency,
  resolveDependency,
} from "./dependencies.ts";
import { BoundaryError, resolveProject, resolveWorkspace } from "./projects.ts";
import { withOwnedLock } from "./locks.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "modkit-dependency-")),
  );
  roots.push(root);
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  const project = await Effect.runPromise(
    resolveWorkspace(root).pipe(Effect.provide(BunServices.layer)),
  );
  const bytes = new TextEncoder().encode("immutable reviewed input");
  const pin = {
    name: "fixture",
    version: "1.0.0",
    sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  };
  const source = join(root, "source.zip");
  const cached = join(
    root,
    ".factorio-test/cache/dependencies/fixture_1.0.0.zip",
  );
  await writeFile(source, bytes);
  let requests = 0;
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      requests++;
      return HttpClientResponse.fromWeb(
        request,
        new Response(null, { status: 503 }),
      );
    }),
  );
  return {
    project,
    bytes,
    pin,
    source,
    cached,
    client,
    requests: () => requests,
  };
}

test("ordinary dependency resolution rejects missing inputs without provisioning, network or cache allocation", async () => {
  const f = await fixture();
  const failure = await Effect.runPromise(
    Effect.flip(resolveDependency(f.project, f.pin)).pipe(
      Effect.provide(BunServices.layer),
    ),
  );
  expect(failure).toBeInstanceOf(BoundaryError);
  expect(access(dirname(f.cached))).rejects.toMatchObject({ code: "ENOENT" });
});

test("explicit local provisioning validates content and later resolution rejects changed cache bytes without repair", async () => {
  const f = await fixture();
  const provision = () =>
    Effect.runPromise(
      provisionDependency(f.project, f.pin, f.source).pipe(
        Effect.provide(BunServices.layer),
        Effect.provideService(HttpClient.HttpClient, f.client),
      ),
    );
  await provision();
  expect(
    await Effect.runPromise(
      resolveDependency(f.project, f.pin).pipe(
        Effect.provide(BunServices.layer),
      ),
    ),
  ).toBe(f.cached);
  expect(new Uint8Array(await readFile(f.cached))).toEqual(f.bytes);
  await writeFile(f.cached, "corrupt cached input");
  expect(provision()).rejects.toBeInstanceOf(BoundaryError);
  expect(await readFile(f.cached, "utf8")).toBe("corrupt cached input");
  expect(f.requests()).toBe(0);
});

test("wrong or missing selected local archives never substitute network inputs or leave installed partial bytes", async () => {
  for (const missing of [false, true]) {
    const f = await fixture();
    if (missing) await rm(f.source);
    else await writeFile(f.source, "wrong input");
    const result = await Effect.runPromise(
      Effect.exit(provisionDependency(f.project, f.pin, f.source)).pipe(
        Effect.provide(BunServices.layer),
        Effect.provideService(HttpClient.HttpClient, f.client),
      ),
    );
    expect(result._tag).toBe("Failure");
    expect(await readdir(dirname(f.cached))).toEqual([]);
    expect(f.requests()).toBe(0);
  }
});

test("dependency resolution rejects aliased inputs and provisioning respects an existing owner", async () => {
  const f = await fixture();
  await mkdir(dirname(f.cached), { recursive: true });
  await symlink(f.source, f.cached);
  expect(
    Effect.runPromise(
      resolveDependency(f.project, f.pin).pipe(
        Effect.provide(BunServices.layer),
      ),
    ),
  ).rejects.toBeInstanceOf(BoundaryError);
  await rm(f.cached);
  const failure = await Effect.runPromise(
    withOwnedLock(
      f.cached + ".lock",
      "other provisioning owner",
      Effect.flip(provisionDependency(f.project, f.pin, f.source)),
    ).pipe(
      Effect.provide(BunServices.layer),
      Effect.provideService(HttpClient.HttpClient, f.client),
    ),
  );
  expect(failure).toBeInstanceOf(BoundaryError);
  expect(await readdir(dirname(f.cached))).toEqual([]);
  expect(f.requests()).toBe(0);
});

test("offline provisioning reports runtime exclusions but still enforces typing pins; engine provisioning requires the full closure", async () => {
  const f = await fixture(),
    root = f.project.repoRoot;
  async function selected(
    name: string,
    verification: "offline" | "engine",
    dependencies: string[],
  ) {
    const directory = join(root, "mods", name);
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "info.json"),
      JSON.stringify({
        name,
        version: "1.0.0",
        title: name,
        author: "test",
        factorio_version: "2.1",
        description: "Dependency scope fixture",
        dependencies: ["base >= 2.1.20", ...dependencies],
      }),
    );
    await writeFile(join(directory, "control.lua"), "");
    await writeFile(
      join(directory, "dev.config.ts"),
      `export default {verification: ${JSON.stringify(verification)}};`,
    );
    return Effect.runPromise(
      resolveProject(root, name, root).pipe(Effect.provide(BunServices.layer)),
    );
  }
  const offline = await selected("offline", "offline", [
    "unreviewed-runtime >= 9.0.0",
    "? optional-runtime",
  ]);
  const result = await Effect.runPromise(
    provisionDependencies(offline).pipe(
      Effect.provide(BunServices.layer),
      Effect.provideService(HttpClient.HttpClient, f.client),
    ),
  );
  expect(result.scope).toBe("offline-tooling");
  expect(result.archives).toEqual([]);
  expect(result.runtimeNotProvisioned).toEqual([
    {
      mod: "offline",
      dependency: {
        name: "unreviewed-runtime",
        kind: "required",
        operator: ">=",
        version: "9.0.0",
      },
    },
  ]);
  const engine = await selected("engine", "engine", [
    "unreviewed-runtime >= 9.0.0",
  ]);
  const unavailable = await Effect.runPromise(
    Effect.flip(provisionDependencies(engine)).pipe(
      Effect.provide(BunServices.layer),
      Effect.provideService(HttpClient.HttpClient, f.client),
    ),
  );
  expect(unavailable).toMatchObject({ boundary: "unreviewed-runtime" });
  const incompatible = await selected("typing", "offline", ["flib > 99.0.0"]);
  const mismatch = await Effect.runPromise(
    Effect.flip(provisionDependencies(incompatible)).pipe(
      Effect.provide(BunServices.layer),
      Effect.provideService(HttpClient.HttpClient, f.client),
    ),
  );
  expect(mismatch).toMatchObject({ boundary: "flib" });
  expect(f.requests()).toBe(0);
  expect(access(dirname(f.cached))).rejects.toMatchObject({ code: "ENOENT" });
});
