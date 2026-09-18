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
    expect(manager.getView("timer", host.sessionId).question?.index).toBe(2);
    vi.advanceTimersByTime(1_050);
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
});

function createManager(count: number, options: ConstructorParameters<typeof MultiplayerRoomManager>[1] = {}) {
  const questions = Array.from({ length: count }, (_, index): Question => ({
    id: String(index + 1),
    answers: [`答案${index + 1}`],
    difficulty: ["medium"],
    tags: [],
    questionImgUrl: `/question-${index + 1}.png`,
    answerRevealImgUrl: `/answer-${index + 1}.png`,
    enabled: true,
  }));
  return new MultiplayerRoomManager({ drawQuestions: (_difficulty, requested) => questions.slice(0, requested) }, options);
}
