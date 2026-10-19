import { BunServices } from "@effect/platform-bun";
import { Effect, Schema } from "effect";
import type { KnipConfig } from "knip";
import { readJSON, RelativePath } from "./tools/projects.ts";

const selection = process.env.MODKIT_SOURCE_SELECTION;
const files = selection
  ? await Effect.runPromise(
      readJSON(
        Schema.Array(RelativePath).check(Schema.isMinLength(1)),
        selection,
      ).pipe(Effect.provide(BunServices.layer)),
    )
  : undefined;
const isEntry = (path: string) =>
  path === "tools/cli.ts" ||
  path === "tools/source-check.ts" ||
  path === "knip.config.ts" ||
  /\.test\.(?:ts|mjs)$/.test(path) ||
  path.startsWith("tools/fixtures/") ||
  /^mods\/[^/]+\/(?:dev\.config\.ts|dev\/tooling\.ts|dev\/tuners\/[^/]+\/(?:descriptor|verify)\.ts)$/.test(
    path,
  );

export default {
  entry: files?.filter(isEntry) ?? [
    "tools/cli.ts",
    "tools/source-check.ts",
    "tools/**/*.test.{ts,mjs}",
    "tools/fixtures/**/*.ts",
    "mods/*/dev.config.ts",
    "mods/*/dev/tooling.ts",
    "mods/*/dev/tuners/*/{descriptor,verify}.ts",
    "mods/*/dev/**/*.test.{ts,mjs}",
  ],
  project: files?.filter((path) => /\.(?:ts|mjs|js)$/.test(path)) ?? [
    "tools/**/*.{ts,mjs}",
    "mods/*/dev.config.ts",
    "mods/*/dev/**/*.{ts,mjs}",
  ],
  // These are external executables/data providers, not imported application libraries.
  // Their exact versions are checked by modkit and their invocations live in Trunk/Lua tooling.
  ignoreDependencies: [
    "factorio-test-cli",
    "factoriomod-debug",
    "typescript",
    "oxfmt",
    "oxlint",
    "oxlint-tsgolint",
    "@effect/tsgo",
    // @effect/tsgo consumes this configuration namespace; no JS plugin is loaded.
    "@effect/language-service",
  ],
} satisfies KnipConfig;
