import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const stateFile = join(root, ".runtime", "server.json");

async function main() {
  if (!existsSync(stateFile)) {
    console.log("The application is not running.");
    return;
  }
  const instance = JSON.parse(readFileSync(stateFile, "utf8"));
  const response = await fetch(`http://127.0.0.1:${instance.port}/api/health`, { signal: AbortSignal.timeout(2000) }).catch(() => null);
  const health = response?.ok ? await response.json() : null;
  if (health?.instanceId !== instance.instanceId) {
    throw new Error("Cannot verify this process belongs to the package. It was not stopped.");
  }
  process.kill(instance.pid);
  unlinkSync(stateFile);
  console.log(`Stopped application process ${instance.pid}.`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
