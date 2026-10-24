import type { DevelopmentConfig } from "../../tools/projects.ts";

export default {
  visual: true,
  persistence: "stateful",
  profiles: ["base", "space-age"],
  storageType: "RecipeNameTooltipStorage",
  native: {
    suite: "recipe tooltip native",
    scenes: [{ name: "01 recipe-name", file: "release-ui/01-recipe-name.png" }],
    gallerySuite: "Recipe tooltip gallery",
    gallery: [{ name: "01 recipe-name", file: "gallery/01-recipe-name.png" }],
    gallerySelection: [],
  },
} satisfies DevelopmentConfig;
