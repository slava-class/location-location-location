import { BunServices } from "@effect/platform-bun";
import { Effect, FileSystem, Schema } from "effect";
import type { ChildProcessSpawner } from "effect/process";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProject } from "../projects.ts";
import { readListing } from "../release-info.ts";
import { loadPrepared, ReleaseManifest } from "../release.ts";
import { sourceSeal } from "../source.ts";
import { selectedCases, TestInventory } from "../test-results.ts";
import { VerificationResult } from "../testing.ts";
import { SmokeResult } from "../smoke.ts";
import { Phase } from "../verification.ts";

export const runFiles = <A, E>(
  effect: Effect.Effect<
    A,
    E,
    FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner
  >,
) => Effect.runPromise(effect.pipe(Effect.provide(BunServices.layer)));
const hash = (bytes: Uint8Array, algorithm: "sha256" | "sha1") =>
  new Bun.CryptoHasher(algorithm).update(bytes).digest("hex");
const stamp = "2026-01-01T00:00:00.000Z";

// Synthetic receipts exercise corruption and publication transitions, not engine correctness.
// Real release preparation is verified separately against the owned Factorio installation.
export async function releaseFixture(
  roots: string[],
  graphics = false,
  target: { root?: string; name?: string } = {},
) {
  const root =
    target.root ??
    (await realpath(await mkdtemp(join(tmpdir(), "modkit-release-"))));
  if (target.root === undefined) roots.push(root);
  const name = target.name ?? "primary";
  for (const directory of [
    "tools",
    "patches",
    ".trunk",
    ".config",
    `mods/${name}/dev`,
    "mods/unrelated",
  ])
    await mkdir(join(root, directory), { recursive: true });
  for (const name of [
    "package.json",
    "bun.lock",
    ".config/mise.toml",
    "tsconfig.json",
    ".config/stylua.toml",
    "license.txt",
    ".gitignore",
    ".editorconfig",
    ".oxlintrc.json",
    ".oxfmtrc.json",
    ".trunk/trunk.yaml",
    ".config/betterleaks.toml",
    ".config/knip.ts",
    ".config/emmy.json",
    ".config/workshop-luacheck.lua",
  ])
    await writeFile(join(root, name), "source input\n");
  await writeFile(join(root, ".gitignore"), ".factorio-test/\n");
  const modRoot = join(root, "mods", name);
  const mod = { name, version: "1.0.1" };
  await writeFile(
    join(modRoot, "info.json"),
    JSON.stringify({
      ...mod,
      title: "Primary",
      author: "Fixture",
      factorio_version: "2.1",
      dependencies: ["base >= 2.1.20"],
      description: "A fixture product",
      homepage: `https://example.invalid/${name}`,
    }),
  );
  await writeFile(
    join(modRoot, "changelog.txt"),
    "Version: 1.0.1\n  Changes:\n    - Fixture.\n",
  );
  await writeFile(
    join(modRoot, "MOD_PORTAL.md"),
    "- **Category:** Utilities\n- **License:** MIT\n- **Source:** [source](https://example.invalid/source)\n\n## Description\n\nFixture description.\n",
  );
  const config = graphics
    ? {
        visual: true,
        verification: "engine",
        profiles: ["base"],
        persistence: "stateless",
        native: {
          suite: "native",
          scenes: [{ name: "native-scene", file: "native.png" }],
          gallerySuite: "gallery",
          gallery: [
            { name: "alpha", file: "gallery/alpha.png" },
            { name: "beta", file: "gallery/beta.png" },
          ],
          gallerySelection: ["gallery/beta.png", "gallery/alpha.png"],
        },
      }
    : {
        visual: false,
        verification: "offline",
        profiles: [],
        persistence: "stateless",
      };
  await writeFile(
    join(modRoot, "dev.config.ts"),
    `export default ${JSON.stringify(config)};\n`,
  );
  const inventory = Schema.decodeUnknownSync(TestInventory)({
    schema: 1,
    profiles: ["base", "native", "gallery"],
    cases: [
      {
        path: "base-correctness",
        passedIn: ["base"],
        skippedIn: ["native", "gallery"],
      },
      {
        path: "native-scene",
        passedIn: ["native"],
        skippedIn: ["base", "gallery"],
      },
      { path: "alpha", passedIn: ["gallery"], skippedIn: ["base", "native"] },
      { path: "beta", passedIn: ["gallery"], skippedIn: ["base", "native"] },
    ],
  });
  await writeFile(
    join(modRoot, "dev/engine-inventory.json"),
    JSON.stringify(inventory),
  );
  const project = await runFiles(resolveProject(root, name, root));
  const source = await runFiles(sourceSeal(project));
  const directory = join(project.outputRoot, "releases", mod.version);
  await mkdir(directory, { recursive: true });
  const archiveBytes = new TextEncoder().encode(
    `synthetic package payload for sealed-byte tests: ${name}`,
  );
  const archive = {
    file: `${mod.name}_${mod.version}.zip`,
    sha256: hash(archiveBytes, "sha256"),
    sha1: hash(archiveBytes, "sha1"),
  };
  await writeFile(join(directory, archive.file), archiveBytes);
  const artifact = {
    schema: 2,
    mod,
    archive: join(directory, archive.file),
    sha256: archive.sha256,
    sha1: archive.sha1,
    files: {},
    compression: {
      implementation: "yazl",
      version: "3.3.1",
      bun: Bun.version,
      bunRevision: Bun.revision,
      zlib: process.versions.zlib,
      method: "deflate",
      level: 9,
    },
  };
  const engine = {
    executable: "/fixture/factorio",
    version: "2.1.20",
    build: "fixture",
    platform: "fixture",
    distribution: "full",
    readData: "/fixture/data",
    sha256: "e".repeat(64),
  };
  const captures: { file: string; sha256: string; sha1: string }[] = [];
  async function suite(profile: "base" | "native" | "gallery") {
    const request = {
      schema: 1,
      runId: crypto.randomUUID(),
      mod,
      purpose: "suite",
      profile,
      language: "en",
      artifactSha256: archive.sha256,
    };
    const expected = await Effect.runPromise(selectedCases(inventory, profile));
    const files =
      profile === "native"
        ? ["native.png"]
        : profile === "gallery"
          ? ["gallery/alpha.png", "gallery/beta.png"]
          : [];
    const images = [];
    for (const file of files) {
      const bytes = new TextEncoder().encode(
        `synthetic already-decoded capture payload: ${profile}/${file}`,
      );
      const frozen = {
        file: `captures/${profile}/${file}`,
        sha256: hash(bytes, "sha256"),
        sha1: hash(bytes, "sha1"),
      };
      await mkdir(
        join(
          directory,
          "captures",
          profile,
          file === "native.png" ? "" : "gallery",
        ),
        { recursive: true },
      );
      await writeFile(join(directory, frozen.file), bytes);
      captures.push(frozen);
      images.push({
        file,
        evidence: {
          format: "png",
          width: profile === "native" ? 1600 : 1920,
          height: profile === "native" ? 1000 : 1080,
          bytes: bytes.length,
          sha256: frozen.sha256,
          decodedSha256: "d".repeat(64),
          decodeMs: 1,
          bun: "1.4.2",
        },
      });
    }
    return Schema.decodeUnknownSync(VerificationResult)({
      request,
      engine,
      graphics: profile === "base" ? null : "extreme",
      source,
      directory: "/fixture/run",
      inventorySha256: source.files[`mods/${name}/dev/engine-inventory.json`],
      seedSha256: "1".repeat(64),
      fixtureSha256: "2".repeat(64),
      startedAt: stamp,
      elapsedMs: 1,
      status: "passed",
      observed: {
        ...request,
        tick: 60,
        activeMods: {
          base: "2.1.20",
          [name]: mod.version,
          "factorio-test": "3.6.0",
        },
      },
      summary: {
        failed: 0,
        passed: expected.passed.length,
        ran: expected.passed.length,
        skipped: expected.skipped.length,
        todo: 0,
        cancelled: 0,
        describeBlockErrors: 0,
        status: "passed",
      },
      caseEvidence:
        profile === "base" ? "framework-json" : "native-framework-log",
      passed: expected.passed,
      skipped: expected.skipped.length,
      images,
    });
  }
  const base = graphics ? await suite("base") : null;
  const native = graphics ? await suite("native") : null;
  const gallery = graphics ? await suite("gallery") : null;
  const smokeRequest = {
    schema: 1,
    runId: crypto.randomUUID(),
    mod,
    purpose: "package-smoke",
    profile: "base",
    language: "en",
    artifactSha256: archive.sha256,
  };
  const smoke = graphics
    ? [
        Schema.decodeUnknownSync(SmokeResult)({
          request: smokeRequest,
          engine,
          source,
          artifact,
          directory: "/fixture/smoke",
          seedSha256: "1".repeat(64),
          fixtureSha256: "2".repeat(64),
          startedAt: stamp,
          status: "passed",
          elapsedMs: 1,
          observed: {
            ...smokeRequest,
            tick: 60,
            activeMods: { base: "2.1.20", [name]: mod.version },
          },
          updates: 60,
        }),
      ]
    : [];
  const noLua = {
    mod: mod.name,
    status: "not-applicable",
    reason: "Synthetic receipt fixture",
  };
  const qualityRunId = crypto.randomUUID();
  const manifest = Schema.decodeUnknownSync(ReleaseManifest)({
    schema: 1,
    mod,
    preparedAt: stamp,
    locale: "en",
    source,
    archive,
    captures,
    images: graphics
      ? [
          "captures/gallery/gallery/beta.png",
          "captures/gallery/gallery/alpha.png",
        ]
      : [],
    listing: await runFiles(readListing(project)),
    evidence: {
      native,
      gallery,
      smoke,
      verification: {
        schema: 2,
        runId: crypto.randomUUID(),
        mod,
        directory: "/fixture/verify",
        ownerPid: 1,
        source,
        capabilities: project.capabilities,
        startedAt: stamp,
        elapsedMs: 1,
        phase: "seal",
        completed: Phase.literals,
        timings: Phase.literals.map((phase) => ({
          phase,
          status: "passed",
          elapsedMs: 0,
          execution: "project",
          runs: [],
        })),
        status: "passed",
        checks: {
          toolchain: { bun: "1.4.2", packages: {}, native: {} },
          whitespace: { status: "passed", runId: crypto.randomUUID() },
          quality: {
            status: "passed",
            mode: "check",
            scope: mod.name,
            runId: qualityRunId,
            files: Object.keys(source.files),
            changed: [],
            before: source.sha256,
            after: source.sha256,
            timings: {
              schema: 1,
              runId: qualityRunId,
              processElapsedMs: 0,
              status: "complete",
              coverage: "invocation",
              checkers: [],
            },
          },
          audit: { mod, languages: [], localeKeys: 0, projectAudit: false },
          lint: noLua,
          types: noLua,
          toolTests: {
            runId: crypto.randomUUID(),
            passed: 1,
            failed: 0,
            skipped: 0,
            todo: 0,
          },
          models: {
            status: "not-applicable",
            reason: "Synthetic receipt fixture",
          },
        },
        artifact,
        engine: base ? [base] : [],
      },
    },
  });
  const save = (value: unknown = manifest) =>
    writeFile(join(directory, "manifest.json"), JSON.stringify(value));
  await save();
  const loaded = await runFiles(loadPrepared(project, mod.version));
  return { root, project, directory, manifest, loaded, save, archiveBytes };
}
