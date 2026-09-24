import { spawnSync } from "node:child_process";

const testDatabaseUrl = process.env.HANGOUT_TEST_DATABASE_URL;
if (!testDatabaseUrl || testDatabaseUrl === process.env.DATABASE_URL) {
  console.error(
    "Hangout integration tests require HANGOUT_TEST_DATABASE_URL pointing to a separate, disposable database. They must not run against the live development database.",
  );
  process.exit(1);
}

const build = spawnSync("esbuild", [
  "./src/lib/ash/hangout.integration.test.ts",
  "--bundle",
  "--platform=node",
  "--format=cjs",
  "--outfile=/tmp/stillwater-hangout.integration.test.cjs",
], { stdio: "inherit" });
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);

const run = spawnSync(process.execPath, [
  "--test",
  "/tmp/stillwater-hangout.integration.test.cjs",
], {
  stdio: "inherit",
  env: {
    ...process.env,
    DATABASE_URL: testDatabaseUrl,
    NODE_ENV: "production",
  },
});
if (run.error) throw run.error;
process.exit(run.status ?? 1);