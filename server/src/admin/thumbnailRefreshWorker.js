import { existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { renderQuestionThumbnail } from "./thumbnailRenderer.js";

export async function runThumbnailPrecompute(manifest) {
  const items = JSON.parse(readFileSync(manifest, "utf8"));
  for (const item of items) {
    if (existsSync(item.target)) {
      process.stdout.write(`${JSON.stringify({ type: "result", key: item.key, ok: true })}\n`);
      continue;
    }
    process.stdout.write(`${JSON.stringify({ type: "active", key: item.key })}\n`);
    const temporary = `${item.target}.${process.pid}.${randomUUID()}.tmp`;
    let ok = false;
    try {
      const image = await renderQuestionThumbnail(item.source, item.crop);
      await writeFile(temporary, image);
      try { renameSync(temporary, item.target); }
      catch (error) { if (!existsSync(item.target)) throw error; }
      ok = true;
    } catch {
      // Failed images are reported to the parent; other images still continue.
    } finally {
      rmSync(temporary, { force: true });
    }
    process.stdout.write(`${JSON.stringify({ type: "result", key: item.key, ok })}\n`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runThumbnailPrecompute(process.argv[2]).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
