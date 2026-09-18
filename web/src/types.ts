export type Difficulty = "simple" | "medium" | "hard" | "hell";
export type SoloState = "ANSWERING" | "REVEAL" | "FINISHED";

export interface SoloGameView {
  sessionId: string;
  state: SoloState;
  difficulty: Difficulty;
  question: {
    id: string;
    title?: string;
    hint?: string;
    imageUrl: string;
    index: number;
    total: number;
    durationSeconds: number;
    startedAt: number;
    endsAt: number;
  };
  reveal?: { imageUrl: string; answers: string[] };
  stats: { score: number; lives: number; attempted: number; correctRate: number };
  feedback?: string;
  endReason?: "COMPLETED" | "LIFE_EMPTY" | "QUESTION_EXHAUSTED";
}

export type MultiplayerRoomState = "LOBBY" | "ANSWERING" | "REVEAL" | "RANKING";

export interface MultiplayerRoomView {
  roomCode: string;
  state: MultiplayerRoomState;
  isHost: boolean;
  difficulty: Difficulty;
  requestedCount: number;
  players: Array<{
    sessionId: string;
    nickname: string;
    score: number;
    connected: boolean;
    isHost: boolean;
    isContender: boolean;
  }>;
  question?: {
    id: string;
    title?: string;
    hint?: string;
    imageUrl: string;
    index: number;
    total: number;
    durationSeconds: number;
    startedAt: number;
    endsAt: number;
    overtime: boolean;
  };
  reveal?: { imageUrl: string; answers: string[]; winnerNickname?: string };
  rankingEndsAt?: number;
  winnerSessionIds?: string[];
  feedback?: string;
}
