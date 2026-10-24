import { Command, Flag } from "effect/cli";
import { Schema } from "effect";
import { resolve } from "node:path";
import type { ProjectTooling } from "../../../tools/project-tooling.ts";
import { TestProfile } from "../../../tools/projects.ts";
import { GraphicsPreset } from "../../../tools/engine.ts";
import { FluidPolicy, verifyNative } from "./verification.ts";

export default {
  command: ({ project, args }) =>
    Command.runWith(
      Command.make(project.info.name).pipe(
        Command.withSubcommands([
          Command.make(
            "verify-native",
            {
              engine: Flag.String("engine"),
              graphics: Flag.String("graphics").pipe(
                Flag.withSchema(
                  Schema.String.pipe(Schema.decodeTo(GraphicsPreset)),
                ),
                Flag.withDefault("low"),
              ),
              profile: Flag.String("profile").pipe(
                Flag.withSchema(
                  Schema.String.pipe(Schema.decodeTo(TestProfile)),
                ),
                Flag.withDefault("base"),
              ),
              retained: Flag.Boolean("retained").pipe(Flag.withDefault(false)),
              layout: Flag.Boolean("layout").pipe(Flag.withDefault(false)),
              lifecycle: Flag.Boolean("lifecycle").pipe(
                Flag.withDefault(false),
              ),
              fluidPolicy: Flag.String("fluid-policy").pipe(
                Flag.withSchema(
                  Schema.String.pipe(Schema.decodeTo(FluidPolicy)),
                ),
                Flag.withDefault("declutter"),
              ),
              interactive: Flag.Boolean("interactive").pipe(
                Flag.withDefault(false),
              ),
            },
            (options) =>
              verifyNative(project, {
                ...options,
                engine: resolve(options.engine),
              }),
          ).pipe(
            Command.withDescription(
              "Verify the exact package with real en/de clients, fresh-process reload and optional insertion/removal or retained-QoL coverage. Never changes the normal profile.",
            ),
          ),
        ]),
      ),
      { version: project.info.version },
    )(args),
} satisfies ProjectTooling;
