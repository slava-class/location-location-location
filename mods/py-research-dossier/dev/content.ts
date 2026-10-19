import { Effect, FileSystem, Schema } from "effect";
import { join } from "node:path";
import { resolveApi } from "../../../tools/api.ts";
import { withProcess } from "../../../tools/process.ts";
import { newRun } from "../../../tools/runs.ts";
import {
  assertCanonicalPath,
  BoundaryError,
  decode,
  readJSON,
} from "../../../tools/projects.ts";
import type { ResolvedProject } from "../../../tools/projects.ts";
import {
  Catalogue,
  Count,
  GameSources,
  PrototypeAPI,
  Sources,
} from "./contracts.ts";
import { luaValue } from "./lib.mjs";

const disciplines = {
  chemistry: "Chemistry",
  physics: "Physics",
  engineering: "Engineering",
  metallurgy: "Metallurgy",
  geology: "Geology",
  biology: "Biology",
};
const bases = {
  real: "Real principle",
  simplified: "Simplified",
  abstracted: "Game abstraction",
  fictional: "Fictional species; real-world analogue",
};
// Budgets include the topic, rather than hiding a second heading outside the word count.
const limits = {
  recipe: [32, 230],
  material: [28, 200],
  machine: [30, 220],
  technology: [44, 320],
} as const;
type Prototype = (typeof PrototypeAPI.Type.prototypes)[number];
function targetTypes(api: typeof PrototypeAPI.Type) {
  const byName = new Map(
    api.prototypes.map((prototype) => [prototype.name, prototype]),
  );
  const descendants = (parent: string) =>
    api.prototypes.flatMap((prototype) => {
      if (!prototype.typename) return [];
      for (
        let current: Prototype | undefined = prototype;
        current;
        current =
          current.parent === undefined ? undefined : byName.get(current.parent)
      ) {
        if (current.name === parent) return [prototype.typename];
      }
      return [];
    });
  return {
    recipe: new Set(["recipe"]),
    material: new Set([...descendants("ItemPrototype"), "fluid"]),
    machine: new Set(descendants("EntityPrototype")),
    technology: new Set(["technology"]),
  };
}
function insist(condition: unknown, message: string): asserts condition {
  if (!condition)
    throw new BoundaryError({ boundary: "Polytechnic content", message });
}
export function loadContent(project: ResolvedProject) {
  return Effect.gen(function* () {
    const catalogue = yield* readJSON(
      Catalogue,
      join(project.modRoot, "content/catalog.json"),
    );
    const sources = yield* readJSON(
      Sources,
      join(project.modRoot, "content/sources.json"),
    );
    const game = yield* readJSON(
      GameSources,
      join(project.modRoot, "content/game-sources.json"),
    );
    const documents = yield* resolveApi(project);
    const api = yield* readJSON(PrototypeAPI, documents.prototype.path, true);
    return yield* Effect.try({
      try: () => {
        insist(
          api.application_version === game.apiVersion &&
            documents.version === game.apiVersion,
          "Reviewed corpus and provisioned prototype API versions differ",
        );
        const types = targetTypes(api);
        const ids = new Set<string>(),
          targets = new Set<string>(),
          usedSources = new Set<string>();
        const counts: Record<string, number> = {};
        for (const entry of catalogue.entries) {
          const { id, kind, topic, text } = entry;
          insist(!ids.has(id), `Duplicate dossier ID: ${id}`);
          ids.add(id);
          const rendered = `${topic}: ${text}`,
            words = rendered.split(/\s+/).length;
          const [maxWords, maxChars] = limits[kind];
          insist(
            words <= maxWords && rendered.length <= maxChars,
            `${id}: ${words}/${maxWords} words, ${rendered.length}/${maxChars} characters including topic`,
          );
          for (const source of entry.sources) {
            insist(
              Object.hasOwn(sources, source),
              `${id}: unknown scientific source ${source}`,
            );
            usedSources.add(source);
          }
          for (const source of entry.gameSources)
            insist(
              Object.hasOwn(game.files, source),
              `${id}: unknown game source ${source}`,
            );
          if (entry.when?.mod !== undefined)
            insist(
              Object.hasOwn(game.reviewedMods, entry.when.mod),
              `${id}: unreviewed conditional mod ${entry.when.mod}`,
            );
          for (const target of entry.targets) {
            const type = target.slice(0, target.indexOf("/"));
            insist(
              types[kind].has(type),
              `${id}: invalid target type ${target}`,
            );
            insist(!targets.has(target), `Duplicate target: ${target}`);
            targets.add(target);
            counts[type] = (counts[type] ?? 0) + 1;
          }
        }
        insist(
          usedSources.size === Object.keys(sources).length,
          "Unreferenced scientific source",
        );
        return {
          entries: catalogue.entries,
          sources,
          game,
          types,
          counts,
          targetCount: targets.size,
        };
      },
      catch: (error) =>
        error instanceof BoundaryError
          ? error
          : new BoundaryError({
              boundary: "Polytechnic content",
              message: String(error),
            }),
    });
  });
}
type Content = Effect.Success<ReturnType<typeof loadContent>>;
export function renderContent(
  { entries, sources }: Pick<Content, "entries" | "sources">,
  metadata: ResolvedProject["info"],
) {
  // Emit explicit record/target lines so the formatter never has to infer table
  // layout from one enormous line; generation and later formatting must agree.
  const record = ({ id, targets }: Content["entries"][number]) =>
    [
      "{",
      `            ["id"] = ${luaValue(id)},`,
      '            ["targets"] = {',
      ...targets.map(
        (target) => `                ${luaValue(target.split("/"))},`,
      ),
      "            },",
      "        }",
    ].join("\n");
  const unconditional = entries.filter((entry) => !entry.when);
  const conditional = entries
    .filter((entry) => entry.when)
    .map((entry) => {
      const guards = (["mod", "featureFlag", "startup"] as const)
        .filter((key) => entry.when?.[key] !== undefined)
        .map((key) => {
          const value = entry.when![key];
          if (key === "mod") return `active_mods[${luaValue(value)}]`;
          if (key === "startup")
            return `startup_settings[${luaValue(value)}].value`;
          return `enabled_features[${luaValue(value)}]`;
        });
      return `    if ${guards.join(" and ")} then\n        catalogue[#catalogue + 1] = ${record(entry)}\n    end`;
    });
  const lua = [
    "-- Generated by mise run project -- py-research-dossier -- generate from content/catalog.json. Do not edit.",
    "return function(active_mods, startup_settings, enabled_features)",
    "    local catalogue = {",
    ...unconditional.map((entry) => `        ${record(entry)},`),
    "    }",
    ...conditional,
    "    return catalogue",
    "end",
    "",
  ].join("\n");
  const locale = [
    "; Generated by mise run project -- py-research-dossier -- generate. Edit info.json, content/catalog.json and content/sources.json instead.",
    "[mod-name]",
    `${metadata.name}=${metadata.title}`,
    "",
    "[mod-description]",
    `${metadata.name}=${metadata.description}`,
    "",
    "[py-research-dossier]",
    "note=[font=default]__1__: __2__[/font]",
    "sources=Research references",
  ];
  for (const entry of entries) {
    locale.push(`topic-${entry.id}=${entry.topic}`);
    locale.push(`text-${entry.id}=${entry.text}`);
    const references = entry.sources
      .map((id) => {
        const source = sources[id]!;
        return `${source.title} — ${source.section}\\n${source.url}`;
      })
      .join("\\n\\n");
    locale.push(
      `refs-${entry.id}=${disciplines[entry.discipline]} — ${bases[entry.basis]}\\n\\n${references}`,
    );
  }
  return new Map([
    ["dossier/catalog.lua", lua],
    ["locale/en/py-research-dossier.cfg", locale.join("\n") + "\n"],
  ]);
}
const Compilation = Schema.Struct({
  mode: Schema.Literals(["generate", "check"]),
  dossiers: Count,
  targets: Count,
  sourceLocators: Count,
  counts: Schema.Record(Schema.String, Count),
});
export function compileContent(
  project: ResolvedProject,
  mode: "generate" | "check",
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const content = yield* loadContent(project);
    const rendered = renderContent(content, project.info);
    const run = yield* newRun(project, "content-format");
    const candidate = join(run.directory, "catalog.lua");
    yield* fs.writeFileString(candidate, rendered.get("dossier/catalog.lua")!);
    yield* withProcess(
      {
        ...run,
        command: [
          "stylua",
          "--verify",
          "--config-path",
          join(project.repoRoot, ".config/stylua.toml"),
          "--",
          candidate,
        ],
      },
      (child) => child.waitForExit,
    );
    rendered.set("dossier/catalog.lua", yield* fs.readFileString(candidate));
    for (const [path, expected] of rendered) {
      const file = join(project.modRoot, path);
      if (mode === "generate") {
        yield* assertCanonicalPath(file);
        yield* fs.writeFileString(file, expected);
      } else if (
        !(yield* fs.exists(file)) ||
        (yield* fs.readFileString(file)) !== expected
      )
        return yield* Effect.fail(
          new BoundaryError({
            boundary: path,
            message:
              "Generated content is stale; run mise run project -- py-research-dossier -- generate",
          }),
        );
    }
    const result = yield* decode(
      Compilation,
      {
        mode,
        dossiers: content.entries.length,
        targets: content.targetCount,
        sourceLocators: Object.keys(content.sources).length,
        counts: content.counts,
      },
      "content compilation",
    );
    return { content, result };
  });
}
