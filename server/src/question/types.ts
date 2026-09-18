export const difficulties = ["simple", "medium", "hard", "hell"] as const;

export type Difficulty = (typeof difficulties)[number];

export interface Question {
  id: string;
  title?: string;
  answers: string[];
  hint?: string;
  difficulty: Difficulty[];
  tags: string[];
  questionImgUrl: string;
  answerRevealImgUrl: string;
  enabled: boolean;
}

export interface QuestionValidationItem {
  id: string;
  valid: boolean;
  errors: string[];
}
