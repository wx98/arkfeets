import { describe, expect, it, vi } from "vitest";
import { relayLiveDanmaku } from "./liveDanmakuRelay.js";

const answer = { uid: "42", nickname: "博士", answer: "错误答案", messageId: "m-1", timestamp: 1234 };

describe("live danmaku relay", () => {
  it("broadcasts accepted text in the current question without revealing correct answers", () => {
    const emit = vi.fn();
    const manager = {
      getActiveBilibiliRoomCode: () => "LIVE",
      getView: () => ({ state: "ANSWERING", question: { id: "q1", answers: ["秘密答案"] } }),
      submitBilibiliAnswer: vi.fn(() => false),
    };
    relayLiveDanmaku(manager as never, { to: () => ({ emit }) } as never, "LIVE", answer);
    expect(manager.submitBilibiliAnswer).toHaveBeenCalledWith("42", "博士", "错误答案");
    expect(emit).toHaveBeenCalledWith("room:danmaku", {
      roomCode: "LIVE", questionId: "q1", messageId: "m-1", nickname: "博士", content: "错误答案", timestamp: 1234,
    });
    expect(JSON.stringify(emit.mock.calls)).not.toContain("秘密答案");
  });

  it("ignores an inactive live room", () => {
    const submit = vi.fn();
    const emit = vi.fn();
    relayLiveDanmaku({
      getActiveBilibiliRoomCode: () => undefined,
      getView: () => { throw new Error("should not load"); },
      submitBilibiliAnswer: submit,
    } as never, { to: () => ({ emit }) } as never, "LIVE", answer);
    expect(submit).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });
});
