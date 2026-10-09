import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

const resource = resolve(import.meta.dirname, "../resource");
const cataloguePath = join(resource, "catalogue.json");
const topicPath = join(resource, "topic.json");
if (existsSync(topicPath)) {
  const existing = JSON.parse(readFileSync(topicPath, "utf8"));
  if (existing.length !== 1 || existing[0]?.id !== "脚") throw new Error("现有主题不止脚，迁移已停止");
}
const catalogue = JSON.parse(readFileSync(cataloguePath, "utf8"));
const topics = [{ id: "脚", name: "脚", isDefault: true }];
const records = catalogue.map((entry) => {
  const path = resolve(resource, entry.file);
  if (!path.startsWith(join(resource, "question_data") + sep)) throw new Error(`非法题目路径：${entry.file}`);
  const record = JSON.parse(readFileSync(path, "utf8"));
  if (record.id !== entry.id) throw new Error(`题目 ID 不匹配：${entry.id}`);
  return { path, record };
});
const occupied = new Set();
for (const { record } of records) {
  if (occupied.has(record.originalImage)) throw new Error(`脚主题中原图重复：${record.originalImage}`);
  occupied.add(record.originalImage);
}
function writeJson(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}
for (const { path, record } of records) {
  if (record.title.endsWith("-脚")) writeJson(path, { ...record, title: record.title.slice(0, -2) });
}
writeJson(topicPath, topics);
writeJson(cataloguePath, catalogue.map((entry) => ({ ...entry, topic: ["脚"] })));
console.log(`已迁移 ${records.length} 道题目到脚主题`);
