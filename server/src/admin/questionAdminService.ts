import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, extname, join, posix, resolve, sep } from "node:path";
import AdmZip from "adm-zip";
import { z } from "zod";
import {
  catalogueSchema,
  imageUrl,
  questionRecordSchema,
  validateCompleteRecord,
  type CatalogueEntry,
  type QuestionRecord,
  type QuestionRepository,
} from "../question/questionRepository.js";
import { difficulties } from "../question/types.js";

type UploadedImage = { buffer: Buffer; mimetype: string; originalname: string };
const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const imageMimeExtensions = new Map([
  ["image/png", ".png"], ["image/jpeg", ".jpg"], ["image/webp", ".webp"], ["image/gif", ".gif"],
]);

export const imageMetadataSchema = z.object({
  name: z.string().trim().max(100).default(""),
  answers: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
  hint: z.string().trim().max(300).default(""),
  difficulty: z.array(z.enum(difficulties)).default([...difficulties]),
  tags: z.array(
    z.record(z.string().trim().min(1).max(50), z.string().trim().max(200))
      .refine((tag) => Object.keys(tag).length === 1, "每个原图标签必须且只能包含一个键值"),
  ).max(50).default([]),
}).strict();

const questionInputSchema = questionRecordSchema.omit({ id: true });
export type AdminQuestionRecord = QuestionRecord;

export class QuestionAdminService {
  private readonly fullDataDirectory: string;
  private readonly questionDataDirectory: string;

  constructor(private readonly resourceDirectory: string, private readonly repository: QuestionRepository) {
    this.fullDataDirectory = join(resourceDirectory, "full_data");
    this.questionDataDirectory = join(resourceDirectory, "question_data");
    mkdirSync(this.fullDataDirectory, { recursive: true });
    mkdirSync(this.questionDataDirectory, { recursive: true });
  }

  list() {
    const catalogue = this.readCatalogue();
    const validationById = new Map(this.repository.getValidationReport().items.map((item) => [item.id, item]));
    const questions = catalogue.map((entry) => {
      let info: QuestionRecord | null = null;
      try {
        info = questionRecordSchema.parse(JSON.parse(readFileSync(this.questionPath(entry.id), "utf8")));
      } catch {
        // Validation details are returned by the repository report.
      }
      const originalImage = info?.originalImage;
      return {
        id: entry.id,
        info,
        originalImageUrl: originalImage ? this.versionedImageUrl(originalImage) : null,
        validation: validationById.get(entry.id) ?? { id: entry.id, valid: false, errors: ["未校验"] },
      };
    });
    const questionsByImage = new Map<string, typeof questions>();
    for (const question of questions) {
      const name = question.info?.originalImage;
      if (!name) continue;
      const group = questionsByImage.get(name) ?? [];
      group.push(question);
      questionsByImage.set(name, group);
    }
    const images = readdirSync(this.fullDataDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && imageExtensions.has(extname(entry.name).toLowerCase()))
      .map((entry) => {
        const related = questionsByImage.get(entry.name) ?? [];
        return {
          fileName: entry.name,
          url: this.versionedImageUrl(entry.name),
          metadata: this.readImageMetadata(entry.name),
          questionIds: related.map((question) => question.id),
          validCount: related.filter((question) => question.validation.valid).length,
          invalidCount: related.filter((question) => !question.validation.valid).length,
          totalCount: related.length,
        };
      })
      .sort((left, right) => left.fileName.localeCompare(right.fileName));
    return { ...this.repository.getValidationReport(), images, questions };
  }

  createQuestion(input: unknown): string {
    const parsed = questionInputSchema.parse(input);
    if (!parsed.title || !parsed.question) throw new Error("请先填写标题并完成谜面裁切");
    this.assertImageExists(parsed.originalImage);
    const id = this.createUniqueId(parsed.title);
    const record = questionRecordSchema.parse({ ...parsed, id });
    if (record.enabled) this.assertCanEnable(record);
    this.writeJsonAtomic(this.questionPath(id), record);
    try {
      this.writeCatalogue([...this.readCatalogue(), { id, file: `question_data/${id}.json` }]);
    } catch (error) {
      rmSync(this.questionPath(id), { force: true });
      throw error;
    }
    this.repository.reload();
    return id;
  }

  updateQuestion(id: string, input: unknown): QuestionRecord {
    this.assertRegisteredId(id);
    const record = questionRecordSchema.parse({ ...questionInputSchema.parse(input), id });
    this.assertImageExists(record.originalImage);
    if (record.enabled) this.assertCanEnable(record);
    this.writeJsonAtomic(this.questionPath(id), record);
    this.repository.reload();
    return record;
  }

  addImages(files: UploadedImage[]): { added: string[]; conflicts: string[] } {
    const added: string[] = [];
    const conflicts: string[] = [];
    for (const file of files) {
      const extension = this.imageExtension(file);
      const stem = basename(file.originalname, extname(file.originalname)).replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-|-$/g, "") || "image";
      const fileName = `${stem}${extension}`;
      if (existsSync(this.imagePath(fileName))) {
        conflicts.push(fileName);
        continue;
      }
      writeFileSync(this.imagePath(fileName), file.buffer);
      this.writeJsonAtomic(this.metadataPath(fileName), {
        name: stem,
        answers: [],
        hint: "",
        difficulty: [...difficulties],
        tags: [],
      });
      added.push(fileName);
    }
    return { added, conflicts };
  }

  updateImageMetadata(fileName: string, input: unknown) {
    this.assertImageExists(fileName);
    const metadata = imageMetadataSchema.parse(input);
    this.writeJsonAtomic(this.metadataPath(fileName), metadata);
    return metadata;
  }

  exportZip(): Buffer {
    const zip = new AdmZip();
    zip.addFile("catalogue.json", Buffer.from(`${JSON.stringify(this.readCatalogue(), null, 2)}\n`));
    for (const entry of this.readCatalogue()) {
      const path = this.questionPath(entry.id);
      if (existsSync(path)) zip.addFile(entry.file, readFileSync(path));
    }
    for (const entry of readdirSync(this.fullDataDirectory, { withFileTypes: true })) {
      if (entry.isFile() && (imageExtensions.has(extname(entry.name).toLowerCase()) || extname(entry.name).toLowerCase() === ".json")) {
        zip.addFile(`full_data/${entry.name}`, readFileSync(join(this.fullDataDirectory, entry.name)));
      }
    }
    return zip.toBuffer();
  }

  importZip(buffer: Buffer) {
    const zip = new AdmZip(buffer);
    const files = new Map<string, Buffer>();
    for (const entry of zip.getEntries()) {
      const archivePath = validateArchivePath(entry.entryName);
      if (!entry.isDirectory) files.set(archivePath, entry.getData());
    }
    const cataloguePaths = [...files.keys()].filter((path) => path === "catalogue.json" || path.endsWith("/catalogue.json"));
    if (cataloguePaths.length !== 1) throw new Error("资源包中必须且只能包含一个 catalogue.json");
    const cataloguePath = cataloguePaths[0];
    const prefix = cataloguePath.slice(0, -"catalogue.json".length);
    const importedCatalogue = catalogueSchema.parse(JSON.parse(files.get(cataloguePath)!.toString("utf8")));
    const current = this.readCatalogue();
    const currentIds = new Set(current.map((entry) => entry.id));
    const conflicts: string[] = [];
    const imported: Array<{ entry: CatalogueEntry; record: QuestionRecord }> = [];
    for (const entry of importedCatalogue) {
      if (currentIds.has(entry.id)) {
        conflicts.push(entry.id);
        continue;
      }
      const recordBuffer = files.get(`${prefix}${entry.file}`);
      if (!recordBuffer) throw new Error(`题目 ${entry.id} 缺少记录文件`);
      const record = questionRecordSchema.parse(JSON.parse(recordBuffer.toString("utf8")));
      if (record.id !== entry.id) throw new Error(`题目 ${entry.id} 的记录 ID 不一致`);
      const imageData = files.get(`${prefix}full_data/${record.originalImage}`);
      if (!imageData && !existsSync(this.imagePath(record.originalImage))) throw new Error(`题目 ${entry.id} 缺少原图 ${record.originalImage}`);
      imported.push({ entry: { id: entry.id, file: `question_data/${entry.id}.json` }, record });
    }
    for (const [path, data] of files) {
      if (!path.startsWith(`${prefix}full_data/`)) continue;
      const name = path.slice(`${prefix}full_data/`.length);
      if (!name || name !== basename(name) || (!imageExtensions.has(extname(name).toLowerCase()) && extname(name).toLowerCase() !== ".json")) continue;
      if (!existsSync(join(this.fullDataDirectory, name))) writeFileSync(join(this.fullDataDirectory, name), data);
    }
    for (const item of imported) this.writeJsonAtomic(this.questionPath(item.entry.id), item.record);
    this.writeCatalogue([...current, ...imported.map((item) => item.entry)]);
    this.repository.reload();
    return { importedIds: imported.map((item) => item.entry.id), conflicts, report: this.repository.getValidationReport() };
  }

  private assertCanEnable(record: QuestionRecord): void {
    const errors = validateCompleteRecord(record, this.fullDataDirectory);
    if (errors.length) throw new Error(`题目 ${record.id} 信息未补全：${errors.join("、")}`);
  }

  private readCatalogue(): CatalogueEntry[] {
    return catalogueSchema.parse(JSON.parse(readFileSync(join(this.resourceDirectory, "catalogue.json"), "utf8")));
  }

  private writeCatalogue(value: CatalogueEntry[]): void {
    this.writeJsonAtomic(join(this.resourceDirectory, "catalogue.json"), catalogueSchema.parse(value));
  }

  private readImageMetadata(fileName: string) {
    const path = this.metadataPath(fileName);
    if (!existsSync(path)) return imageMetadataSchema.parse({});
    try {
      return imageMetadataSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    } catch {
      return imageMetadataSchema.parse({});
    }
  }

  private createUniqueId(title: string): string {
    const base = title.normalize("NFKC").trim().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 60) || "question";
    const existing = new Set(this.readCatalogue().map((entry) => entry.id));
    if (!existing.has(base)) return base;
    for (let index = 2; index < 10_000; index += 1) {
      const candidate = `${base}-${index}`;
      if (!existing.has(candidate)) return candidate;
    }
    throw new Error("无法生成唯一题目 ID");
  }

  private assertRegisteredId(id: string): void {
    if (!this.readCatalogue().some((entry) => entry.id === id)) throw new Error("题目不存在或未注册");
  }

  private assertImageExists(fileName: string): void {
    if (!fileName || fileName !== basename(fileName) || !imageExtensions.has(extname(fileName).toLowerCase())) throw new Error("原图文件名不合法");
    if (!existsSync(this.imagePath(fileName))) throw new Error(`原图不存在：${fileName}`);
  }

  private imageExtension(file: UploadedImage): string {
    const extension = imageMimeExtensions.get(file.mimetype) ?? extname(file.originalname).toLowerCase();
    if (!imageExtensions.has(extension)) throw new Error("只允许上传 PNG、JPG、WEBP 或 GIF 图片");
    return extension;
  }

  private questionPath(id: string): string {
    if (!/^[\p{L}\p{N}][\p{L}\p{N}._-]{0,79}$/u.test(id)) throw new Error(`非法题目 ID：${id}`);
    const target = resolve(this.questionDataDirectory, `${id}.json`);
    if (!target.startsWith(resolve(this.questionDataDirectory) + sep)) throw new Error("题目路径超出 question_data 目录");
    return target;
  }

  private imagePath(name: string): string { return join(this.fullDataDirectory, basename(name)); }
  private metadataPath(imageName: string): string { return join(this.fullDataDirectory, `${basename(imageName, extname(imageName))}.json`); }
  private versionedImageUrl(name: string): string { return `${imageUrl(name)}?v=${Date.now()}`; }

  private writeJsonAtomic(path: string, value: unknown): void {
    const temporaryPath = `${path}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    renameSync(temporaryPath, path);
  }
}

export function validateArchivePath(input: string): string {
  const normalized = input.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) throw new Error(`ZIP 包含非法路径：${input}`);
  const parts = normalized.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) throw new Error(`ZIP 包含路径穿越：${input}`);
  const safePath = posix.normalize(parts.join("/"));
  if (safePath.startsWith("../") || safePath === "..") throw new Error(`ZIP 包含路径穿越：${input}`);
  return safePath;
}
