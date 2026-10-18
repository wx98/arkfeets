import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const stateDir = join(root, ".runtime");
const stateFile = join(stateDir, "server.json");
const node = join(root, "runtime", "node", "node.exe");
const python = join(root, "runtime", "python", "python.exe");
const entry = join(root, "server", "dist", "index.js");
const port = Number(process.env.PORT || 3000);
const url = (value) => `http://127.0.0.1:${value}`;

async function readHealth(value) {
  try {
    const response = await fetch(`${url(value)}/api/health`, { signal: AbortSignal.timeout(1000) });
    return response.ok ? await response.json() : null;
  } catch { return null; }
}

async function checkPort() {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", () => probe.close(resolve));
  });
}

function openBrowser(value) {
  if (process.env.ARKFEETS_NO_BROWSER === "1") return;
  const browser = spawn("cmd.exe", ["/d", "/s", "/c", `start "" "http://localhost:${value}"`], {
    detached: true, windowsHide: true, stdio: "ignore",
  });
  browser.on("error", () => console.log(`Open http://localhost:${value} in a browser.`));
  browser.unref();
}

async function main() {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be between 1 and 65535.");
  for (const file of [node, python, entry, join(root, "server", "config.json")]) {
    if (!existsSync(file)) throw new Error(`Missing package file: ${file}`);
  }
  if (existsSync(stateFile)) {
    const previous = JSON.parse(readFileSync(stateFile, "utf8"));
    const health = await readHealth(previous.port);
    if (health?.instanceId && health.instanceId === previous.instanceId) {
      console.log(`Already running: http://localhost:${previous.port}`);
      openBrowser(previous.port);
      return;
    }
    unlinkSync(stateFile);
  }
  await checkPort();
  mkdirSync(stateDir, { recursive: true });
  const stdout = openSync(join(stateDir, "stdout.log"), "a");
  const stderr = openSync(join(stateDir, "stderr.log"), "a");
  const instanceId = randomUUID();
  const child = spawn(node, [entry], {
    cwd: root, detached: true, windowsHide: true, stdio: ["ignore", stdout, stderr],
    env: { ...process.env, HOST: process.env.HOST || "0.0.0.0", PORT: String(port), ARKFEETS_PYTHON: python, ARKFEETS_INSTANCE_ID: instanceId },
  });
  closeSync(stdout);
  closeSync(stderr);
  if (!child.pid) throw new Error("Could not start the server process.");
  let exited = false;
  child.once("exit", () => { exited = true; });
  child.unref();
  for (let attempt = 0; attempt < 100 && !exited; attempt++) {
    const health = await readHealth(port);
    if (health?.instanceId === instanceId) {
      writeFileSync(stateFile, JSON.stringify({ pid: child.pid, port, instanceId }), "utf8");
      console.log(`Ready: http://localhost:${port}`);
      openBrowser(port);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!exited) process.kill(child.pid);
  throw new Error(`Startup failed. See ${join(stateDir, "stderr.log")}`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
