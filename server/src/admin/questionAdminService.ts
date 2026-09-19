import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, extname, join, posix, resolve, sep } from "node:path";
import AdmZip from "adm-zip";
import { z } from "zod";
import { catalogueSchema, questionInfoSchema, type QuestionRepository } from "../question/questionRepository.js";
import { difficulties } from "../question/types.js";

export const adminQuestionInfoSchema = z.object({
  title: z.string().trim().max(100).default(""),
  answers: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
  hint: z.string().trim().max(300).default(""),
  difficulty: z.array(z.enum(difficulties)).default([...difficulties]),
  tags: z.array(z.string().trim().min(1).max(50)).max(30).default([]),
  questionImg: z.string().trim().max(200).default(""),
  answerRevealImg: z.string().trim().max(200).default(""),
  enabled: z.boolean().default(false),
}).strict();

export type AdminQuestionInfo = z.infer<typeof adminQuestionInfoSchema>;
type UploadedImage = { buffer: Buffer; mimetype: string; originalname: string };

const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const imageMimeExtensions = new Map([
  ["image/png", ".png"], ["image/jpeg", ".jpg"], ["image/webp", ".webp"], ["image/gif", ".gif"],
]);
const safeIdPattern = /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,79}$/u;

export class QuestionAdminService {
  constructor(private readonly rootDirectory: string, private readonly repository: QuestionRepository) {}

  list() {
    const catalogue = this.readCatalogue();
    const validationById = new Map(this.repository.getValidationReport().items.map((item) => [item.id, item]));
    return {
      ...this.repository.getValidationReport(),
      questions: catalogue.questionIds.map((id) => {
        let info: AdminQuestionInfo | null = null;
        try {
          info = adminQuestionInfoSchema.parse(JSON.parse(readFileSync(this.infoPath(id), "utf8")));
        } catch {
          // The repository report carries validation details for malformed files.
        }
        const questionImageName = info?.questionImg || "";
        const revealImageName = info?.answerRevealImg || "";
        return {
          id,
          info,
          questionImgUrl: questionImageName && existsSync(this.safeQuestionPath(id, questionImageName)) ? this.imageUrl(id, questionImageName) : null,
          answerRevealImgUrl: revealImageName && existsSync(this.safeQuestionPath(id, revealImageName)) ? this.imageUrl(id, revealImageName) : null,
          validation: validationById.get(id) ?? { id, valid: false, errors: ["未校验"] },
        };
      }),
    };
  }

  createDraft(title: string): string {
    const id = this.createUniqueId(title || "new-question");
    this.persistDraft(id, this.emptyDraft(title));
    return id;
  }

  createDraftsFromImages(files: Array<UploadedImage & { relativePath?: string }>): string[] {
    if (files.length === 0) throw new Error("请选择至少一张完整图片");
    const prepared = files.map((file) => {
      const extension = this.imageExtension(file);
      const relativePath = (file.relativePath || file.originalname).replaceAll("\\", "/");
      const pathParts = relativePath.split("/").filter(Boolean);
      const originalName = pathParts.at(-1) ?? file.originalname;
      const title = basename(originalName, extname(originalName)) || "未命名题目";
      return { file, extension, title, folder: pathParts.length > 1 ? pathParts[0] : "批量上传" };
    });

    const ids: string[] = [];
    for (const item of prepared) {
      const id = this.createUniqueId(item.title);
      const directory = this.safeQuestionPath(id);
      mkdirSync(directory);
      const fullName = `full${item.extension}`;
      writeFileSync(join(directory, fullName), item.file.buffer);
      this.writeJsonAtomic(join(directory, "info.json"), {
        ...this.emptyDraft(item.title), tags: [item.folder], answerRevealImg: fullName,
      });
      ids.push(id);
      this.appendCatalogueIds([id]);
    }
    this.repository.reload();
    return ids;
  }

  updateInfo(id: string, input: unknown): AdminQuestionInfo {
    this.assertRegisteredId(id);
    const info = adminQuestionInfoSchema.parse(input);
    if (info.questionImg) this.assertImageName(info.questionImg);
    if (info.answerRevealImg) this.assertImageName(info.answerRevealImg);
    if (info.enabled) this.assertCanEnable(id, info);
    this.writeJsonAtomic(this.infoPath(id), info);
    this.repository.reload();
    return info;
  }

  replaceImage(id: string, kind: "question" | "reveal", file: UploadedImage): AdminQuestionInfo {
    this.assertRegisteredId(id);
    const extension = this.imageExtension(file);
    const info = adminQuestionInfoSchema.parse(JSON.parse(readFileSync(this.infoPath(id), "utf8")));
    const property = kind === "question" ? "questionImg" : "answerRevealImg";
    const previousName = info[property];
    const fileName = kind === "question" ? `question${extension}` : `full${extension}`;
    writeFileSync(this.safeQuestionPath(id, fileName), file.buffer);
    info[property] = fileName;
    this.writeJsonAtomic(this.infoPath(id), info);
    if (previousName && previousName !== fileName && previousName !== info.questionImg && previousName !== info.answerRevealImg) {
      rmSync(this.safeQuestionPath(id, previousName), { force: true });
    }
    this.repository.reload();
    return info;
  }

  exportZip(): Buffer {
    const zip = new AdmZip();
    const catalogue = this.readCatalogue();
    zip.addFile("catalogue.json", Buffer.from(`${JSON.stringify(catalogue, null, 2)}\n`));
    for (const id of catalogue.questionIds) {
      const directory = this.safeQuestionPath(id);
      if (!existsSync(directory)) continue;
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isFile() || (entry.name !== "info.json" && !imageExtensions.has(extname(entry.name).toLowerCase()))) continue;
        zip.addFile(`${id}/${entry.name}`, readFileSync(join(directory, entry.name)));
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
    const currentCatalogue = this.readCatalogue();
    const currentIds = new Set(currentCatalogue.questionIds);
    const conflicts: string[] = [];
    const imported: Array<{ id: string; info: AdminQuestionInfo; images: Array<{ name: string; data: Buffer }> }> = [];
    const seen = new Set<string>();

    for (const id of importedCatalogue.questionIds) {
      assertSafeId(id);
      if (seen.has(id)) throw new Error(`资源包目录存在重复题目 ID：${id}`);
      seen.add(id);
      if (currentIds.has(id)) { conflicts.push(id); continue; }
      const infoBuffer = files.get(`${prefix}${id}/info.json`);
      if (!infoBuffer) throw new Error(`题目 ${id} 缺少 info.json`);
      const info = adminQuestionInfoSchema.parse(JSON.parse(infoBuffer.toString("utf8")));
      const images = [info.questionImg, info.answerRevealImg].filter(Boolean).map((name) => {
        this.assertImageName(name);
        const data = files.get(`${prefix}${id}/${name}`);
        if (!data) throw new Error(`题目 ${id} 缺少图片 ${name}`);
        return { name, data };
      });
      if (info.enabled) this.assertDraftComplete(info, id);
      imported.push({ id, info, images });
    }

    for (const question of imported) {
      const directory = this.safeQuestionPath(question.id);
      mkdirSync(directory);
      this.writeJsonAtomic(join(directory, "info.json"), question.info);
      for (const image of question.images) writeFileSync(join(directory, image.name), image.data);
    }
    this.writeJsonAtomic(join(this.rootDirectory, "catalogue.json"), {
      version: currentCatalogue.version, questionIds: [...currentCatalogue.questionIds, ...imported.map((question) => question.id)],
    });
    this.repository.reload();
    return { importedIds: imported.map((question) => question.id), conflicts, report: this.repository.getValidationReport() };
  }

  private emptyDraft(title: string): AdminQuestionInfo {
    return { title: title.trim(), answers: [], hint: "", difficulty: [...difficulties], tags: [], questionImg: "", answerRevealImg: "", enabled: false };
  }

  private persistDraft(id: string, info: AdminQuestionInfo): void {
    mkdirSync(this.safeQuestionPath(id));
    this.writeJsonAtomic(this.infoPath(id), info);
    this.appendCatalogueIds([id]);
    this.repository.reload();
  }

  private appendCatalogueIds(ids: string[]): void {
    const catalogue = this.readCatalogue();
    this.writeJsonAtomic(join(this.rootDirectory, "catalogue.json"), { ...catalogue, questionIds: [...catalogue.questionIds, ...ids] });
  }

  private createUniqueId(title: string): string {
    const base = title.normalize("NFKC").trim().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 60) || "question";
    const existing = new Set(this.readCatalogue().questionIds);
    if (!existing.has(base)) return base;
    for (let index = 2; index < 10_000; index += 1) {
      const candidate = `${base}-${index}`;
      if (!existing.has(candidate)) return candidate;
    }
    throw new Error("无法生成唯一题目 ID");
  }

  private assertCanEnable(id: string, info: AdminQuestionInfo): void {
    this.assertDraftComplete(info, id);
    for (const imageName of [info.questionImg, info.answerRevealImg]) {
      if (!existsSync(this.safeQuestionPath(id, imageName))) throw new Error(`信息未补全：缺少图片 ${imageName}`);
    }
  }

  private assertDraftComplete(info: AdminQuestionInfo, id: string): void {
    try {
      questionInfoSchema.parse({ ...info, title: info.title || undefined, hint: info.hint || undefined });
    } catch {
      throw new Error(`题目 ${id} 信息未补全，不能启用`);
    }
  }

  private imageExtension(file: UploadedImage): string {
    const extension = imageMimeExtensions.get(file.mimetype) ?? extname(file.originalname).toLowerCase();
    if (!imageExtensions.has(extension)) throw new Error("只允许上传 PNG、JPG、WEBP 或 GIF 图片");
    return extension;
  }

  private readCatalogue(): z.infer<typeof catalogueSchema> {
    return catalogueSchema.parse(JSON.parse(readFileSync(join(this.rootDirectory, "catalogue.json"), "utf8")));
  }

  private assertRegisteredId(id: string): void {
    assertSafeId(id);
    if (!this.readCatalogue().questionIds.includes(id)) throw new Error("题目不存在或未注册");
  }

  private assertImageName(name: string): void {
    if (name !== basename(name) || !imageExtensions.has(extname(name).toLowerCase())) throw new Error(`非法图片文件名：${name}`);
  }

  private infoPath(id: string): string { return this.safeQuestionPath(id, "info.json"); }

  private safeQuestionPath(id: string, fileName?: string): string {
    assertSafeId(id);
    const target = resolve(this.rootDirectory, id, ...(fileName ? [fileName] : []));
    const root = resolve(this.rootDirectory) + sep;
    if (!target.startsWith(root)) throw new Error("目标路径超出题库目录");
    return target;
  }

  private imageUrl(id: string, name: string): string { return `/questions/${encodeURIComponent(id)}/${encodeURIComponent(name)}?v=${Date.now()}`; }

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

function assertSafeId(id: string): void {
  if (!safeIdPattern.test(id)) throw new Error(`非法题目 ID：${id}`);
}
