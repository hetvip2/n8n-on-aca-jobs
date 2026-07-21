import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temporaryDirectory = mkdtempSync(join(tmpdir(), "n8n-aca-package-"));
try {
  const npmExecutable = process.env.npm_execpath;
  if (!npmExecutable)
    throw new Error("npm_execpath is unavailable; run this check through npm.");
  const output = execFileSync(
    process.execPath,
    [npmExecutable, "pack", "--json", "--pack-destination", temporaryDirectory],
    { encoding: "utf8" },
  );
  const [{ filename, files }] = JSON.parse(output);
  const included = new Set(files.map((file) => file.path));
  const required = [
    "dist/credentials/AzureContainerAppsJobsApi.credentials.js",
    "dist/nodes/AzureContainerAppsJobs/AzureContainerAppsJobs.node.js",
    "dist/src/aca-jobs-client.js",
    "LICENSE",
    "README.md",
    "workflows/single-job.json",
    "workflows/fan-out-fan-in.json",
  ];
  const missing = required.filter((file) => !included.has(file));
  if (missing.length > 0)
    throw new Error(`Package is missing: ${missing.join(", ")}`);

  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  for (const entry of [...manifest.n8n.credentials, ...manifest.n8n.nodes]) {
    if (!included.has(entry))
      throw new Error(`n8n entry is not packaged: ${entry}`);
  }
  console.log(`Package check passed: ${filename} (${files.length} files).`);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
