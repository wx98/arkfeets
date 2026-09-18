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
