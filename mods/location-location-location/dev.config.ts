import type { DevelopmentConfig } from "../../tools/projects.ts";

export default {
  visual: true,
  persistence: "stateful",
  profiles: ["base", "space-age"],
  storageType: "LLLStorage",
  flibStyleType: "LLLStyleMods",
  luaTypecheckIgnore: ["tests/planner.lua"],
  native: {
    suite: "native UI gallery",
    scenes: [
      { name: "01 list", file: "release-ui/01-list.png" },
      { name: "02 editor", file: "release-ui/02-editor.png" },
      { name: "03 pinned", file: "release-ui/03-pinned.png" },
      { name: "04 picker", file: "release-ui/04-picker.png" },
      { name: "05 no-results", file: "release-ui/05-no-results.png" },
      { name: "06 delete-confirm", file: "release-ui/06-delete-confirm.png" },
      { name: "07 retired", file: "release-ui/07-retired.png" },
      { name: "08 error", file: "release-ui/08-error.png" },
      { name: "09 sourcefree", file: "release-ui/09-sourcefree.png" },
    ],
    gallerySuite: "Mod Portal gallery",
    gallery: [
      { name: "01 source-survey", file: "gallery/01-source-survey.png" },
      { name: "02 planner", file: "gallery/02-planner.png" },
      { name: "03 recipe-picker", file: "gallery/03-recipe-picker.png" },
      { name: "04 marker-placement", file: "gallery/04-marker-placement.png" },
      {
        name: "05 recipe-alternatives",
        file: "gallery/05-recipe-alternatives.png",
      },
    ],
    gallerySelection: [
      "gallery/02-planner.png",
      "gallery/01-source-survey.png",
    ],
  },
} satisfies DevelopmentConfig;
