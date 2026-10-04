// The "@/*" -> "./src/*" alias mirrors tsconfig.json's paths mapping, which
// vitest doesn't read on its own.
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    exclude: ["**/node_modules/**", "**/.next/**", ".claude/**"],
  },
});
