import { BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import { resolve } from "node:path";
import { resolveProject } from "../../../tools/projects.ts";
import { helperSource as descriptionHelper } from "./py-helper.ts";
import { runLua as executeLua } from "./lua.ts";

const repository = resolve(import.meta.dir, "../../..");
export const project = await Effect.runPromise(
  resolveProject(repository, "py-research-dossier", repository).pipe(
    Effect.provide(BunServices.layer),
  ),
);
export const helperSource = () =>
  Effect.runPromise(
    descriptionHelper(project).pipe(Effect.provide(BunServices.layer)),
  );
export const runLua = (source: string) =>
  Effect.runPromise(
    executeLua(project, source).pipe(Effect.provide(BunServices.layer)),
  );
