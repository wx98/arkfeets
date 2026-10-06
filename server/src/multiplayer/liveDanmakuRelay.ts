import type { Server } from "socket.io";
import type { BilibiliTextAnswer } from "./bilibiliProtocol.js";
import type { MultiplayerRoomManager } from "./multiplayerRoomManager.js";

export function relayLiveDanmaku(
  manager: Pick<MultiplayerRoomManager, "getActiveBilibiliRoomCode" | "getView" | "submitBilibiliAnswer">,
  broadcaster: Pick<Server, "to">,
  roomCode: string,
  answer: BilibiliTextAnswer,
): void {
  if (manager.getActiveBilibiliRoomCode() !== roomCode) return;
  const view = manager.getView(roomCode, "");
  const questionId = view.state === "ANSWERING" ? view.question?.id : undefined;
  manager.submitBilibiliAnswer(answer.uid, answer.nickname, answer.answer);
  if (!questionId) return;
  broadcaster.to(roomCode).emit("room:danmaku", {
    roomCode,
    questionId,
    messageId: answer.messageId,
    nickname: answer.nickname,
    content: answer.answer,
    timestamp: answer.timestamp,
  });
}
