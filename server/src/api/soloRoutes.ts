import { Router } from "express";
import { z } from "zod";
import { difficulties } from "../question/types.js";
import type { SoloSessionManager } from "../solo/soloSessionManager.js";

const createSchema = z.object({
  difficulty: z.enum(difficulties),
  totalQuestions: z.union([z.literal(20), z.literal(50), z.literal(100)]),
});
const answerSchema = z.object({ answer: z.string().max(100) });

export function createSoloRoutes(manager: SoloSessionManager): Router {
  const router = Router();

  router.post("/sessions", (request, response) => {
    run(response, () => {
      const input = createSchema.parse(request.body);
      return manager.create(input.difficulty, input.totalQuestions);
    });
  });

  router.post("/sessions/:id/answer", (request, response) => {
    run(response, () => manager.answer(request.params.id, answerSchema.parse(request.body).answer));
  });
  router.post("/sessions/:id/skip", (request, response) => run(response, () => manager.skip(request.params.id)));
  router.post("/sessions/:id/timeout", (request, response) => run(response, () => manager.timeout(request.params.id)));
  router.post("/sessions/:id/next", (request, response) => run(response, () => manager.next(request.params.id)));
  return router;
}

function run(response: import("express").Response, action: () => unknown): void {
  try {
    response.json(action());
  } catch (error) {
    const message = error instanceof Error ? error.message : "请求失败";
    response.status(400).json({ message });
  }
}
