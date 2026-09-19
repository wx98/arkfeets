import { existsSync, readFileSync } from "node:fs";
import { basename, extname, join, normalize, sep } from "node:path";
import { z } from "zod";
import { difficulties, type CropRect, type Difficulty, type Question, type QuestionValidationItem } from "./types.js";

const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const safeIdPattern = /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,79}$/u;

export const cropRectSchema = z.object({
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  width: z.number().positive(),
  height: z.number().positive(),
  sourceWidth: z.number().positive(),
  sourceHeight: z.number().positive(),
}).strict();

export const questionRecordSchema = z.object({
  id: z.string().regex(safeIdPattern),
  title: z.string().trim().max(100).default(""),
  answers: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
  hint: z.string().trim().max(300).default(""),
  difficulty: z.array(z.enum(difficulties)).default([...difficulties]),
  tags: z.array(z.string().trim().min(1).max(50)).max(30).default([]),
  originalImage: z.string().trim().max(200).default(""),
  question: cropRectSchema.nullable().default(null),
  enabled: z.boolean().default(false),
}).strict();

export const catalogueEntrySchema = z.object({
  id: z.string().regex(safeIdPattern),
  file: z.string().trim().min(1),
}).strict();

export const catalogueSchema = z.array(catalogueEntrySchema);
export type QuestionRecord = z.infer<typeof questionRecordSchema>;
export type CatalogueEntry = z.infer<typeof catalogueEntrySchema>;

export class QuestionRepository {
  private readonly questions: Question[] = [];
  private readonly validationItems: QuestionValidationItem[] = [];

  constructor(private readonly resourceDirectory: string) {
    this.load();
  }

  getValidationReport() {
    return {
      validCount: this.validationItems.filter((item) => item.valid).length,
      invalidCount: this.validationItems.filter((item) => !item.valid).length,
      items: this.validationItems,
    };
  }

  reload(): void {
    this.questions.length = 0;
    this.validationItems.length = 0;
    this.load();
  }

  drawQuestions(difficulty: Difficulty, requestedCount: number): Question[] {
    const pool = this.questions.filter((question) => question.enabled && question.difficulty.includes(difficulty));
    for (let index = pool.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
    }
    return pool.slice(0, requestedCount);
  }

  private load(): void {
    const catalogue = catalogueSchema.parse(JSON.parse(readFileSync(join(this.resourceDirectory, "catalogue.json"), "utf8")));
    const seen = new Set<string>();
    for (const entry of catalogue) {
      const errors: string[] = [];
      try {
        if (seen.has(entry.id)) throw new Error(`题目 ID 重复：${entry.id}`);
        seen.add(entry.id);
        const record = questionRecordSchema.parse(JSON.parse(readFileSync(this.resolveQuestionRecord(entry), "utf8")));
        if (record.id !== entry.id) errors.push("索引 ID、文件名和题目 ID 不一致");
        errors.push(...validateCompleteRecord(record, join(this.resourceDirectory, "full_data")));
        if (errors.length === 0) {
          this.questions.push({
            id: record.id,
            title: record.title,
            answers: record.answers,
            hint: record.hint || undefined,
            difficulty: record.difficulty,
            tags: record.tags,
            originalImageUrl: imageUrl(record.originalImage),
            question: record.question as CropRect,
            enabled: record.enabled,
          });
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "未知校验错误");
      }
      this.validationItems.push({ id: entry.id, valid: errors.length === 0, errors });
    }
  }

  private resolveQuestionRecord(entry: CatalogueEntry): string {
    const expected = normalize(join("question_data", `${entry.id}.json`));
    if (normalize(entry.file) !== expected) throw new Error(`题目 ${entry.id} 的记录路径不合法`);
    const target = join(this.resourceDirectory, entry.file);
    const root = join(this.resourceDirectory, "question_data") + sep;
    if (!target.startsWith(root)) throw new Error("题目记录超出 question_data 目录");
    return target;
  }
}

export function validateCompleteRecord(record: QuestionRecord, fullDataDirectory: string): string[] {
  const errors: string[] = [];
  if (!record.title) errors.push("缺少标题");
  if (record.answers.length === 0) errors.push("至少需要一个答案");
  if (!record.originalImage) errors.push("缺少原图");
  else if (record.originalImage !== basename(record.originalImage) || !imageExtensions.has(extname(record.originalImage).toLowerCase())) {
    errors.push("原图文件名不合法");
  } else if (!existsSync(join(fullDataDirectory, record.originalImage))) {
    errors.push(`缺少原图 ${record.originalImage}`);
  }
  if (!record.question) errors.push("尚未选择谜面裁切区域");
  else if (record.question.x + record.question.width > record.question.sourceWidth || record.question.y + record.question.height > record.question.sourceHeight) {
    errors.push("谜面裁切区域超出原图范围");
  }
  return errors;
}

export function imageUrl(name: string): string {
  return `/full-data/${encodeURIComponent(name)}`;
}
