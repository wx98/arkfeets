import type { Server, Socket } from "socket.io";
import { z } from "zod";
import { difficulties } from "../question/types.js";
import { type AnswerSource, type MultiplayerRoomManager } from "./multiplayerRoomManager.js";
import type { BilibiliDanmakuBridge } from "./bilibiliDanmakuBridge.js";

const roomCodeSchema = z.string().min(2).max(20);
const identitySchema = z.object({ sessionId: z.string().min(8).max(100), nickname: z.string().trim().min(1).max(20) });
const roomSchema = z.object({ roomCode: roomCodeSchema });
const createSchema = identitySchema.extend({
  roomCode: roomCodeSchema,
  difficulty: z.enum(difficulties),
  requestedCount: z.union([z.literal(20), z.literal(50), z.literal(100)]),
  answerSource: z.enum(["WEB", "EXTERNAL_API", "BILIBILI"] satisfies [AnswerSource, AnswerSource, AnswerSource]),
});
const joinSchema = identitySchema.extend({ roomCode: roomCodeSchema });
const answerSchema = z.object({ roomCode: roomCodeSchema, answer: z.string().max(100) });

type Ack = (response: { ok: true; room: unknown } | { ok: false; message: string }) => void;

export function registerMultiplayerGateway(io: Server, manager: MultiplayerRoomManager, bilibiliBridge?: BilibiliDanmakuBridge): void {
  const startingRooms = new Set<string>();
  io.on("connection", (socket) => {
    socket.emit("server:ready", { connectedAt: Date.now() });

    socket.on("room:create", (payload, ack: Ack) => run(socket, ack, () => {
      const input = createSchema.parse(payload);
      const view = manager.createRoom(input);
      bindSocket(socket, view.roomCode, input.sessionId);
      return view;
    }));

    socket.on("room:join", (payload, ack: Ack) => run(socket, ack, () => {
      const input = joinSchema.parse(payload);
      const view = manager.joinRoom(input.roomCode, input.sessionId, input.nickname);
      bindSocket(socket, view.roomCode, input.sessionId);
      return view;
    }));

    socket.on("room:start", async (payload, ack: Ack) => {
      let roomCode: string | undefined;
      try {
        const input = roomSchema.parse(payload);
        roomCode = input.roomCode.toUpperCase();
        manager.assertCanStart(roomCode, requireSession(socket));
        if (startingRooms.has(roomCode)) throw new Error("正在连接直播间，请稍候");
        startingRooms.add(roomCode);
        if (manager.getAnswerSource(roomCode) === "BILIBILI") {
          if (!bilibiliBridge) throw new Error("直播间弹幕服务未配置");
          await bilibiliBridge.start(roomCode);
        }
        ack({ ok: true, room: manager.start(roomCode, requireSession(socket)) });
      } catch (error) {
        if (roomCode && bilibiliBridge?.roomCode === roomCode && !manager.getActiveBilibiliRoomCode()) bilibiliBridge.stop();
        ack({ ok: false, message: error instanceof Error ? error.message : "启动失败" });
      } finally {
        if (roomCode) startingRooms.delete(roomCode);
      }
    });
    socket.on("room:answer", (payload, ack: Ack) => run(socket, ack, () => {
      const input = answerSchema.parse(payload);
      return manager.answer(input.roomCode, requireSession(socket), input.answer).view;
    }));
    socket.on("room:next", (payload, ack: Ack) => run(socket, ack, () => {
      const input = roomSchema.parse(payload);
      return manager.next(input.roomCode, requireSession(socket));
    }));
    socket.on("room:skip-ranking", (payload, ack: Ack) => run(socket, ack, () => {
      const input = roomSchema.parse(payload);
      return manager.skipRanking(input.roomCode, requireSession(socket));
    }));
    socket.on("room:leave", (payload, ack: Ack) => run(socket, ack, () => {
      const input = roomSchema.parse(payload);
      manager.leave(input.roomCode, requireSession(socket));
      socket.leave(input.roomCode.toUpperCase());
      socket.data.roomCode = undefined;
      ack({ ok: true, room: null });
      return null;
    }, false));

    socket.on("disconnect", () => {
      if (socket.data.roomCode && socket.data.sessionId) manager.disconnect(socket.data.roomCode, socket.data.sessionId);
    });
  });

  async function emitRoom(roomCode: string): Promise<void> {
    const sockets = await io.in(roomCode).fetchSockets();
    for (const socket of sockets) {
      const sessionId = socket.data.sessionId as string | undefined;
      if (sessionId) socket.emit("room:update", manager.getView(roomCode, sessionId));
    }
  }

  managerCallbacks.set(manager, {
    update: (roomCode) => void emitRoom(roomCode),
    close: async (roomCode, message) => {
      const sockets = await io.in(roomCode).fetchSockets();
      for (const socket of sockets) {
        socket.emit("room:closed", { message });
        socket.leave(roomCode);
        socket.data.roomCode = undefined;
      }
    },
  });
}

interface GatewayCallbacks {
  update: (roomCode: string) => void;
  close: (roomCode: string, message: string) => void;
}

export const managerCallbacks = new WeakMap<MultiplayerRoomManager, GatewayCallbacks>();

function bindSocket(socket: Socket, roomCode: string, sessionId: string): void {
  if (socket.data.roomCode && socket.data.roomCode !== roomCode) socket.leave(socket.data.roomCode);
  socket.join(roomCode);
  socket.data.roomCode = roomCode;
  socket.data.sessionId = sessionId;
}

function requireSession(socket: Socket): string {
  const sessionId = socket.data.sessionId as string | undefined;
  if (!sessionId) throw new Error("尚未加入房间");
  return sessionId;
}

function run(socket: Socket, ack: Ack, action: () => unknown, sendAck = true): unknown {
  try {
    const room = action();
    if (sendAck) ack({ ok: true, room });
    return room;
  } catch (error) {
    const message = error instanceof Error ? error.message : "操作失败";
    ack({ ok: false, message });
    socket.emit("room:error", { message });
    return undefined;
  }
}
