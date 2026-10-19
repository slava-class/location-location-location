import type { DevelopmentConfig } from "../../tools/projects.ts";

export default {
  visual: true,
  persistence: "stateful",
  profiles: ["base", "space-age"],
  storageType: "RUBDStorage",
  luaTypecheckIgnore: ["tests/undergrounds.lua"],
  tuners: ["warnings"],
  performance: "dev/performance/scenarios.json",
  native: {
    suite: "underground native",
    scenes: [
      {
        name: "01 reversed-underground",
        file: "release-ui/01-reversed-underground.png",
      },
    ],
    gallerySuite: "Underground detector gallery",
    gallery: [
      {
        name: "01 reversed-underground",
        file: "gallery/01-reversed-underground.png",
      },
    ],
    gallerySelection: ["gallery/01-reversed-underground.png"],
  },
} satisfies DevelopmentConfig;
