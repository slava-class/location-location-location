import { Console, Effect, Option } from "effect";
import { Command, Flag } from "effect/cli";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ProjectTooling } from "../../../tools/project-tooling.ts";
import { BoundaryError, readJSON } from "../../../tools/projects.ts";
import type { ResolvedProject } from "../../../tools/projects.ts";
import { AuditMode, auditCorpus, runAudit } from "./audit.ts";
import { auditScope, readFlags } from "./audit-model.mjs";
import { compileContent } from "./content.ts";
import { Families, ReferenceContext } from "./contracts.ts";
import { reviewSources } from "./prepare.ts";
import { provisionPyHelper } from "./py-helper.ts";
import { replayHistorical } from "./replay.mjs";

function commands(project: ResolvedProject) {
  const compilation = (mode: "generate" | "check") =>
    Command.make(mode, {}, () =>
      compileContent(project, mode).pipe(
        Effect.flatMap(({ result }) =>
          Console.log(JSON.stringify(result, null, 2)),
        ),
      ),
    );
  const audit = (mode: typeof AuditMode.Type) =>
    Command.make(
      mode,
      {
        profile: Flag.String("profile").pipe(
          Flag.withDefault(
            join(homedir(), "Library/Application Support/factorio"),
          ),
        ),
        log: Flag.String("log").pipe(Flag.optional),
        save: Flag.String("save").pipe(Flag.withDefault("latest")),
        reference: Flag.String("reference").pipe(
          Flag.withDefault("content/reference-context.json"),
        ),
        families: Flag.String("families").pipe(
          Flag.withDefault("content/audit-families.json"),
        ),
        sinceReport: Flag.String("since-report").pipe(Flag.optional),
        out: Flag.String("out").pipe(Flag.withDefault("audits")),
      },
      (values) =>
        Effect.gen(function* () {
          const log = Option.getOrUndefined(values.log),
            sinceReport = Option.getOrUndefined(values.sinceReport);
          const result = yield* runAudit(project, {
            mode,
            profile: resolve(values.profile),
            out: resolve(project.outputRoot, values.out),
            save: values.save === "latest" ? "latest" : resolve(values.save),
            reference: resolve(project.modRoot, values.reference),
            families: resolve(project.modRoot, values.families),
            ...(log === undefined ? {} : { log: resolve(log) }),
            ...(sinceReport === undefined
              ? {}
              : { sinceReport: resolve(sinceReport) }),
          });
          if (result.evidenceIssues > 0) process.exitCode = 2;
        }),
    );
  const sources = Command.make(
    "review-sources",
    { mods: Flag.String("mods"), base: Flag.String("base") },
    (values) =>
      reviewSources(project, {
        mods: resolve(values.mods),
        base: resolve(values.base),
      }).pipe(
        Effect.flatMap((result) =>
          Console.log(JSON.stringify(result, null, 2)),
        ),
      ),
  ).pipe(
    Command.withDescription(
      "Read explicitly selected, checksum-pinned upstream sources; never launch Factorio",
    ),
  );
  const replay = Command.make(
    "replay",
    { raw: Flag.String("raw"), snapshot: Flag.String("snapshot") },
    (values) =>
      replayHistorical(project, {
        raw: resolve(values.raw),
        snapshot: resolve(values.snapshot),
      }).pipe(
        Effect.flatMap(({ output, report }) =>
          Console.log(
            JSON.stringify(
              {
                output,
                kind: report.kind,
                targets: report.targets,
                placementPairs: report.placementPairs,
                craftingRecipes: report.craftingRecipes,
              },
              null,
              2,
            ),
          ),
        ),
      ),
  ).pipe(
    Command.withDescription(
      "Replay the reviewed historical prototype capture offline; not current engine or visual proof",
    ),
  );
  return Command.make(project.info.name).pipe(
    Command.withSubcommands([
      compilation("generate"),
      compilation("check"),
      ...AuditMode.literals.map(audit),
      sources,
      replay,
    ]),
  );
}
export default {
  setup: (project) => provisionPyHelper(project).pipe(Effect.asVoid),
  audit: ({ project }) =>
    Effect.gen(function* () {
      const { content } = yield* auditCorpus(project);
      const context = yield* readJSON(
        ReferenceContext,
        join(project.modRoot, "content/reference-context.json"),
      );
      const families = yield* readJSON(
        Families,
        join(project.modRoot, "content/audit-families.json"),
      );
      yield* Effect.try({
        try: () =>
          auditScope({
            flags: readFlags(new Uint8Array()),
            content,
            context,
            families,
            progress: null,
          }),
        catch: (error) =>
          new BoundaryError({
            boundary: "Polytechnic relationship reference",
            message: String(error),
          }),
      });
    }),
  command: ({ project, args }) =>
    Command.runWith(commands(project), { version: project.info.version })(args),
} satisfies ProjectTooling;
