import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Question } from "../question/types.js";
import { GameAuditLogger } from "./gameAuditLogger.js";
import { MultiplayerRoomManager } from "./multiplayerRoomManager.js";

const question: Question = {
  id: "q1", title: "测试题", answers: ["标准答案", "别名"], difficulty: ["medium"], tags: [],
  originalImageUrl: "/full-data/test.png",
  question: { x: 0, y: 0, width: 10, height: 10, sourceWidth: 10, sourceHeight: 10 },
  enabled: true,
};

describe("game audit log", () => {
  it("creates one file per game with wrong/correct answers and post-answer rank", () => {
    const directory = mkdtempSync(join(tmpdir(), "arkfeets-audit-"));
    const log = new GameAuditLogger(directory);
    const manager = new MultiplayerRoomManager({ drawQuestions: () => [question], getTopics: () => [{ id: "脚", name: "脚", isDefault: true }] }, {
      onGameStarted: (code, details) => log.start(code, details),
      onAnswerReceived: (code, details) => log.answer(code, details),
      onGameEnded: (code, details) => log.end(code, details),
    });
    try {
      manager.createRoom({ roomCode: "room", sessionId: "host-session", nickname: "房主", difficulty: "medium", requestedCount: 20 });
      manager.joinRoom("room", "guest-session", "队员");
      manager.start("room", "host-session");
      manager.answer("room", "guest-session", "错误");
      manager.answer("room", "guest-session", "标准答案");
      manager.next("room", "host-session");
      const first = readdirSync(directory);
      expect(first).toHaveLength(1);
      expect(first[0]).toMatch(/^\d{4}-\d{2}-\d{2}T.*_ROOM_.*\.jsonl$/);
      const records = readFileSync(join(directory, first[0]), "utf8").trim().split("\n").map(line => JSON.parse(line));
      expect(records.map(record => record.type)).toEqual(["start", "answer", "answer", "end"]);
      expect(records[1]).toMatchObject({ questionId: "q1", standardAnswers: ["标准答案", "别名"], answer: "错误", correct: false, score: 0, rank: 2 });
      expect(records[2]).toMatchObject({ answer: "标准答案", correct: true, score: 1, rank: 1 });
      expect(records[3]).toMatchObject({ reason: "completed", players: [{ nickname: "队员", score: 1, rank: 1 }, { nickname: "房主", score: 0, rank: 2 }] });
      manager.skipRanking("room", "host-session");
      manager.start("room", "host-session");
      manager.disconnect("room", "host-session");
      expect(readdirSync(directory)).toHaveLength(2);
      const second = readdirSync(directory).find(file => file !== first[0])!;
      const last = JSON.parse(readFileSync(join(directory, second), "utf8").trim().split("\n").at(-1)!);
      expect(last).toMatchObject({ type: "end", reason: "room_closed" });
    } finally {
      manager.dispose();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
