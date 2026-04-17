// Entry point for the MV3 service worker.
// All logic lives in src/background/sw.ts — this file exists solely
// because manifest.json references "src/background.ts" as the SW entry.
export * from "./background/sw";
