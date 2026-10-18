import { renameSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { parentPort } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import { renderQuestionThumbnail } from "./thumbnailRenderer.js";

async function run(items) {
  for (const item of items) {
    const temporary = `${item.target}.${process.pid}.${randomUUID()}.tmp`;
    let ok = false;
    try {
      const image = await renderQuestionThumbnail(item.source, item.crop);
      await writeFile(temporary, image);
      renameSync(temporary, item.target);
      ok = true;
    } catch {
      // The previous cached image remains available when rebuilding fails.
    } finally {
      rmSync(temporary, { force: true });
    }
    if (globalThis.Bun) globalThis.postMessage({ key: item.key, ok });
    else parentPort?.postMessage({ key: item.key, ok });
  }
}

if (globalThis.Bun) {
  globalThis.onmessage = (event) => {
    void run(event.data).then(() => globalThis.postMessage({ done: true })).catch((error) => { throw error; });
  };
} else {
  parentPort?.on("message", (items) => {
    void run(items).then(() => { parentPort.postMessage({ done: true }); parentPort.close(); }).catch((error) => { throw error; });
  });
}
