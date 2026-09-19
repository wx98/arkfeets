export const difficulties = ["simple", "medium", "hard", "hell"] as const;

export type Difficulty = (typeof difficulties)[number];

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
}

export interface Question {
  id: string;
  title?: string;
  answers: string[];
  hint?: string;
  difficulty: Difficulty[];
  tags: string[];
  originalImageUrl: string;
  question: CropRect;
  enabled: boolean;
}

export interface QuestionValidationItem {
  id: string;
  valid: boolean;
  errors: string[];
}
