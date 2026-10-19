import { Effect, FileSystem, Schema } from "effect";
import { join } from "node:path";
import * as luaparse from "luaparse";
import { PinnedFile, Sha256 } from "../../../tools/contracts.ts";
import { readTar } from "../../../tools/tar.ts";
import { provisionPinnedFile, verifyPinnedFile } from "../../../tools/files.ts";
import { getBytes } from "../../../tools/network.ts";
import {
  assertCanonicalPath,
  BoundaryError,
  decode,
  readJSON,
} from "../../../tools/projects.ts";
import type { ResolvedProject } from "../../../tools/projects.ts";
import { Count, GameSources } from "./contracts.ts";

const upstream = {
  version: "3.1.6",
  commit: "bce772c5015de62aee26e7e63725ec8173936166",
  archiveSha256:
    "efb3bfc70a31c9a0d8494c527950314939beefbf5ac106d66102c8ec8784cbc3",
  sourceSha256:
    "4b4cdb5cdeddb517daf553cd7e47213a9771caac49a103b0f6f7e89bab44c5c7",
  helperSha256:
    "aa5676282a828813d65361dbc7fc0621ffed83422cd80c912252f1b8697589cd",
  license: "CC-BY-NC-ND-4.0",
} as const;
const url = `https://codeload.github.com/pyanodon/pypostprocessing/tar.gz/${upstream.commit}`;
const member = `pypostprocessing-${upstream.commit}/lib/data-stage.lua`;
function helperPin(project: ResolvedProject) {
  return {
    path: join(project.outputRoot, "cache", "py-add-to-description.lua"),
    sha256: upstream.helperSha256,
    maxBytes: 8192,
  };
}
export function extractDescriptionHelper(source: string) {
  return Effect.try({
    try: () => {
      if (
        new Bun.CryptoHasher("sha256").update(source).digest("hex") !==
        upstream.sourceSha256
      )
        throw new Error("Reviewed Py source file differs");
      const ast = luaparse.parse(source, { luaVersion: "5.2", ranges: true });
      const assignments = ast.body.filter(
        (node): node is luaparse.AssignmentStatement => {
          if (
            node.type !== "AssignmentStatement" ||
            node.variables.length !== 1
          )
            return false;
          const variable = node.variables[0];
          return (
            variable?.type === "MemberExpression" &&
            variable.base.type === "Identifier" &&
            variable.base.name === "py" &&
            variable.identifier.name === "add_to_description"
          );
        },
      );
      const assignment = assignments[0];
      if (
        assignments.length !== 1 ||
        assignment?.init[0]?.type !== "FunctionDeclaration"
      )
        throw new Error("Reviewed Py helper changed AST shape");
      const { range } = Schema.decodeUnknownSync(
        Schema.Struct({ range: Schema.Tuple([Count, Count]) }),
        { onExcessProperty: "ignore" },
      )(assignment);
      const helper = source.slice(range[0], range[1]) + "\n";
      if (
        new Bun.CryptoHasher("sha256").update(helper).digest("hex") !==
        upstream.helperSha256
      )
        throw new Error("Reviewed Py helper differs");
      return helper;
    },
    catch: () =>
      new BoundaryError({
        boundary: "pypostprocessing text helper",
        message:
          "Pinned upstream file/function differs; review its source and provenance before changing the pins",
      }),
  });
}
const HelperEvidence = Schema.Struct({
  schema: Schema.Literal(1),
  archive: PinnedFile,
  helper: PinnedFile,
  sourceSha256: Sha256,
  commit: Schema.Literal(upstream.commit),
  license: Schema.Literal(upstream.license),
  url: Schema.Literal(url),
  member: Schema.Literal(member),
});
export function provisionPyHelper(project: ResolvedProject) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const reviewed = yield* readJSON(
      GameSources,
      join(project.modRoot, "content/game-sources.json"),
    );
    if (
      reviewed.reviewedMods.pypostprocessing?.version !== upstream.version ||
      reviewed.files["py-description-helper"]?.path !== "lib/data-stage.lua"
    )
      return yield* Effect.fail(
        new BoundaryError({
          boundary: project.info.name,
          message:
            "Corpus provenance no longer matches the explicitly reviewed offline helper",
        }),
      );
    const archive = {
      path: join(
        project.outputRoot,
        "cache",
        `pypostprocessing-${upstream.commit}.tar.gz`,
      ),
      sha256: upstream.archiveSha256,
      maxBytes: 1024 * 1024,
    };
    const helper = helperPin(project);
    yield* provisionPinnedFile(
      helper,
      Effect.gen(function* () {
        yield* provisionPinnedFile(
          archive,
          getBytes(url, "reviewed pypostprocessing source", archive.maxBytes, {
            origin: "github-source",
            redirects: false,
          }),
        );
        const files = yield* readTar(
          { pin: archive, root: `pypostprocessing-${upstream.commit}` },
          (entry) => entry.name === member,
        );
        const bytes = files.get(member);
        if (bytes === undefined)
          return yield* Effect.fail(
            new BoundaryError({
              boundary: member,
              message: "Pinned source archive has no unique reviewed helper",
            }),
          );
        const source = yield* Effect.try({
          try: () =>
            new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
              bytes,
            ),
          catch: () =>
            new BoundaryError({
              boundary: member,
              message: "Reviewed helper is not UTF-8",
            }),
        });
        return new TextEncoder().encode(
          yield* extractDescriptionHelper(source),
        );
      }),
    );
    const evidence = yield* decode(
      HelperEvidence,
      {
        schema: 1,
        archive,
        helper,
        sourceSha256: upstream.sourceSha256,
        commit: upstream.commit,
        license: upstream.license,
        url,
        member,
      },
      "offline helper provenance",
    );
    const output = join(project.outputRoot, "py-helper.json");
    yield* assertCanonicalPath(output);
    yield* fs.writeFileString(output, JSON.stringify(evidence, null, 2) + "\n");
    return evidence;
  });
}
export function helperSource(project: ResolvedProject) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* verifyPinnedFile(helperPin(project), "mise run setup");
    return "local py = {}\n" + (yield* fs.readFileString(path)) + "\n";
  });
}
