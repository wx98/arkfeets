import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { QuestionRepository } from "../question/questionRepository.js";
import { QuestionAdminService, validateArchivePath } from "./questionAdminService.js";

let rootDirectory: string;

beforeEach(() => {
  rootDirectory = mkdtempSync(join(tmpdir(), "arkfeets-admin-"));
  writeFileSync(join(rootDirectory, "catalogue.json"), JSON.stringify({ version: 1, questionIds: ["existing"] }));
  writeQuestion(rootDirectory, "existing", ["旧答案"]);
});

afterEach(() => rmSync(rootDirectory, { recursive: true, force: true }));

describe("QuestionAdminService", () => {
  it("rejects traversal paths and invalid question ids", () => {
    expect(() => validateArchivePath("../outside.txt")).toThrow("路径穿越");
    expect(() => validateArchivePath("C:/outside.txt")).toThrow("非法路径");
    const service = createService();
    expect(() => service.updateInfo("../existing", validInfo(["答案"]))).toThrow("非法题目 ID");
  });

  it("imports new questions as a union and preserves conflicts", () => {
    const service = createService();
    const zip = new AdmZip();
    zip.addFile("pack/catalogue.json", Buffer.from(JSON.stringify({ version: 1, questionIds: ["existing", "new-one"] })));
    zip.addFile("pack/new-one/info.json", Buffer.from(JSON.stringify(validInfo(["新答案"]))));
    zip.addFile("pack/new-one/question.png", Buffer.from("question"));
    zip.addFile("pack/new-one/full.png", Buffer.from("full"));

    const result = service.importZip(zip.toBuffer());
    expect(result).toMatchObject({ importedIds: ["new-one"], conflicts: ["existing"] });
    expect(JSON.parse(readFileSync(join(rootDirectory, "catalogue.json"), "utf8")).questionIds).toEqual(["existing", "new-one"]);
    expect(JSON.parse(readFileSync(join(rootDirectory, "existing", "info.json"), "utf8")).answers).toEqual(["旧答案"]);
  });

  it("rejects malformed resources before changing the catalogue", () => {
    const service = createService();
    const zip = new AdmZip();
    zip.addFile("catalogue.json", Buffer.from(JSON.stringify({ version: 1, questionIds: ["broken"] })));
    zip.addFile("broken/info.json", Buffer.from(JSON.stringify({ answers: [] })));
    expect(() => service.importZip(zip.toBuffer())).toThrow();
    expect(JSON.parse(readFileSync(join(rootDirectory, "catalogue.json"), "utf8")).questionIds).toEqual(["existing"]);
  });
});

function createService() {
  const repository = new QuestionRepository(rootDirectory);
  return new QuestionAdminService(rootDirectory, repository);
}

function writeQuestion(root: string, id: string, answers: string[]): void {
  const directory = join(root, id);
  mkdirSync(directory);
  writeFileSync(join(directory, "info.json"), JSON.stringify(validInfo(answers)));
  writeFileSync(join(directory, "question.png"), "question");
  writeFileSync(join(directory, "full.png"), "full");
}

function validInfo(answers: string[]) {
  return { answers, questionImg: "question.png", answerRevealImg: "full.png", enabled: true };
}
