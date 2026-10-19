import { Effect, Schema } from "effect";
import { join } from "node:path";
import { ApiDocuments, Sha256 } from "./contracts.ts";
import { BoundaryError, decode, ModId, Version } from "./projects.ts";
import type { ResolvedProject } from "./projects.ts";
import { engineFloor } from "./dependencies.ts";
import { provisionPinnedFile, verifyPinnedFile } from "./files.ts";
import { getBytes } from "./network.ts";
import { packageInventory } from "./packaging.ts";
const pins = Schema.decodeUnknownSync(
  Schema.Record(Version, Schema.Struct({ runtime: Sha256, prototype: Sha256 })),
)({
  "2.1.20": {
    runtime: "1ff275cc085347fafddc01b5ba53df10259319339e78cd6e5b4e0d067e1daeb6",
    prototype:
      "5d2aab6483f33d1582d2fdfd661b4b9f6ff6a1f97548311524d062ecc32f200b",
  },
  "2.1.21": {
    runtime: "f21602449ec6c077afb4a26311ef075af7aedb8c067d53b9cc87efccca4d761f",
    prototype:
      "5abe17bc8797770ab6c7ceb0cbe4348ab3b716efef59c7ee3e539596337132e6",
  },
});
function apiInputs(project: ResolvedProject) {
  return Effect.gen(function* () {
    const version = yield* engineFloor(project),
      pin = pins[version];
    if (!pin)
      return yield* Effect.fail(
        new BoundaryError({
          boundary: version,
          message:
            "Minimum engine API documents have no reviewed checksum pins",
        }),
      );
    const document = (name: string, sha256: string) => ({
      path: join(
        project.repoRoot,
        ".factorio-test/cache/api",
        version,
        name + "-api.json",
      ),
      sha256,
      maxBytes: 32 * 1024 * 1024,
    });
    return yield* decode(
      ApiDocuments,
      {
        version,
        runtime: document("runtime", pin.runtime),
        prototype: document("prototype", pin.prototype),
      },
      "API documents",
    );
  });
}
export function resolveApi(project: ResolvedProject) {
  return Effect.gen(function* () {
    const documents = yield* apiInputs(project);
    for (const name of ["runtime", "prototype"] as const)
      yield* verifyPinnedFile(documents[name], "mise run setup");
    return documents;
  });
}
export const ApiProvisionResult = Schema.Struct({
  mod: ModId,
  documents: Schema.NullOr(ApiDocuments),
});
export function provisionApi(project: ResolvedProject) {
  return Effect.gen(function* () {
    let documents: typeof ApiDocuments.Type | null = null;
    if (
      (yield* packageInventory(project)).some((path) => path.endsWith(".lua"))
    ) {
      documents = yield* apiInputs(project);
      for (const name of ["runtime", "prototype"] as const) {
        const pin = documents[name];
        yield* provisionPinnedFile(
          pin,
          getBytes(
            `https://lua-api.factorio.com/${documents.version}/${name}-api.json`,
            `${documents.version} ${name} API`,
            pin.maxBytes,
            { origin: "factorio", redirects: false },
          ),
        );
      }
    }
    return yield* decode(
      ApiProvisionResult,
      { mod: project.info.name, documents },
      "API provisioning result",
    );
  });
}
