import type { Server, Socket } from "socket.io";
import { describe, expect, it, vi } from "vitest";
import type { BilibiliDanmakuBridge } from "./bilibiliDanmakuBridge.js";
import type { MultiplayerRoomManager } from "./multiplayerRoomManager.js";
import { registerMultiplayerGateway } from "./socketGateway.js";

describe("room creation and live listening", () => {
  it("enables listening only after a Bilibili room is created successfully", () => {
    const handlers = new Map<string, (payload: unknown, ack: (result: unknown) => void) => void>();
    let connected: ((socket: Socket) => void) | undefined;
    const io = { on: vi.fn((_event: string, callback: (socket: Socket) => void) => { connected = callback; }) } as unknown as Server;
    const createRoom = vi.fn((input: { roomCode: string; answerSource: string }) => {
      if (input.roomCode === "FAIL") throw new Error("room failed");
      return { roomCode: input.roomCode };
    });
    const manager = { createRoom } as unknown as MultiplayerRoomManager;
    const setListeningEnabled = vi.fn();
    const bridge = { setListeningEnabled } as unknown as BilibiliDanmakuBridge;
    const socket = {
      data: {},
      emit: vi.fn(),
      join: vi.fn(),
      leave: vi.fn(),
      on: vi.fn((event: string, callback: (payload: unknown, ack: (result: unknown) => void) => void) => { handlers.set(event, callback); }),
    } as unknown as Socket;
    registerMultiplayerGateway(io, manager, bridge);
    connected?.(socket);

    const create = (roomCode: string, answerSource: string) => {
      const ack = vi.fn();
      handlers.get("room:create")?.({ roomCode, answerSource, sessionId: "session-id", nickname: "host", difficulty: "medium", requestedCount: 20 }, ack);
      return ack;
    };
    expect(create("WEB1", "WEB")).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    expect(setListeningEnabled).not.toHaveBeenCalled();
    expect(create("FAIL", "BILIBILI")).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
    expect(setListeningEnabled).not.toHaveBeenCalled();
    expect(create("LIVE1", "BILIBILI")).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    expect(setListeningEnabled).toHaveBeenCalledTimes(1);
    expect(setListeningEnabled).toHaveBeenCalledWith(true);
  });
});
