import { Effect, FileSystem } from "effect";
import { join } from "node:path";
import { defineProjectTooling } from "../../../tools/project-tooling.ts";
import { BoundaryError } from "../../../tools/projects.ts";

export default defineProjectTooling({
  audit: function audit({ project, members, english }) {
    return Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      for (const name of members.filter(
        (name) =>
          name === "control.lua" ||
          name === "data.lua" ||
          (name.startsWith("location_location_location/") &&
            name.endsWith(".lua")),
      )) {
        const source = yield* fs.readFileString(join(project.modRoot, name));
        for (const pattern of [
          /ui\.caption\("([\w-]+)"/g,
          /"location-location-location\.([\w-]+)"/g,
        ])
          for (const match of source.matchAll(pattern))
            if (!english.has("location-location-location." + match[1]))
              return yield* Effect.fail(
                new BoundaryError({
                  boundary: name,
                  message: `Unknown locale key ${match[1]}`,
                }),
              );
        if (
          (name === "data.lua" || name.endsWith("gui/appearance.lua")) &&
          /__location-location-location__.*\.(png|jpg)/.test(source)
        )
          return yield* Effect.fail(
            new BoundaryError({
              boundary: name,
              message: "Custom action artwork violates the native-icon policy",
            }),
          );
      }
      for (const name of ["open_planner", "highlight_sources", "focus_search"])
        if (!english.has("controls.location_location_location_" + name))
          return yield* Effect.fail(
            new BoundaryError({
              boundary: project.info.name,
              message: `Missing localized control ${name}`,
            }),
          );
    });
  },
});
