import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { difficulties, type Difficulty, type Question, type QuestionValidationItem } from "./types.js";

const infoSchema = z.object({
  title: z.string().trim().min(1).optional(),
  answers: z.array(z.string().trim().min(1)).min(1),
  hint: z.string().trim().min(1).optional(),
  difficulty: z.array(z.enum(difficulties)).optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
  questionImg: z.string().trim().min(1),
  answerRevealImg: z.string().trim().min(1),
  enabled: z.boolean().optional(),
});

const catalogueSchema = z.object({
  version: z.number().int().positive(),
  questionIds: z.array(z.string().trim().min(1)),
});

export class QuestionRepository {
  private readonly questions: Question[] = [];
  private readonly validationItems: QuestionValidationItem[] = [];

  constructor(private readonly rootDirectory: string) {
    this.load();
  }

  getValidationReport() {
    return {
      validCount: this.validationItems.filter((item) => item.valid).length,
      invalidCount: this.validationItems.filter((item) => !item.valid).length,
      items: this.validationItems,
    };
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
    const cataloguePath = join(this.rootDirectory, "catalogue.json");
    const catalogue = catalogueSchema.parse(JSON.parse(readFileSync(cataloguePath, "utf8")));

    for (const id of catalogue.questionIds) {
      const errors: string[] = [];
      try {
        const questionDirectory = join(this.rootDirectory, id);
        const info = infoSchema.parse(JSON.parse(readFileSync(join(questionDirectory, "info.json"), "utf8")));
        for (const imageName of [info.questionImg, info.answerRevealImg]) {
          if (!existsSync(join(questionDirectory, imageName))) errors.push(`缺少图片 ${imageName}`);
        }

        if (errors.length === 0) {
          this.questions.push({
            id,
            title: info.title,
            answers: info.answers,
            hint: info.hint,
            difficulty: info.difficulty ?? [...difficulties],
            tags: info.tags ?? [],
            questionImgUrl: `/questions/${encodeURIComponent(id)}/${encodeURIComponent(info.questionImg)}`,
            answerRevealImgUrl: `/questions/${encodeURIComponent(id)}/${encodeURIComponent(info.answerRevealImg)}`,
            enabled: info.enabled ?? true,
          });
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "未知校验错误");
      }
      this.validationItems.push({ id, valid: errors.length === 0, errors });
    }
  }
}
