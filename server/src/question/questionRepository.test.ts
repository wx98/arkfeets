import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { QuestionRepository } from "./questionRepository.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("homepage image selection", () => {
  it("uses only enabled, valid questions and avoids the current image when possible", () => {
    const root = mkdtempSync(join(tmpdir(), "arkfeets-home-"));
    roots.push(root);
    mkdirSync(join(root, "full_data"));
    mkdirSync(join(root, "question_data"));
    const entries = [
      { id: "first", image: "first.png", enabled: true },
      { id: "second", image: "second.png", enabled: true },
      { id: "disabled", image: "disabled.png", enabled: false },
    ];
    for (const entry of entries) {
      writeFileSync(join(root, "full_data", entry.image), "image");
      writeFileSync(join(root, "question_data", `${entry.id}.json`), JSON.stringify({
        id: entry.id, title: entry.id, answers: [entry.id], originalImage: entry.image,
        question: { x: 0, y: 0, width: 10, height: 10, sourceWidth: 10, sourceHeight: 10 },
        enabled: entry.enabled,
      }));
    }
    writeFileSync(join(root, "catalogue.json"), JSON.stringify(entries.map(entry => ({ id: entry.id, file: `question_data/${entry.id}.json` }))));

    const repository = new QuestionRepository(root);
    expect(repository.getEnabledQuestionCount()).toBe(2);
    expect(repository.getRandomOriginalImageUrl("/full-data/first.png")).toBe("/full-data/second.png");
    expect(repository.getRandomOriginalImageUrl("/full-data/second.png")).toBe("/full-data/first.png");
  });
});
