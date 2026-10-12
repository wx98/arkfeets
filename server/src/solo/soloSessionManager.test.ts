import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuestionRepository } from "../question/questionRepository.js";
import type { Question } from "../question/types.js";
import { SoloSessionManager } from "./soloSessionManager.js";

const question: Question = {
  id: "one", answers: ["answer"], hint: "hint", difficulty: ["medium"], tags: [],
  originalImageUrl: "/full-data/one.png",
  question: { x: 0, y: 0, width: 20, height: 20, sourceWidth: 100, sourceHeight: 100 },
  enabled: true,
};

afterEach(() => vi.useRealTimers());

describe("SoloSessionManager preferences", () => {
  it("exposes the hint threshold and keeps manual reveals open", () => {
    const manager = new SoloSessionManager({ drawQuestions: () => [question] } as unknown as QuestionRepository);
    const game = manager.create("medium", 20);
    expect(game.question.hintRemainingPercent).toBe(20);
    const reveal = manager.timeout(game.sessionId, true);
    expect(reveal.revealEndsAt).toBeUndefined();
    expect(reveal.reveal?.correct).toBe(false);
  });

  it("starts an auto-reveal deadline after a correct answer", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-13T00:00:00Z"));
    const manager = new SoloSessionManager({ drawQuestions: () => [question] } as unknown as QuestionRepository,
      () => ({ hintRemainingPercent: 35, revealSeconds: 12, autoNext: true }));
    const game = manager.create("medium", 20);
    const reveal = manager.answer(game.sessionId, "answer");
    expect(reveal.question.hintRemainingPercent).toBe(35);
    expect(reveal.revealEndsAt).toBe(Date.now() + 12_000);
    expect(reveal.reveal?.correct).toBe(true);
  });

  it("does not celebrate skipped questions or carry a win into the next question", () => {
    const manager = new SoloSessionManager({ drawQuestions: () => [question, { ...question, id: "two" }] } as unknown as QuestionRepository);
    const game = manager.create("medium", 20);
    expect(manager.skip(game.sessionId).reveal?.correct).toBe(false);
    expect(manager.next(game.sessionId).reveal).toBeUndefined();
    expect(manager.answer(game.sessionId, "answer").reveal?.correct).toBe(true);
  });
});
