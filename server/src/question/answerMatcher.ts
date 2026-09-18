export function normalizeAnswer(value: string): string {
  return value.replace(/\s/gu, "");
}

export function matchesAnswer(input: string, answers: string[]): boolean {
  const normalizedInput = normalizeAnswer(input);
  return normalizedInput.length > 0 && answers.some((answer) => normalizeAnswer(answer) === normalizedInput);
}
