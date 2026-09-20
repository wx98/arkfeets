import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import AdmZip from "adm-zip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { QuestionRepository } from "../question/questionRepository.js";
import { QuestionAdminService, validateArchivePath } from "./questionAdminService.js";

let rootDirectory: string;

beforeEach(() => {
  rootDirectory = mkdtempSync(join(tmpdir(), "arkfeets-admin-"));
  mkdirSync(join(rootDirectory, "full_data"));
  mkdirSync(join(rootDirectory, "question_data"));
  writeFileSync(join(rootDirectory, "full_data", "existing.png"), "image");
  writeFileSync(join(rootDirectory, "full_data", "existing.json"), JSON.stringify({ name: "existing" }));
  writeFileSync(join(rootDirectory, "catalogue.json"), JSON.stringify([{ id: "existing", file: "question_data/existing.json" }]));
  writeFileSync(join(rootDirectory, "question_data", "existing.json"), JSON.stringify(record("existing", ["旧答案"])));
});

afterEach(() => rmSync(rootDirectory, { recursive: true, force: true }));

describe("QuestionAdminService", () => {
  it("rejects traversal archive paths and invalid question ids", () => {
    expect(() => validateArchivePath("../outside.txt")).toThrow("路径穿越");
    expect(() => validateArchivePath("C:/outside.txt")).toThrow("非法路径");
    expect(() => createService().updateQuestion("../existing", validInput(["答案"]))).toThrow("题目不存在");
  });

  it("updates one question file without rewriting catalogue", () => {
    const service = createService();
    const before = readFileSync(join(rootDirectory, "catalogue.json"), "utf8");
    service.updateQuestion("existing", { ...validInput(["新答案"]), title: "新标题" });
    expect(readFileSync(join(rootDirectory, "catalogue.json"), "utf8")).toBe(before);
    expect(JSON.parse(readFileSync(join(rootDirectory, "question_data", "existing.json"), "utf8")).answers).toEqual(["新答案"]);
  });

  it("invalidates parsed records after a same-size update", () => {
    const service = createService();
    expect(service.list().questions[0].info?.answers).toEqual(["旧答案"]);
    service.updateQuestion("existing", { ...validInput(["新答案"]), title: "题目" });
    expect(service.list().questions[0].info?.answers).toEqual(["新答案"]);
  });

  it("creates a question only after title and crop are complete", () => {
    const service = createService();
    expect(() => service.createQuestion({ ...validInput(["答案"]), title: "", question: null })).toThrow("填写标题");
    const id = service.createQuestion({ ...validInput(["答案"]), title: "新问题", enabled: false });
    expect(id).toBe("新问题");
    expect(JSON.parse(readFileSync(join(rootDirectory, "catalogue.json"), "utf8"))).toContainEqual({ id, file: `question_data/${id}.json` });
  });

  it("rejects creating a question whose title or derived id already exists", () => {
    const service = createService();
    expect(() => service.createQuestion({ ...validInput(["答案"]), title: "existing", enabled: false })).toThrow("已存在相同标题的题目");
    expect(() => service.createQuestion({ ...validInput(["答案"]), title: "题目", enabled: false })).toThrow("ID：existing");
    service.createQuestion({ ...validInput(["答案"]), title: "新问题", enabled: false });
    // 末尾标点被归一化去除后派生出相同 ID，同样拒绝创建
    expect(() => service.createQuestion({ ...validInput(["答案"]), title: "新问题！", enabled: false })).toThrow("已存在相同标题的题目");
    const deleted = service.deleteQuestion("existing");
    expect(() => service.createQuestion({ ...validInput(["答案"]), title: "existing", enabled: false })).toThrow("已存在相同标题的题目");
    service.permanentlyDeleteQuestion(deleted.trashId);
  });

  it("moves a question to trash and restores it without deleting its original image", () => {
    const service = createService();
    const deleted = service.deleteQuestion("existing");
    expect(deleted).toMatchObject({ id: "existing" });
    expect(JSON.parse(readFileSync(join(rootDirectory, "catalogue.json"), "utf8"))).toEqual([]);
    expect(() => readFileSync(join(rootDirectory, "question_data", "existing.json"), "utf8")).toThrow();
    expect(service.list().trash).toContainEqual(expect.objectContaining({ trashId: deleted.trashId, id: "existing" }));
    expect(readFileSync(join(rootDirectory, "full_data", "existing.png"), "utf8")).toBe("image");
    expect(readFileSync(join(rootDirectory, "full_data", "existing.json"), "utf8")).toContain("existing");
    expect(service.restoreQuestion(deleted.trashId)).toEqual({ id: "existing" });
    expect(service.list().questions).toHaveLength(1);
    expect(service.list().trash).toEqual([]);
  });

  it("permanently deletes only the trashed question record", () => {
    const service = createService();
    const deleted = service.deleteQuestion("existing");
    expect(service.permanentlyDeleteQuestion(deleted.trashId)).toEqual({ trashId: deleted.trashId });
    expect(service.list().trash).toEqual([]);
    expect(readFileSync(join(rootDirectory, "full_data", "existing.png"), "utf8")).toBe("image");
  });

  it("groups image statistics and metadata", () => {
    const library = createService().list();
    expect(library.images).toContainEqual(expect.objectContaining({ fileName: "existing.png", validCount: 1, totalCount: 1 }));
    expect(library.questions[0]).toMatchObject({ id: "existing", validation: { valid: true } });
  });

  it("reads and writes structured image metadata tags", () => {
    const service = createService();
    service.updateImageMetadata("existing.png", {
      name: "能天使",
      answers: ["能天使", "阿能"],
      hint: "拉特兰干员",
      difficulty: ["simple", "medium", "hard", "hell"],
      tags: [{ "星级": "6星" }, { "职业": "狙击" }],
    });
    expect(service.list().images[0].metadata.tags).toEqual([{ "星级": "6星" }, { "职业": "狙击" }]);
    expect(() => service.updateImageMetadata("existing.png", {
      name: "错误标签",
      tags: [{ "职业": "狙击", "分支": "速射手" }],
    })).toThrow("每个原图标签必须且只能包含一个键值");
  });

  it("adds full images without creating question drafts", async () => {
    const service = createService();
    await expect(service.addImages([{ buffer: Buffer.from("new"), mimetype: "image/png", originalname: "能天使.png" }])).resolves.toEqual({
      added: ["能天使.png"], conflicts: [],
    });
    expect(service.list().images.map((image) => image.fileName)).toContain("能天使.png");
    expect(service.list().questions).toHaveLength(1);
  });

  it("rejects enabling incomplete records", () => {
    expect(() => createService().updateQuestion("existing", { ...validInput([]), enabled: true })).toThrow("信息未补全");
  });

  it("accepts enabled questions containing long structured metadata tags", () => {
    const service = createService();
    const longTag = `是否感染者:${"感染者档案说明".repeat(20)}`;
    service.updateQuestion("existing", { ...validInput(["答案"]), tags: [longTag], enabled: true });
    expect(JSON.parse(readFileSync(join(rootDirectory, "question_data", "existing.json"), "utf8")).tags).toEqual([longTag]);
  });

  it("exports and imports the new resource layout as a union", async () => {
    const chunks: Buffer[] = [];
    const output = new PassThrough();
    output.on("data", (chunk: Buffer) => chunks.push(chunk));
    await createService().createExport().writeTo(output);
    const archiveBuffer = Buffer.concat(chunks);
    const archive = new AdmZip(archiveBuffer);
    expect(archive.getEntry("catalogue.json")).not.toBeNull();
    expect(archive.getEntry("question_data/existing.json")).not.toBeNull();
    expect(archive.getEntry("full_data/existing.png")).not.toBeNull();
    const destination = mkdtempSync(join(tmpdir(), "arkfeets-import-"));
    try {
      mkdirSync(join(destination, "full_data"));
      mkdirSync(join(destination, "question_data"));
      writeFileSync(join(destination, "catalogue.json"), "[]");
      const archivePath = join(rootDirectory, "export.zip");
      writeFileSync(archivePath, archiveBuffer);
      const imported = await new QuestionAdminService(destination, new QuestionRepository(destination)).importZip(archivePath);
      expect(imported.importedIds).toEqual(["existing"]);
    } finally {
      rmSync(destination, { recursive: true, force: true });
    }
  });
});

function createService() {
  return new QuestionAdminService(rootDirectory, new QuestionRepository(rootDirectory));
}

function validInput(answers: string[]) {
  return {
    title: "题目",
    answers,
    hint: "",
    difficulty: ["simple", "medium", "hard", "hell"] as const,
    tags: [],
    originalImage: "existing.png",
    question: { x: 10, y: 20, width: 100, height: 80, sourceWidth: 200, sourceHeight: 160 },
    enabled: true,
  };
}

function record(id: string, answers: string[]) {
  return { id, ...validInput(answers) };
}
