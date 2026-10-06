import { appendFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { GameAuditLogger } from "./gameAuditLogger.js";
import { GameAuditReader } from "./gameAuditReader.js";

describe("game audit reader", () => {
  it("lists games and pages detailed answers with search and verdict filters", async () => {
    const directory = mkdtempSync(join(tmpdir(), "arkfeets-audit-reader-"));
    const logger = new GameAuditLogger(directory);
    const reader = new GameAuditReader(directory);
    try {
      const file = logger.start("LIVE1", { answerSource: "BILIBILI", difficulty: "medium", requestedCount: 20, questionCount: 2 });
      const base = { answerSource: "BILIBILI" as const, questionId: "q1", questionIndex: 0, overtime: false,
        standardAnswers: ["阿米娅", "兔兔"], userId: "42", nickname: "博士", score: 0, rank: 2 };
      logger.answer("LIVE1", { ...base, answer: "错误", correct: false });
      logger.answer("LIVE1", { ...base, answer: "阿米娅", correct: true, score: 1, rank: 1 });
      appendFileSync(file, "broken line\n");
      logger.end("LIVE1", { reason: "completed", players: [{ userId: "42", nickname: "博士", score: 1, rank: 1 }] });
      const id = basename(file);
      const listed = await reader.list(0, 20);
      expect(listed.total).toBe(1);
      expect(listed.items[0]).toMatchObject({ id, roomCode: "LIVE1", answerCount: 2, correctCount: 1, playerCount: 1, status: "completed", invalidLines: 1 });
      expect((await reader.list(1, 20)).items).toEqual([]);
      const first = await reader.detail(id, 0, 1);
      expect(first).toMatchObject({ matchedCount: 2, page: 0, pageSize: 1 });
      expect(first.start?.answerSource).toBe("BILIBILI");
      expect(first.answers[0]).toMatchObject({ answer: "错误", correct: false, rank: 2, standardAnswers: ["阿米娅", "兔兔"] });
      expect((await reader.detail(id, 1, 1)).answers[0]).toMatchObject({ answer: "阿米娅", correct: true, rank: 1 });
      expect((await reader.detail(id, 0, 20, "博士", true)).matchedCount).toBe(1);
      expect((await reader.detail(id, 0, 20, "兔兔", false)).answers).toHaveLength(1);
      await expect(reader.detail("../config.json", 0, 20)).rejects.toThrow("无效的对局记录 ID");
      const openFile = logger.start("OPEN1", { answerSource: "WEB", difficulty: "hard", requestedCount: 20, questionCount: 1 });
      const openId = basename(openFile);
      expect((await reader.detail(openId, 0, 20)).summary.status).toBe("in_progress");
      expect((await reader.list(0, 20)).total).toBe(2);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("deletes a finished log but protects active logs and rejects unsafe IDs", async () => {
    const directory = mkdtempSync(join(tmpdir(), "arkfeets-audit-delete-"));
    const logger = new GameAuditLogger(directory);
    const reader = new GameAuditReader(directory, id => logger.isActiveFile(id));
    try {
      const file = logger.start("LIVE1", { answerSource: "BILIBILI", difficulty: "medium", requestedCount: 20, questionCount: 1 });
      const id = basename(file);
      await expect(reader.delete(id)).rejects.toThrow("正在写入");
      expect(existsSync(file)).toBe(true);
      logger.end("LIVE1", { reason: "completed", players: [] });
      expect(await reader.delete(id)).toEqual({ deleted: true, id });
      expect(existsSync(file)).toBe(false);
      expect((await reader.list(0, 20)).total).toBe(0);
      await expect(reader.delete(id)).rejects.toThrow();
      await expect(reader.delete("../config.json")).rejects.toThrow("无效的对局记录 ID");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
