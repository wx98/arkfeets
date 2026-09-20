import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
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
  private readonly questionTrashDirectory: string;
  // 题库文件解析结果缓存：key 为文件绝对路径，mtime/size 变化时才重新读盘。
  // 题库规模达到千级后，每次请求全量同步读盘 + zod 解析是读取变慢的根因。
  private readonly parsedFileCache = new Map<string, { mtimeMs: number; size: number; value: unknown }>();
  private listCache: { generation: string; value: ReturnType<QuestionAdminService["buildLibrary"]> } | null = null;

  constructor(private readonly resourceDirectory: string, private readonly repository: QuestionRepository) {
    this.fullDataDirectory = join(resourceDirectory, "full_data");
    this.questionDataDirectory = join(resourceDirectory, "question_data");
    this.questionTrashDirectory = join(resourceDirectory, "question_trash");
    mkdirSync(this.fullDataDirectory, { recursive: true });
    mkdirSync(this.questionDataDirectory, { recursive: true });
    mkdirSync(this.questionTrashDirectory, { recursive: true });
  }

  list() {
    // 读取结果整体缓存：资源代际（目录与 catalogue 的时间戳）未变化且无本服务写入时直接复用，
    // 千级原图题库下避免每次请求都全量 stat + 读盘 + 解析。
    // 代际校验可捕捉手工增删文件；外部直接改写已有 JSON 内容需重启服务或经过任意后台写操作后生效。
    const generation = this.resourceGeneration();
    if (this.listCache?.generation === generation) return this.listCache.value;
    const value = this.buildLibrary();
    this.listCache = { generation, value };
    return value;
  }

  private buildLibrary() {
    const catalogue = this.readCatalogue();
    const report = this.repository.getValidationReport();
    const validationById = new Map(report.items.map((item) => [item.id, item]));
    const questions = catalogue.map((entry) => {
      let info: QuestionRecord | null = null;
      try {
        info = this.readJsonCached(this.questionPath(entry.id), (raw) => questionRecordSchema.parse(raw));
      } catch {
        // Validation details are returned by the repository report.
      }
      const originalImage = info?.originalImage;
      return {
        id: entry.id,
        info,
        originalImageUrl: originalImage ? imageUrl(originalImage) : null,
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
          url: imageUrl(entry.name),
          metadata: this.readImageMetadata(entry.name),
          questionIds: related.map((question) => question.id),
          validCount: related.filter((question) => question.validation.valid).length,
          invalidCount: related.filter((question) => !question.validation.valid).length,
          totalCount: related.length,
        };
      })
      .sort((left, right) => left.fileName.localeCompare(right.fileName));
    return { ...report, images, questions, trash: this.listTrash() };
  }

  createQuestion(input: unknown): string {
    const parsed = questionInputSchema.parse(input);
    if (!parsed.title || !parsed.question) throw new Error("请先填写标题并完成谜面裁切");
    this.assertImageExists(parsed.originalImage);
    const id = this.deriveQuestionId(parsed.title);
    const record = questionRecordSchema.parse({ ...parsed, id });
    if (record.enabled) this.assertCanEnable(record);
    this.writeJsonAtomic(this.questionPath(id), record);
    try {
      this.writeCatalogue([...this.readCatalogue(), { id, file: `question_data/${id}.json` }]);
    } catch (error) {
      rmSync(this.questionPath(id), { force: true });
      throw error;
    }
    this.listCache = null;
    this.repository.reload();
    return id;
  }

  updateQuestion(id: string, input: unknown): QuestionRecord {
    this.assertRegisteredId(id);
    const record = questionRecordSchema.parse({ ...questionInputSchema.parse(input), id });
    this.assertImageExists(record.originalImage);
    if (record.enabled) this.assertCanEnable(record);
    this.writeJsonAtomic(this.questionPath(id), record);
    this.listCache = null;
    this.repository.reload();
    return record;
  }

  deleteQuestion(id: string): { id: string; trashId: string } {
    this.assertRegisteredId(id);
    const catalogue = this.readCatalogue();
    const trashId = `${id}--${Date.now()}`;
    const questionPath = this.questionPath(id);
    const trashPath = this.trashPath(trashId);
    renameSync(questionPath, trashPath);
    this.parsedFileCache.delete(questionPath);
    this.parsedFileCache.delete(trashPath);
    try {
      this.writeCatalogue(catalogue.filter((entry) => entry.id !== id));
    } catch (error) {
      renameSync(trashPath, questionPath);
      throw error;
    }
    this.listCache = null;
    this.repository.reload();
    return { id, trashId };
  }

  restoreQuestion(trashId: string): { id: string } {
    const trashPath = this.trashPath(trashId);
    if (!existsSync(trashPath)) throw new Error("回收站题目不存在");
    const record = questionRecordSchema.parse(JSON.parse(readFileSync(trashPath, "utf8")));
    if (this.readCatalogue().some((entry) => entry.id === record.id) || existsSync(this.questionPath(record.id))) {
      throw new Error(`无法还原：题目 ID ${record.id} 已被使用`);
    }
    const questionPath = this.questionPath(record.id);
    renameSync(trashPath, questionPath);
    this.parsedFileCache.delete(trashPath);
    this.parsedFileCache.delete(questionPath);
    try {
      this.writeCatalogue([...this.readCatalogue(), { id: record.id, file: `question_data/${record.id}.json` }]);
    } catch (error) {
      renameSync(questionPath, trashPath);
      throw error;
    }
    this.listCache = null;
    this.repository.reload();
    return { id: record.id };
  }

  permanentlyDeleteQuestion(trashId: string): { trashId: string } {
    const path = this.trashPath(trashId);
    if (!existsSync(path)) throw new Error("回收站题目不存在");
    rmSync(path, { force: true });
    this.listCache = null;
    return { trashId };
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
    this.listCache = null;
    return { added, conflicts };
  }

  updateImageMetadata(fileName: string, input: unknown) {
    this.assertImageExists(fileName);
    const metadata = imageMetadataSchema.parse(input);
    this.writeJsonAtomic(this.metadataPath(fileName), metadata);
    this.listCache = null;
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
    this.listCache = null;
    this.repository.reload();
    return { importedIds: imported.map((item) => item.entry.id), conflicts, report: this.repository.getValidationReport() };
  }

  // 资源代际：catalogue 文件与三个资源目录的时间戳 + 尺寸签名，用于探测服务进程外的手工增删。
  private resourceGeneration(): string {
    return [join(this.resourceDirectory, "catalogue.json"), this.fullDataDirectory, this.questionDataDirectory, this.questionTrashDirectory]
      .map((path) => {
        const stat = statSync(path);
        return `${stat.mtimeMs}:${stat.size}`;
      })
      .join("|");
  }

  private assertCanEnable(record: QuestionRecord): void {
    const errors = validateCompleteRecord(record, this.fullDataDirectory);
    if (errors.length) throw new Error(`题目 ${record.id} 信息未补全：${errors.join("、")}`);
  }

  private listTrash() {
    return readdirSync(this.questionTrashDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".json")
      .flatMap((entry) => {
        const trashId = basename(entry.name, ".json");
        try {
          const info = this.readJsonCached(this.trashPath(trashId), (raw) => questionRecordSchema.parse(raw));
          return [{ trashId, id: info.id, info, originalImageUrl: imageUrl(info.originalImage) }];
        } catch {
          return [];
        }
      })
      .sort((left, right) => left.info.title.localeCompare(right.info.title));
  }

  private readCatalogue(): CatalogueEntry[] {
    return this.readJsonCached(join(this.resourceDirectory, "catalogue.json"), (raw) => catalogueSchema.parse(raw));
  }

  private writeCatalogue(value: CatalogueEntry[]): void {
    this.writeJsonAtomic(join(this.resourceDirectory, "catalogue.json"), catalogueSchema.parse(value));
  }

  private readImageMetadata(fileName: string) {
    const path = this.metadataPath(fileName);
    if (!existsSync(path)) return imageMetadataSchema.parse({});
    try {
      return this.readJsonCached(path, (raw) => imageMetadataSchema.parse(raw));
    } catch {
      return imageMetadataSchema.parse({});
    }
  }

  private readJsonCached<T>(path: string, parse: (raw: unknown) => T): T {
    const { mtimeMs, size } = statSync(path);
    const cached = this.parsedFileCache.get(path);
    if (cached && cached.mtimeMs === mtimeMs && cached.size === size) return cached.value as T;
    const value = parse(JSON.parse(readFileSync(path, "utf8")));
    this.parsedFileCache.set(path, { mtimeMs, size, value });
    return value;
  }

  // 题目 ID 由标题派生：创建前做存在性校验，已存在则拒绝创建（不再自动追加序号），
  // 避免同标题题目静默生成 xxx-2、xxx-3 这类难以辨认的记录。
  private deriveQuestionId(title: string): string {
    const base = title.normalize("NFKC").trim().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 60) || "question";
    const normalizedTitle = normalizeQuestionTitle(title);
    const duplicate = this.readCatalogue().find((entry) => {
      try {
        const record = this.readJsonCached(this.questionPath(entry.id), (raw) => questionRecordSchema.parse(raw));
        return entry.id === base || normalizeQuestionTitle(record.title) === normalizedTitle;
      } catch {
        return entry.id === base;
      }
    }) ?? this.listTrash().find((entry) => entry.id === base || normalizeQuestionTitle(entry.info.title) === normalizedTitle);
    if (
      duplicate
      || existsSync(this.questionPath(base))
    ) {
      throw new Error(`已存在相同标题的题目（ID：${duplicate?.id ?? base}），请修改标题后再创建`);
    }
    return base;
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

  private trashPath(trashId: string): string {
    if (!/^[\p{L}\p{N}][\p{L}\p{N}._-]{0,119}$/u.test(trashId)) throw new Error(`非法回收站题目 ID：${trashId}`);
    const target = resolve(this.questionTrashDirectory, `${trashId}.json`);
    if (!target.startsWith(resolve(this.questionTrashDirectory) + sep)) throw new Error("题目路径超出 question_trash 目录");
    return target;
  }

  private imagePath(name: string): string { return join(this.fullDataDirectory, basename(name)); }
  private metadataPath(imageName: string): string { return join(this.fullDataDirectory, `${basename(imageName, extname(imageName))}.json`); }

  private writeJsonAtomic(path: string, value: unknown): void {
    const temporaryPath = `${path}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    renameSync(temporaryPath, path);
    this.parsedFileCache.delete(path);
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

function normalizeQuestionTitle(title: string): string {
  return title.normalize("NFKC").trim().toLocaleLowerCase();
}
