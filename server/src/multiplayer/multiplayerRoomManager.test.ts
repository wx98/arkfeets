import { afterEach, describe, expect, it, vi } from "vitest";
import type { Question } from "../question/types.js";
import { MultiplayerRoomManager } from "./multiplayerRoomManager.js";

const host = { sessionId: "session-host", nickname: "博士" };
const guest = { sessionId: "session-guest", nickname: "阿米娅" };

afterEach(() => vi.useRealTimers());

describe("MultiplayerRoomManager", () => {
  it("locks a 20-player room after the game starts", () => {
    const manager = createManager(3);
    manager.createRoom({ roomCode: "1234", ...host, difficulty: "medium", requestedCount: 20 });
    for (let index = 1; index < 20; index += 1) {
      manager.joinRoom("1234", `session-player-${index}`, `玩家${index}`);
    }
    expect(() => manager.joinRoom("1234", "session-player-20", "满员玩家")).toThrow("房间已满");
    manager.start("1234", host.sessionId);
    expect(() => manager.joinRoom("1234", "session-late", "迟到玩家")).toThrow("游戏已经开始");
    manager.dispose();
  });

  it("awards only the first correct answer", () => {
    const manager = createManager(3);
    manager.createRoom({ roomCode: "race", ...host, difficulty: "medium", requestedCount: 20 });
    manager.joinRoom("race", guest.sessionId, guest.nickname);
    manager.start("race", host.sessionId);

    expect(manager.answer("race", guest.sessionId, "答案1").correct).toBe(true);
    expect(() => manager.answer("race", host.sessionId, "答案1")).toThrow("当前题已结束");
    const view = manager.getView("race", host.sessionId);
    expect(view.state).toBe("REVEAL");
    expect(view.players.find((player) => player.sessionId === guest.sessionId)?.score).toBe(1);
    manager.dispose();
  });

  it("restores a disconnected player by persistent session id", () => {
    const manager = createManager(3);
    manager.createRoom({ roomCode: "back", ...host, difficulty: "medium", requestedCount: 20 });
    manager.joinRoom("back", guest.sessionId, guest.nickname);
    manager.start("back", host.sessionId);
    manager.answer("back", guest.sessionId, "答案1");
    manager.disconnect("back", guest.sessionId);

    const restored = manager.joinRoom("back", guest.sessionId, "凯尔希");
    const player = restored.players.find((item) => item.sessionId === guest.sessionId);
    expect(player).toMatchObject({ nickname: "凯尔希", score: 1, connected: true });
    manager.dispose();
  });

  it("advances unanswered questions on the authoritative timer", () => {
    vi.useFakeTimers();
    const manager = createManager(2, { durationSeconds: { medium: 1 } });
    manager.createRoom({ roomCode: "timer", ...host, difficulty: "medium", requestedCount: 20 });
    manager.start("timer", host.sessionId);

    vi.advanceTimersByTime(1_050);
    expect(manager.getView("timer", host.sessionId).state).toBe("REVEAL");
    expect(manager.getView("timer", host.sessionId).reveal?.timedOut).toBe(true);
    vi.advanceTimersByTime(1_250);
    expect(manager.getView("timer", host.sessionId).question?.index).toBe(2);
    vi.advanceTimersByTime(1_050);
    expect(manager.getView("timer", host.sessionId).state).toBe("REVEAL");
    vi.advanceTimersByTime(1_250);
    expect(manager.getView("timer", host.sessionId).state).toBe("RANKING");
    manager.dispose();
  });

  it("runs overtime for tied leaders and finishes after a unique leader emerges", () => {
    const manager = createManager(21);
    manager.createRoom({ roomCode: "extra", ...host, difficulty: "medium", requestedCount: 20 });
    manager.joinRoom("extra", guest.sessionId, guest.nickname);
    manager.start("extra", host.sessionId);

    for (let index = 0; index < 20; index += 1) {
      const player = index % 2 === 0 ? host.sessionId : guest.sessionId;
      manager.answer("extra", player, `答案${index + 1}`);
      manager.next("extra", host.sessionId);
    }
    expect(manager.getView("extra", host.sessionId).question?.overtime).toBe(true);

    manager.answer("extra", host.sessionId, "答案21");
    manager.next("extra", host.sessionId);
    const result = manager.getView("extra", host.sessionId);
    expect(result.state).toBe("RANKING");
    expect(result.winnerSessionIds).toEqual([host.sessionId]);
    manager.dispose();
  });

  it("dissolves the room when the host disconnects", () => {
    const closed = vi.fn();
    const manager = createManager(3, { onRoomClosed: closed });
    manager.createRoom({ roomCode: "close", ...host, difficulty: "medium", requestedCount: 20 });
    manager.joinRoom("close", guest.sessionId, guest.nickname);

    manager.disconnect("close", host.sessionId);
    expect(manager.hasRoom("close")).toBe(false);
    expect(closed).toHaveBeenCalledWith("CLOSE", "房主已离开，房间已解散");
  });

  it("allows only one active external API room", () => {
    const manager = createManager(3);
    manager.createRoom({ roomCode: "api-one", ...host, difficulty: "medium", requestedCount: 20, answerSource: "EXTERNAL_API" });
    manager.createRoom({ roomCode: "api-two", sessionId: "session-host-two", nickname: "博士2", difficulty: "medium", requestedCount: 20, answerSource: "EXTERNAL_API" });

    manager.start("api-one", host.sessionId);
    expect(() => manager.start("api-two", "session-host-two")).toThrow("外部答案接口正被房间 API-ONE 使用");
    manager.disconnect("api-one", host.sessionId);
    expect(() => manager.start("api-two", "session-host-two")).not.toThrow();
    manager.dispose();
  });

  it("rejects external answers when no external room is active", () => {
    const manager = createManager(3);
    expect(() => manager.submitExternalAnswer("外部玩家", "答案1")).toThrow("当前没有活动的外部接口房间");
  });

  it("reuses the same external player after whitespace normalization", () => {
    const manager = createManager(3);
    manager.createRoom({ roomCode: "api", ...host, difficulty: "medium", requestedCount: 20, answerSource: "EXTERNAL_API" });
    manager.start("api", host.sessionId);

    expect(manager.submitExternalAnswer(" 外 部 1 ", "错误")).toMatchObject({ accepted: true, correct: false, userName: "外部1", score: 0 });
    expect(manager.submitExternalAnswer("外部1", "答案1")).toMatchObject({ accepted: true, correct: true, userName: "外部1", score: 1 });
    const room = manager.getView("api", host.sessionId);
    expect(room.players).toHaveLength(2);
    expect(room.players.find((player) => player.source === "EXTERNAL")?.score).toBe(1);
    manager.dispose();
  });
});

function createManager(count: number, options: ConstructorParameters<typeof MultiplayerRoomManager>[1] = {}) {
  const questions = Array.from({ length: count }, (_, index): Question => ({
    id: String(index + 1),
    answers: [`答案${index + 1}`],
    difficulty: ["medium"],
    tags: [],
    originalImageUrl: `/full-data/image-${index + 1}.png`,
    question: { x: 0, y: 0, width: 100, height: 100, sourceWidth: 100, sourceHeight: 100 },
    enabled: true,
  }));
  return new MultiplayerRoomManager({ drawQuestions: (_difficulty, requested) => questions.slice(0, requested) }, options);
}
