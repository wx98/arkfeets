import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, extname, join, posix, resolve, sep } from "node:path";
import AdmZip from "adm-zip";
import { z } from "zod";
import { catalogueSchema, questionInfoSchema, type QuestionRepository } from "../question/questionRepository.js";

export type QuestionInfo = z.infer<typeof questionInfoSchema>;

const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const imageMimeExtensions = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
]);
const safeIdPattern = /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,79}$/u;

export class QuestionAdminService {
  constructor(
    private readonly rootDirectory: string,
    private readonly repository: QuestionRepository,
  ) {}

  list() {
    const catalogue = this.readCatalogue();
    const validationById = new Map(this.repository.getValidationReport().items.map((item) => [item.id, item]));
    return {
      ...this.repository.getValidationReport(),
      questions: catalogue.questionIds.map((id) => {
        let info: QuestionInfo | null = null;
        try {
          info = questionInfoSchema.parse(JSON.parse(readFileSync(this.infoPath(id), "utf8")));
        } catch {
          // Validation errors are already included in the repository report.
        }
        return { id, info, validation: validationById.get(id) ?? { id, valid: false, errors: ["未校验"] } };
      }),
    };
  }

  updateInfo(id: string, input: unknown): QuestionInfo {
    this.assertRegisteredId(id);
    const info = questionInfoSchema.parse(input);
    this.assertImageName(info.questionImg);
    this.assertImageName(info.answerRevealImg);
    this.writeJsonAtomic(this.infoPath(id), info);
    this.repository.reload();
    return info;
  }

  replaceImage(id: string, kind: "question" | "reveal", file: { buffer: Buffer; mimetype: string; originalname: string }): QuestionInfo {
    this.assertRegisteredId(id);
    const extension = imageMimeExtensions.get(file.mimetype) ?? extname(file.originalname).toLowerCase();
    if (!imageExtensions.has(extension)) throw new Error("只允许上传 PNG、JPG、WEBP 或 GIF 图片");
    const info = questionInfoSchema.parse(JSON.parse(readFileSync(this.infoPath(id), "utf8")));
    const property = kind === "question" ? "questionImg" : "answerRevealImg";
    const previousName = info[property];
    const fileName = kind === "question" ? `question${extension}` : `full${extension}`;
    writeFileSync(this.safeQuestionPath(id, fileName), file.buffer);
    info[property] = fileName;
    this.writeJsonAtomic(this.infoPath(id), info);
    if (previousName !== fileName && previousName !== info.questionImg && previousName !== info.answerRevealImg) {
      rmSync(this.safeQuestionPath(id, previousName), { force: true });
    }
    this.repository.reload();
    return info;
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
    const imported: Array<{ id: string; info: QuestionInfo; images: Array<{ name: string; data: Buffer }> }> = [];
    const seen = new Set<string>();

    for (const id of importedCatalogue.questionIds) {
      assertSafeId(id);
      if (seen.has(id)) throw new Error(`资源包目录存在重复题目 ID：${id}`);
      seen.add(id);
      if (currentIds.has(id)) {
        conflicts.push(id);
        continue;
      }
      const infoBuffer = files.get(`${prefix}${id}/info.json`);
      if (!infoBuffer) throw new Error(`题目 ${id} 缺少 info.json`);
      const info = questionInfoSchema.parse(JSON.parse(infoBuffer.toString("utf8")));
      const images = [info.questionImg, info.answerRevealImg].map((name) => {
        this.assertImageName(name);
        const data = files.get(`${prefix}${id}/${name}`);
        if (!data) throw new Error(`题目 ${id} 缺少图片 ${name}`);
        return { name, data };
      });
      imported.push({ id, info, images });
    }

    for (const question of imported) {
      const directory = this.safeQuestionPath(question.id);
      mkdirSync(directory, { recursive: false });
      this.writeJsonAtomic(join(directory, "info.json"), question.info);
      for (const image of question.images) writeFileSync(join(directory, image.name), image.data);
    }
    this.writeJsonAtomic(join(this.rootDirectory, "catalogue.json"), {
      version: currentCatalogue.version,
      questionIds: [...currentCatalogue.questionIds, ...imported.map((question) => question.id)],
    });
    this.repository.reload();
    return { importedIds: imported.map((question) => question.id), conflicts, report: this.repository.getValidationReport() };
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

  private infoPath(id: string): string {
    return this.safeQuestionPath(id, "info.json");
  }

  private safeQuestionPath(id: string, fileName?: string): string {
    assertSafeId(id);
    const target = resolve(this.rootDirectory, id, ...(fileName ? [fileName] : []));
    const root = resolve(this.rootDirectory) + sep;
    if (!target.startsWith(root)) throw new Error("目标路径超出题库目录");
    return target;
  }

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
