import { Router } from "express";
import { z } from "zod";
import type { MultiplayerRoomManager } from "../multiplayer/multiplayerRoomManager.js";

const externalAnswerSchema = z.object({
  userName: z.string().max(100),
  answer: z.string().max(100),
}).strict();

export function createGameRoutes(manager: MultiplayerRoomManager): Router {
  const router = Router();
  router.post("/submit-answer", (request, response) => {
    try {
      const input = externalAnswerSchema.parse(request.body);
      response.json(manager.submitExternalAnswer(input.userName, input.answer));
    } catch (error) {
      const message = error instanceof Error ? error.message : "提交失败";
      const noActiveGame = message.includes("没有活动") || message.includes("不接受答案");
      response.status(noActiveGame ? 409 : 400).json({ accepted: false, correct: false, message });
    }
  });
  return router;
}
