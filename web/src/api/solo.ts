import type { Difficulty, SoloGameView } from "../types";

async function request(path: string, body?: unknown): Promise<SoloGameView> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message ?? "请求失败");
  return data;
}

export const soloApi = {
  create: (difficulty: Difficulty, totalQuestions: number) =>
    request("/api/solo/sessions", { difficulty, totalQuestions }),
  answer: (sessionId: string, answer: string) =>
    request(`/api/solo/sessions/${sessionId}/answer`, { answer }),
  skip: (sessionId: string) => request(`/api/solo/sessions/${sessionId}/skip`),
  timeout: (sessionId: string) => request(`/api/solo/sessions/${sessionId}/timeout`),
  next: (sessionId: string) => request(`/api/solo/sessions/${sessionId}/next`),
};
