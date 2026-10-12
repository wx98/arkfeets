import { io } from "socket.io-client";
import type { AnswerSource, Difficulty, LiveDanmakuEvent, MultiplayerRoomView } from "../types";
import type { GamePreferences } from "../api/gameSetup";

const socket = io({ autoConnect: true });

interface AckSuccess { ok: true; room: MultiplayerRoomView | null }
interface AckFailure { ok: false; message: string }
type AckResponse = AckSuccess | AckFailure;
export type ConnectionState = "CONNECTED" | "CONNECTING" | "DISCONNECTED";

export function getClientSessionId(): string {
  const key = "arkfeets:session-id";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(key, created);
  return created;
}

export const multiplayerSocket = {
  create(input: { roomCode: string; sessionId: string; nickname: string; difficulty: Difficulty; requestedCount: number; topicId: string; durationSeconds: number; preferences: GamePreferences; answerSource: AnswerSource }) {
    return emit("room:create", input);
  },
  join(input: { roomCode: string; sessionId: string; nickname: string }) {
    return emit("room:join", input);
  },
  start(roomCode: string) {
    return emit("room:start", { roomCode });
  },
  answer(roomCode: string, answer: string) {
    return emit("room:answer", { roomCode, answer });
  },
  next(roomCode: string) {
    return emit("room:next", { roomCode });
  },
  skipRanking(roomCode: string) {
    return emit("room:skip-ranking", { roomCode });
  },
  leave(roomCode: string) {
    return emit("room:leave", { roomCode });
  },
  onUpdate(listener: (room: MultiplayerRoomView) => void) {
    socket.on("room:update", listener);
    return () => socket.off("room:update", listener);
  },
  onDanmaku(listener: (event: LiveDanmakuEvent) => void) {
    socket.on("room:danmaku", listener);
    return () => socket.off("room:danmaku", listener);
  },
  onClosed(listener: (event: { message: string }) => void) {
    socket.on("room:closed", listener);
    return () => socket.off("room:closed", listener);
  },
  onConnectionChange(listener: (state: ConnectionState) => void) {
    const connected = () => listener("CONNECTED");
    const disconnected = () => listener("DISCONNECTED");
    const connecting = () => listener("CONNECTING");
    socket.on("connect", connected);
    socket.on("disconnect", disconnected);
    socket.io.on("reconnect_attempt", connecting);
    socket.io.on("reconnect_error", disconnected);
    listener(socket.connected ? "CONNECTED" : "CONNECTING");
    return () => {
      socket.off("connect", connected);
      socket.off("disconnect", disconnected);
      socket.io.off("reconnect_attempt", connecting);
      socket.io.off("reconnect_error", disconnected);
    };
  },
};

function emit(event: string, payload: unknown): Promise<MultiplayerRoomView | null> {
  if (!socket.connected) socket.connect();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("连接服务器超时")), 6_000);
    socket.emit(event, payload, (response: AckResponse) => {
      window.clearTimeout(timer);
      if (!response.ok) reject(new Error(response.message));
      else resolve(response.room);
    });
  });
}
