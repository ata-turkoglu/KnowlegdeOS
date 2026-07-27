import assert from "node:assert/strict";
import test from "node:test";

function assertTestDatabase(url: string | undefined) {
  if (!url) throw new Error("TEST_DATABASE_URL is required for integration tests; development and production databases are refused.");
  const database = new URL(url).pathname.replace(/^\//, "").split("/").at(-1) ?? "";
  if (!database.endsWith("_test")) throw new Error("TEST_DATABASE_URL must target a database whose name ends in _test.");
}
test("integration database guard", (t) => { if (!process.env.TEST_DATABASE_URL) { t.skip("TEST_DATABASE_URL is absent; no database was touched."); return; } assert.doesNotThrow(() => assertTestDatabase(process.env.TEST_DATABASE_URL)); });
