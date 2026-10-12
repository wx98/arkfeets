export type Difficulty = "simple" | "medium" | "hard" | "hell";
export type SoloState = "ANSWERING" | "REVEAL" | "FINISHED";
import type { GamePreferences } from "./api/gameSetup";
export interface CropRect { x: number; y: number; width: number; height: number; sourceWidth: number; sourceHeight: number }

export interface SoloGameView {
  sessionId: string;
  state: SoloState;
  difficulty: Difficulty;
  question: {
    id: string;
    title?: string;
    hint?: string;
    imageUrl: string;
    crop: CropRect;
    index: number;
    total: number;
    durationSeconds: number;
    startedAt: number;
    endsAt: number;
    hintRemainingPercent: number;
  };
  reveal?: { imageUrl: string; answers: string[] };
  revealEndsAt?: number;
  preferences: GamePreferences;
  stats: { score: number; lives: number; attempted: number; correctRate: number };
  feedback?: string;
  endReason?: "COMPLETED" | "LIFE_EMPTY" | "QUESTION_EXHAUSTED";
}

export type MultiplayerRoomState = "LOBBY" | "ANSWERING" | "REVEAL" | "RANKING";
export type AnswerSource = "WEB" | "EXTERNAL_API" | "BILIBILI";

export interface LiveDanmakuEvent {
  roomCode: string;
  questionId: string;
  messageId: string;
  nickname: string;
  content: string;
  timestamp: number;
}

export interface MultiplayerRoomView {
  roomCode: string;
  state: MultiplayerRoomState;
  isHost: boolean;
  difficulty: Difficulty;
  requestedCount: number;
  topicId: string;
  topicName: string;
  durationSeconds: number;
  preferences: GamePreferences;
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
    crop: CropRect;
    index: number;
    total: number;
    durationSeconds: number;
    startedAt: number;
    endsAt: number;
    overtime: boolean;
    hintRemainingPercent: number;
  };
  reveal?: { imageUrl: string; answers: string[]; winnerNickname?: string; timedOut?: boolean };
  revealEndsAt?: number;
  rankingEndsAt?: number;
  winnerSessionIds?: string[];
  feedback?: string;
}
