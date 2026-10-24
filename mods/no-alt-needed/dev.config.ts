import type { DevelopmentConfig } from "../../tools/projects.ts";

export default {
  visual: true,
  verification: "engine",
  profiles: ["base", "space-age", "py-hardmode"],
  persistence: "stateful",
  storageType: "NoAltNeededStorage",
  performance: "dev/performance/scenarios.json",
  verificationDependencies: [
    "pYBetterItemFluidStorageIcons",
    "assemblyanalyst",
    "belt-direction-indicator",
    "belt-visualizer",
    "heat-visualizer",
    "UndergroundIndicatorsFixed",
    "inserter-throughput-fork",
    "fluid-connection-indicators",
  ],
  native: {
    suite: "native presentation",
    scenes: [
      {
        name: "hover nearby recipes and cleanup",
        file: "native/hover-nearby.png",
      },
      {
        name: "configuration and large module geometry",
        file: "native/module-geometry.png",
      },
      { name: "fluid construction context", file: "native/fluid-context.png" },
      {
        name: "live experiments preserve world inspection and canonical preferences",
        file: "native/experiments.png",
      },
    ],
    gallerySuite: "portal gallery",
    gallery: [
      {
        name: "unlocked refinery context",
        file: "gallery/refinery-context.png",
      },
    ],
    gallerySelection: ["gallery/refinery-context.png"],
  },
} satisfies DevelopmentConfig;
