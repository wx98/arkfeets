import { randomUUID } from "node:crypto";
import { matchesAnswer } from "../question/answerMatcher.js";
import type { Difficulty, Question } from "../question/types.js";
import type { QuestionRepository } from "../question/questionRepository.js";
import { defaultGamePreferences, type GamePreferences } from "../gamePreferences.js";

type SoloState = "ANSWERING" | "REVEAL" | "FINISHED";
type SoloEndReason = "COMPLETED" | "LIFE_EMPTY" | "QUESTION_EXHAUSTED";

const durationByDifficulty: Record<Difficulty, number> = {
  simple: 90,
  medium: 60,
  hard: 30,
  hell: 10,
};

interface SoloSession {
  id: string;
  difficulty: Difficulty;
  requestedCount: number;
  questions: Question[];
  currentIndex: number;
  lives: number;
  score: number;
  attempted: number;
  state: SoloState;
  startedAt: number;
  endsAt: number;
  feedback?: string;
  revealCorrect?: boolean;
  endReason?: SoloEndReason;
  preferences: GamePreferences;
  revealEndsAt?: number;
}

export class SoloSessionManager {
  private readonly sessions = new Map<string, SoloSession>();

  constructor(private readonly questions: QuestionRepository, private readonly readPreferences: () => GamePreferences = () => defaultGamePreferences) {}

  create(difficulty: Difficulty, requestedCount: number) {
    const selected = this.questions.drawQuestions(difficulty, requestedCount);
    if (selected.length === 0) throw new Error("当前难度没有可用题目");
    const now = Date.now();
    const session: SoloSession = {
      id: randomUUID(),
      difficulty,
      requestedCount,
      questions: selected,
      currentIndex: 0,
      lives: 10,
      score: 0,
      attempted: 0,
      state: "ANSWERING",
      startedAt: now,
      endsAt: now + durationByDifficulty[difficulty] * 1000,
      preferences: this.readPreferences(),
    };
    this.sessions.set(session.id, session);
    return this.toView(session);
  }

  answer(id: string, answer: string) {
    const session = this.get(id);
    this.assertAnswering(session);
    if (Date.now() >= session.endsAt) return this.timeout(id, true);
    if (!matchesAnswer(answer, this.currentQuestion(session).answers)) {
      session.feedback = "还不对，再想想";
      return this.toView(session);
    }

    const durationMs = durationByDifficulty[session.difficulty] * 1000;
    const isFast = session.endsAt - Date.now() >= durationMs * 0.8;
    session.score += 1;
    session.attempted += 1;
    session.lives = isFast ? Math.min(10, session.lives + 1) : session.lives;
    session.state = "REVEAL";
    session.revealCorrect = true;
    this.beginReveal(session);
    session.feedback = isFast ? "命中，快速作答生命 +1" : "命中";
    return this.toView(session);
  }

  skip(id: string) {
    const session = this.get(id);
    this.assertAnswering(session);
    session.attempted += 1;
    session.lives = Math.max(0, session.lives - 1);
    session.state = "REVEAL";
    session.revealCorrect = false;
    this.beginReveal(session);
    session.feedback = "已跳过，生命 -1";
    return this.toView(session);
  }

  timeout(id: string, force = false) {
    const session = this.get(id);
    this.assertAnswering(session);
    if (!force && Date.now() + 250 < session.endsAt) return this.toView(session);
    session.attempted += 1;
    session.lives = Math.max(0, session.lives - 1);
    session.state = "REVEAL";
    session.revealCorrect = false;
    this.beginReveal(session);
    session.feedback = "时间到，生命 -1";
    return this.toView(session);
  }

  next(id: string) {
    const session = this.get(id);
    if (session.state !== "REVEAL") throw new Error("当前不能进入下一题");
    if (session.lives === 0) return this.finish(session, "LIFE_EMPTY");

    if (session.currentIndex + 1 >= session.questions.length) {
      const reason = session.questions.length < session.requestedCount ? "QUESTION_EXHAUSTED" : "COMPLETED";
      return this.finish(session, reason);
    }

    session.currentIndex += 1;
    const now = Date.now();
    session.state = "ANSWERING";
    session.revealEndsAt = undefined;
    session.revealCorrect = undefined;
    session.startedAt = now;
    session.endsAt = now + durationByDifficulty[session.difficulty] * 1000;
    session.feedback = undefined;
    return this.toView(session);
  }

  private get(id: string): SoloSession {
    const session = this.sessions.get(id);
    if (!session) throw new Error("游戏会话不存在或已失效");
    return session;
  }

  private beginReveal(session: SoloSession): void {
    session.revealEndsAt = session.preferences.autoNext ? Date.now() + session.preferences.revealSeconds * 1000 : undefined;
  }

  private currentQuestion(session: SoloSession): Question {
    return session.questions[session.currentIndex];
  }

  private assertAnswering(session: SoloSession): void {
    if (session.state !== "ANSWERING") throw new Error("当前题已结束");
  }

  private finish(session: SoloSession, reason: SoloEndReason) {
    session.state = "FINISHED";
    session.endReason = reason;
    session.feedback = undefined;
    return this.toView(session);
  }

  private toView(session: SoloSession) {
    const question = this.currentQuestion(session);
    const reveal = session.state === "ANSWERING" ? undefined : {
      imageUrl: question.originalImageUrl,
      answers: question.answers,
      correct: session.revealCorrect === true,
    };
    return {
      sessionId: session.id,
      state: session.state,
      difficulty: session.difficulty,
      question: {
        id: question.id,
        title: question.title,
        hint: question.hint,
        imageUrl: question.originalImageUrl,
        crop: question.question,
        index: session.currentIndex + 1,
        total: session.questions.length,
        durationSeconds: durationByDifficulty[session.difficulty],
        startedAt: session.startedAt,
        endsAt: session.endsAt,
        hintRemainingPercent: session.preferences.hintRemainingPercent,
      },
      reveal,
      revealEndsAt: session.revealEndsAt,
      preferences: session.preferences,
      stats: {
        score: session.score,
        lives: session.lives,
        attempted: session.attempted,
        correctRate: session.attempted === 0 ? 0 : Math.round((session.score / session.attempted) * 100),
      },
      feedback: session.feedback,
      endReason: session.endReason,
    };
  }
}
