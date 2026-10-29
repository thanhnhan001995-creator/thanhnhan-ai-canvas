import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./data/drizzle",
  schema: "./data/db/schema.ts",
  dialect: "sqlite",
});
