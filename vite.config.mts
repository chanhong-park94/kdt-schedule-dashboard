/// <reference types="vitest/config" />

import { defineConfig } from "vite";

export default defineConfig({
  // GitHub Pages는 /<repo>/ 경로로 서비스되므로 base가 필요합니다.
  // Repo name: kdt-schedule-dashboard
  base: "/kdt-schedule-dashboard/",

  root: "src",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  test: {
    include: ["../tests/**/*.test.ts", "tests/**/*.test.ts"],
  },
});