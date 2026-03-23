import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/orchestrator/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: `${process.env.OPENWREN_HOME || `${process.env.HOME}/.openwren`}/data/workflows.db`,
  },
});
