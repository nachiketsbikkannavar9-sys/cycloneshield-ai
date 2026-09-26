import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@cycloneshield/shared": resolve(
        process.cwd(),
        "packages/shared/src/index.ts",
      ),
    },
  },
  test: {
    environment: "node",
    include: [
      "apps/**/*.test.ts",
      "apps/**/*.test.tsx",
      "packages/**/*.test.ts",
    ],
    passWithNoTests: true,
    reporters: ["default"],
  },
});
