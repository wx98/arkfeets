import { matchesAnswer } from "../question/answerMatcher.js";
import type { Difficulty, Question } from "../question/types.js";
import type { QuestionRepository } from "../question/questionRepository.js";
import type { AnswerAudit, GameEndAudit, GameStartAudit } from "./gameAuditLogger.js";

export type MultiplayerRoomState = "LOBBY" | "ANSWERING" | "REVEAL" | "RANKING";
export type AnswerSource = "WEB" | "EXTERNAL_API" | "BILIBILI";

export interface MultiplayerRoomView {
  roomCode: string;
  state: MultiplayerRoomState;
  isHost: boolean;
  difficulty: Difficulty;
  requestedCount: number;
  answerSource: AnswerSource;
  bilibiliConnected?: boolean;
  players: Array<{
    sessionId: string;
    nickname: string;
    score: number;
    connected: boolean;
    isHost: boolean;
    isContender: boolean;
    source: "WEB" | "EXTERNAL" | "BILIBILI";
  }>;
  question?: {
    id: string;
    title?: string;
    hint?: string;
    imageUrl: string;
    crop: import("../question/types.js").CropRect;
    index: number;
    total: number;
    durationSeconds: number;
    startedAt: number;
    endsAt: number;
    overtime: boolean;
  };
  reveal?: { imageUrl: string; answers: string[]; winnerNickname?: string; timedOut?: boolean };
  rankingEndsAt?: number;
  winnerSessionIds?: string[];
  feedback?: string;
}

interface Player {
  sessionId: string;
  nickname: string;
  score: number;
  connected: boolean;
  joinedAt: number;
  source: "WEB" | "EXTERNAL" | "BILIBILI";
}

interface Room {
  code: string;
  hostSessionId: string;
  difficulty: Difficulty;
  requestedCount: number;
  answerSource: AnswerSource;
  bilibiliConnected: boolean;
  state: MultiplayerRoomState;
  players: Map<string, Player>;
  questions: Question[];
  regularQuestionCount: number;
  currentIndex: number;
  overtime: boolean;
  contenderSessionIds: Set<string>;
  startedAt: number;
  endsAt: number;
  rankingEndsAt?: number;
  roundWinnerSessionId?: string;
  revealTimedOut?: boolean;
  winnerSessionIds?: string[];
  timer?: ReturnType<typeof setTimeout>;
}

interface ManagerOptions {
  durationSeconds?: Partial<Record<Difficulty, number>>;
  rankingDurationMs?: number;
  onRoomUpdated?: (roomCode: string) => void;
  onRoomClosed?: (roomCode: string, message: string) => void;
  onGameStarted?: (roomCode: string, details: GameStartAudit) => void;
  onAnswerReceived?: (roomCode: string, details: AnswerAudit) => void;
  onGameEnded?: (roomCode: string, details: GameEndAudit) => void;
}

const defaultDurations: Record<Difficulty, number> = {
  simple: 90,
  medium: 60,
  hard: 30,
  hell: 10,
};

export class MultiplayerRoomManager {
  private readonly rooms = new Map<string, Room>();
  private activeExternalRoomCode?: string;
  private activeBilibiliRoomCode?: string;
  private readonly durations: Record<Difficulty, number>;
  private readonly rankingDurationMs: number;
  private readonly onRoomUpdated: (roomCode: string) => void;
  private readonly onRoomClosed: (roomCode: string, message: string) => void;
  private readonly onGameStarted: NonNullable<ManagerOptions["onGameStarted"]>;
  private readonly onAnswerReceived: NonNullable<ManagerOptions["onAnswerReceived"]>;
  private readonly onGameEnded: NonNullable<ManagerOptions["onGameEnded"]>;

  constructor(private readonly questionRepository: Pick<QuestionRepository, "drawQuestions">, options: ManagerOptions = {}) {
    this.durations = { ...defaultDurations, ...options.durationSeconds };
    this.rankingDurationMs = options.rankingDurationMs ?? 30_000;
    this.onRoomUpdated = options.onRoomUpdated ?? (() => undefined);
    this.onRoomClosed = options.onRoomClosed ?? (() => undefined);
    this.onGameStarted = options.onGameStarted ?? (() => undefined);
    this.onAnswerReceived = options.onAnswerReceived ?? (() => undefined);
    this.onGameEnded = options.onGameEnded ?? (() => undefined);
  }

  createRoom(input: { roomCode: string; sessionId: string; nickname: string; difficulty: Difficulty; requestedCount: number; answerSource?: AnswerSource }) {
    const code = normalizeRoomCode(input.roomCode);
    if (this.rooms.has(code)) throw new Error("房间号已存在");
    validateSession(input.sessionId, input.nickname);
    if (![20, 50, 100].includes(input.requestedCount)) throw new Error("题目数量不合法");

    const room: Room = {
      code,
      hostSessionId: input.sessionId,
      difficulty: input.difficulty,
      requestedCount: input.requestedCount,
      answerSource: input.answerSource ?? "WEB",
      bilibiliConnected: false,
      state: "LOBBY",
      players: new Map(),
      questions: [],
      regularQuestionCount: 0,
      currentIndex: 0,
      overtime: false,
      contenderSessionIds: new Set(),
      startedAt: 0,
      endsAt: 0,
    };
    room.players.set(input.sessionId, createPlayer(input.sessionId, input.nickname));
    this.rooms.set(code, room);
    return this.toView(room, input.sessionId);
  }

  joinRoom(roomCode: string, sessionId: string, nickname: string) {
    const room = this.getRoom(roomCode);
    validateSession(sessionId, nickname);
    const existing = room.players.get(sessionId);
    if (existing) {
      existing.connected = true;
      existing.nickname = nickname.trim();
      this.changed(room);
      return this.toView(room, sessionId);
    }
    if (room.state !== "LOBBY") throw new Error("游戏已经开始，暂时不能加入");
    if (room.players.size >= 20) throw new Error("房间已满（20 人）");
    room.players.set(sessionId, createPlayer(sessionId, nickname));
    this.changed(room);
    return this.toView(room, sessionId);
  }

  start(roomCode: string, sessionId: string) {
    const room = this.getRoom(roomCode);
    this.assertCanStart(roomCode, sessionId);
    if (room.answerSource === "EXTERNAL_API" && this.activeExternalRoomCode && this.activeExternalRoomCode !== room.code) {
      throw new Error(`外部答案接口正被房间 ${this.activeExternalRoomCode} 使用`);
    }
    const questions = this.questionRepository.drawQuestions(room.difficulty, 1_000_000);
    if (questions.length === 0) throw new Error("当前难度没有可用题目");
    this.onGameStarted(room.code, {
      answerSource: room.answerSource, difficulty: room.difficulty,
      requestedCount: room.requestedCount, questionCount: Math.min(room.requestedCount, questions.length),
    });
    room.questions = questions;
    room.regularQuestionCount = Math.min(room.requestedCount, questions.length);
    room.currentIndex = 0;
    room.overtime = false;
    room.winnerSessionIds = undefined;
    for (const player of room.players.values()) player.score = 0;
    room.contenderSessionIds = new Set(room.players.keys());
    if (room.answerSource === "EXTERNAL_API") this.activeExternalRoomCode = room.code;
    if (room.answerSource === "BILIBILI") this.activeBilibiliRoomCode = room.code;
    this.beginQuestion(room);
    return this.toView(room, sessionId);
  }

  answer(roomCode: string, sessionId: string, answer: string, source: "WEB" | "EXTERNAL_API" = "WEB") {
    const room = this.getRoom(roomCode);
    if (room.answerSource !== source) throw new Error("当前房间不接受网页答案");
    const player = this.getPlayer(room, sessionId);
    if (room.state !== "ANSWERING") throw new Error("当前题已结束");
    if (room.overtime && !room.contenderSessionIds.has(sessionId)) throw new Error("加时赛仅限并列玩家作答");
    if (Date.now() >= room.endsAt) {
      this.handleTimeout(room);
      throw new Error("本题已经超时");
    }
    if (!matchesAnswer(answer, this.currentQuestion(room).answers)) {
      this.auditAnswer(room, player, answer, false);
      return { view: this.toView(room, sessionId, "还不对，再想想"), correct: false };
    }

    this.clearTimer(room);
    player.score += 1;
    this.auditAnswer(room, player, answer, true);
    room.state = "REVEAL";
    room.roundWinnerSessionId = sessionId;
    this.changed(room);
    return { view: this.toView(room, sessionId, "抢答成功，得分 +1"), correct: true };
  }

  submitExternalAnswer(userName: string, answer: string) {
    const roomCode = this.activeExternalRoomCode;
    if (!roomCode) throw new Error("当前没有活动的外部接口房间");
    const room = this.getRoom(roomCode);
    if (room.answerSource !== "EXTERNAL_API" || room.state !== "ANSWERING") {
      throw new Error("当前外部接口房间不接受答案");
    }

    const normalizedName = normalizeExternalName(userName);
    const sessionId = `external:${normalizedName}`;
    let player = room.players.get(sessionId);
    if (!player) {
      if (room.overtime) throw new Error("加时赛不接受新玩家");
      if (room.players.size >= 20) throw new Error("房间已满（20 人）");
      player = createPlayer(sessionId, normalizedName, "EXTERNAL");
      room.players.set(sessionId, player);
      room.contenderSessionIds.add(sessionId);
      this.changed(room);
    }

    const result = this.answer(room.code, sessionId, answer, "EXTERNAL_API");
    return {
      accepted: true,
      correct: result.correct,
      message: result.correct ? "回答正确，得分 +1" : "答案已接收",
      userName: player.nickname,
      score: player.score,
    };
  }

  assertCanStart(roomCode: string, sessionId: string): void {
    const room = this.getRoom(roomCode);
    this.assertHost(room, sessionId);
    if (room.state !== "LOBBY") throw new Error("当前不能开始游戏");
    if (room.answerSource === "BILIBILI" && this.activeBilibiliRoomCode && this.activeBilibiliRoomCode !== room.code) {
      throw new Error("已有直播间游戏正在进行");
    }
  }

  getAnswerSource(roomCode: string): AnswerSource {
    return this.getRoom(roomCode).answerSource;
  }

  getActiveBilibiliRoomCode(): string | undefined {
    return this.activeBilibiliRoomCode;
  }

  setBilibiliConnection(roomCode: string, connected: boolean): void {
    const room = this.rooms.get(normalizeRoomCode(roomCode));
    if (!room || room.answerSource !== "BILIBILI" || room.bilibiliConnected === connected) return;
    room.bilibiliConnected = connected;
    this.changed(room);
  }

  submitBilibiliAnswer(uid: string, nickname: string, answer: string): boolean {
    const roomCode = this.activeBilibiliRoomCode;
    if (!roomCode) return false;
    const room = this.getRoom(roomCode);
    if (room.state !== "ANSWERING" || !room.bilibiliConnected || Date.now() >= room.endsAt) return false;
    const sessionId = `bilibili:${uid}`;
    if (room.overtime && !room.contenderSessionIds.has(sessionId)) return false;
    let player = room.players.get(sessionId);
    if (!player) {
      player = createPlayer(sessionId, nickname, "BILIBILI");
      room.players.set(sessionId, player);
      this.changed(room);
    } else if (player.nickname !== nickname) {
      player.nickname = nickname;
      this.changed(room);
    }
    const normalized = (value: string) => value.trim().toLocaleLowerCase();
    if (!normalized(answer) || !this.currentQuestion(room).answers.some((valid) => normalized(valid) === normalized(answer))) {
      this.auditAnswer(room, player, answer, false);
      return false;
    }
    this.clearTimer(room);
    player.score += 1;
    this.auditAnswer(room, player, answer, true);
    room.state = "REVEAL";
    room.roundWinnerSessionId = sessionId;
    this.changed(room);
    return true;
  }

  next(roomCode: string, sessionId: string) {
    const room = this.getRoom(roomCode);
    this.assertHost(room, sessionId);
    if (room.state !== "REVEAL" || room.revealTimedOut) throw new Error("当前不能进入下一题");
    this.advanceAfterQuestion(room);
    return this.toView(room, sessionId);
  }

  skipRanking(roomCode: string, sessionId: string) {
    const room = this.getRoom(roomCode);
    this.assertHost(room, sessionId);
    if (room.state !== "RANKING") throw new Error("当前不在排名展示阶段");
    this.resetToLobby(room);
    return this.toView(room, sessionId);
  }

  disconnect(roomCode: string, sessionId: string): void {
    const room = this.rooms.get(normalizeRoomCode(roomCode));
    if (!room || !room.players.has(sessionId)) return;
    if (room.hostSessionId === sessionId) {
      this.destroyRoom(room, "房主已离开，房间已解散");
      return;
    }
    room.players.get(sessionId)!.connected = false;
    this.changed(room);
  }

  leave(roomCode: string, sessionId: string): void {
    const room = this.getRoom(roomCode);
    if (room.hostSessionId === sessionId) {
      this.destroyRoom(room, "房主已离开，房间已解散");
      return;
    }
    room.players.delete(sessionId);
    room.contenderSessionIds.delete(sessionId);
    this.changed(room);
  }

  getView(roomCode: string, sessionId: string): MultiplayerRoomView {
    return this.toView(this.getRoom(roomCode), sessionId);
  }

  hasRoom(roomCode: string): boolean {
    return this.rooms.has(normalizeRoomCode(roomCode));
  }

  dispose(): void {
    for (const room of this.rooms.values()) {
      this.clearTimer(room);
      if (room.questions.length) this.auditEnd(room, "server_stopped");
    }
    this.rooms.clear();
    this.activeExternalRoomCode = undefined;
    this.activeBilibiliRoomCode = undefined;
  }

  private beginQuestion(room: Room): void {
    this.clearTimer(room);
    const now = Date.now();
    room.state = "ANSWERING";
    room.startedAt = now;
    room.endsAt = now + this.durations[room.difficulty] * 1000;
    room.roundWinnerSessionId = undefined;
    room.revealTimedOut = false;
    room.timer = setTimeout(() => this.handleTimeout(room), room.endsAt - now + 20);
    room.timer.unref?.();
    this.changed(room);
  }

  private handleTimeout(room: Room): void {
    if (room.state !== "ANSWERING") return;
    this.clearTimer(room);
    room.state = "REVEAL";
    room.revealTimedOut = true;
    this.changed(room);
    room.timer = setTimeout(() => this.advanceAfterQuestion(room), 1_250);
    room.timer.unref?.();
  }

  private advanceAfterQuestion(room: Room): void {
    this.clearTimer(room);
    if (!room.overtime && room.currentIndex + 1 < room.regularQuestionCount) {
      room.currentIndex += 1;
      this.beginQuestion(room);
      return;
    }

    const leaders = this.leaderIds(room);
    if (!room.overtime && leaders.length > 1 && room.regularQuestionCount < room.questions.length) {
      room.overtime = true;
      room.contenderSessionIds = new Set(leaders);
      room.currentIndex = room.regularQuestionCount;
      this.beginQuestion(room);
      return;
    }

    if (room.overtime && leaders.length > 1 && room.currentIndex + 1 < room.questions.length) {
      room.contenderSessionIds = new Set(leaders);
      room.currentIndex += 1;
      this.beginQuestion(room);
      return;
    }
    this.finish(room, leaders);
  }

  private finish(room: Room, winnerSessionIds: string[]): void {
    this.clearTimer(room);
    room.state = "RANKING";
    this.auditEnd(room, "completed");
    this.releaseExternalRoom(room);
    this.releaseBilibiliRoom(room);
    room.winnerSessionIds = winnerSessionIds;
    room.rankingEndsAt = Date.now() + this.rankingDurationMs;
    room.timer = setTimeout(() => this.resetToLobby(room), this.rankingDurationMs);
    room.timer.unref?.();
    this.changed(room);
  }

  private resetToLobby(room: Room): void {
    this.clearTimer(room);
    room.state = "LOBBY";
    this.releaseExternalRoom(room);
    this.releaseBilibiliRoom(room);
    for (const [sessionId, player] of room.players) {
      if (player.source === "EXTERNAL" || player.source === "BILIBILI") room.players.delete(sessionId);
    }
    room.questions = [];
    room.currentIndex = 0;
    room.regularQuestionCount = 0;
    room.overtime = false;
    room.contenderSessionIds = new Set(room.players.keys());
    room.rankingEndsAt = undefined;
    room.winnerSessionIds = undefined;
    room.roundWinnerSessionId = undefined;
    for (const player of room.players.values()) player.score = 0;
    this.changed(room);
  }

  private leaderIds(room: Room): string[] {
    const candidates = room.overtime
      ? [...room.players.values()].filter((player) => room.contenderSessionIds.has(player.sessionId))
      : [...room.players.values()];
    const highest = Math.max(...candidates.map((player) => player.score));
    return candidates.filter((player) => player.score === highest).map((player) => player.sessionId);
  }

  private toView(room: Room, sessionId: string, feedback?: string): MultiplayerRoomView {
    const question = room.questions[room.currentIndex];
    const showQuestion = room.state === "ANSWERING" || room.state === "REVEAL";
    const reveal = room.state === "REVEAL" && question ? {
      imageUrl: question.originalImageUrl,
      answers: question.answers,
      winnerNickname: room.roundWinnerSessionId ? room.players.get(room.roundWinnerSessionId)?.nickname : undefined,
      timedOut: room.revealTimedOut,
    } : undefined;
    return {
      roomCode: room.code,
      state: room.state,
      isHost: room.hostSessionId === sessionId,
      difficulty: room.difficulty,
      requestedCount: room.requestedCount,
      answerSource: room.answerSource,
      bilibiliConnected: room.answerSource === "BILIBILI" ? room.bilibiliConnected : undefined,
      players: [...room.players.values()]
        .sort((left, right) => right.score - left.score || left.joinedAt - right.joinedAt)
        .map((player) => ({
          sessionId: player.sessionId,
          nickname: player.nickname,
          score: player.score,
          connected: player.connected,
          isHost: player.sessionId === room.hostSessionId,
          isContender: !room.overtime || room.contenderSessionIds.has(player.sessionId),
          source: player.source,
        })),
      question: showQuestion && question ? {
        id: question.id,
        title: question.title,
        hint: question.hint,
        imageUrl: question.originalImageUrl,
        crop: question.question,
        index: room.currentIndex + 1,
        total: room.overtime ? room.questions.length : room.regularQuestionCount,
        durationSeconds: this.durations[room.difficulty],
        startedAt: room.startedAt,
        endsAt: room.endsAt,
        overtime: room.overtime,
      } : undefined,
      reveal,
      rankingEndsAt: room.rankingEndsAt,
      winnerSessionIds: room.winnerSessionIds,
      feedback,
    };
  }

  private currentQuestion(room: Room): Question {
    const question = room.questions[room.currentIndex];
    if (!question) throw new Error("题库已耗尽");
    return question;
  }

  private auditAnswer(room: Room, player: Player, answer: string, correct: boolean): void {
    const question = this.currentQuestion(room);
    const ranked = this.rankedPlayers(room);
    this.onAnswerReceived(room.code, {
      answerSource: room.answerSource,
      questionId: question.id,
      questionIndex: room.currentIndex + 1,
      overtime: room.overtime,
      standardAnswers: [...question.answers],
      userId: player.sessionId,
      nickname: player.nickname,
      answer,
      correct,
      score: player.score,
      rank: ranked.findIndex(item => item.sessionId === player.sessionId) + 1,
    });
  }

  private auditEnd(room: Room, reason: GameEndAudit["reason"]): void {
    this.onGameEnded(room.code, {
      reason,
      players: this.rankedPlayers(room).map((player, index) => ({
        userId: player.sessionId, nickname: player.nickname, score: player.score, rank: index + 1,
      })),
    });
  }

  private rankedPlayers(room: Room): Player[] {
    return [...room.players.values()].sort((left, right) => right.score - left.score || left.joinedAt - right.joinedAt);
  }

  private getRoom(roomCode: string): Room {
    const room = this.rooms.get(normalizeRoomCode(roomCode));
    if (!room) throw new Error("房间不存在或已解散");
    return room;
  }

  private getPlayer(room: Room, sessionId: string): Player {
    const player = room.players.get(sessionId);
    if (!player) throw new Error("你不在当前房间");
    return player;
  }

  private assertHost(room: Room, sessionId: string): void {
    if (room.hostSessionId !== sessionId) throw new Error("仅房主可以执行此操作");
  }

  private clearTimer(room: Room): void {
    if (room.timer) clearTimeout(room.timer);
    room.timer = undefined;
  }

  private changed(room: Room): void {
    this.onRoomUpdated(room.code);
  }

  private destroyRoom(room: Room, message: string): void {
    this.clearTimer(room);
    if (room.questions.length && room.state !== "RANKING") this.auditEnd(room, "room_closed");
    this.releaseExternalRoom(room);
    this.releaseBilibiliRoom(room);
    this.rooms.delete(room.code);
    this.onRoomClosed(room.code, message);
  }

  private releaseExternalRoom(room: Room): void {
    if (this.activeExternalRoomCode === room.code) this.activeExternalRoomCode = undefined;
  }

  private releaseBilibiliRoom(room: Room): void {
    if (this.activeBilibiliRoomCode === room.code) this.activeBilibiliRoomCode = undefined;
    room.bilibiliConnected = false;
  }
}

function normalizeRoomCode(value: string): string {
  const normalized = value.replace(/\s/gu, "").toUpperCase();
  if (normalized.length < 2 || normalized.length > 20) throw new Error("房间号需为 2-20 个非空字符");
  return normalized;
}

function validateSession(sessionId: string, nickname: string): void {
  if (sessionId.trim().length < 8) throw new Error("客户端身份无效");
  if (nickname.trim().length < 1 || nickname.trim().length > 20) throw new Error("玩家代号需为 1-20 个字符");
}

function normalizeExternalName(value: string): string {
  const normalized = value.replace(/\s/gu, "");
  if (normalized.length < 1 || normalized.length > 20) throw new Error("用户昵称需为 1-20 个非空字符");
  return normalized;
}

function createPlayer(sessionId: string, nickname: string, source: "WEB" | "EXTERNAL" | "BILIBILI" = "WEB"): Player {
  return { sessionId, nickname: nickname.trim(), score: 0, connected: true, joinedAt: Date.now(), source };
}
