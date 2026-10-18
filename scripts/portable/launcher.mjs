import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";

const root = dirname(process.execPath);
const stateDirectory = join(root, ".runtime");
const stateFile = join(stateDirectory, "server.json");
const port = Number(process.env.PORT || 3000);

async function health(value) {
  try {
    const response = await fetch(`http://127.0.0.1:${value}/api/health`, { signal: AbortSignal.timeout(1000) });
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

async function start() {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be between 1 and 65535.");
  for (const file of [join(root, "server", "config.json"), join(root, "server", "resource", "catalogue.json"), join(root, "web", "dist", "index.html")]) {
    if (!existsSync(file)) throw new Error(`Missing package file: ${file}`);
  }
  if (existsSync(stateFile)) {
    const previous = JSON.parse(readFileSync(stateFile, "utf8"));
    const running = await health(previous.port);
    if (running?.instanceId === previous.instanceId) {
      console.log(`Already running: http://localhost:${previous.port}`);
      openBrowser(previous.port);
      return;
    }
    unlinkSync(stateFile);
  }
  await checkPort();
  mkdirSync(stateDirectory, { recursive: true });
  const stdout = openSync(join(stateDirectory, "stdout.log"), "a");
  const stderr = openSync(join(stateDirectory, "stderr.log"), "a");
  const instanceId = randomUUID();
  const child = spawn(process.execPath, ["--serve"], {
    cwd: root, detached: true, windowsHide: true, stdio: ["ignore", stdout, stderr],
    env: { ...process.env, HOST: process.env.HOST || "0.0.0.0", PORT: String(port), ARKFEETS_APP_ROOT: root, ARKFEETS_INSTANCE_ID: instanceId },
  });
  closeSync(stdout);
  closeSync(stderr);
  if (!child.pid) throw new Error("Could not start the server process.");
  let exited = false;
  child.once("exit", () => { exited = true; });
  child.unref();
  for (let attempt = 0; attempt < 100 && !exited; attempt += 1) {
    const running = await health(port);
    if (running?.instanceId === instanceId) {
      writeFileSync(stateFile, JSON.stringify({ pid: child.pid, port, instanceId }), "utf8");
      console.log(`Ready: http://localhost:${port}`);
      openBrowser(port);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!exited) process.kill(child.pid);
  throw new Error(`Startup failed. See ${join(stateDirectory, "stderr.log")}`);
}

async function stop() {
  if (!existsSync(stateFile)) {
    console.log("The application is not running.");
    return;
  }
  const instance = JSON.parse(readFileSync(stateFile, "utf8"));
  const running = await health(instance.port);
  if (running?.instanceId !== instance.instanceId) {
    throw new Error("Cannot verify this process belongs to the package. It was not stopped.");
  }
  process.kill(instance.pid);
  unlinkSync(stateFile);
  console.log(`Stopped application process ${instance.pid}.`);
}

try {
  const action = process.argv[2];
  if (action === "--start") await start();
  else if (action === "--stop") await stop();
  else if (action === "--serve") {
    process.env.ARKFEETS_APP_ROOT = root;
    await import("../../server/dist/index.js");
  } else if (action === "--thumbnail-precompute") {
    const { runThumbnailPrecompute } = await import("../../server/dist/admin/thumbnailRefreshWorker.js");
    await runThumbnailPrecompute(process.argv[3]);
  } else throw new Error("Use --start or --stop.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
