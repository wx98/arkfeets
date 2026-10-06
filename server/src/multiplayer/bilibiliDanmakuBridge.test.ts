import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BilibiliDanmakuBridge, parseBilibiliTextPacket } from "./bilibiliDanmakuBridge.js";

function textPacket(uid = "42", answer = " 答案 "): { cmd: number; data: unknown[] } {
  const data: unknown[] = [];
  data[2] = "玩家";
  data[4] = answer;
  data[6] = 0;
  data[11] = "message-1";
  data[13] = 0;
  data[16] = uid;
  data[18] = 0;
  return { cmd: 2, data };
}

class FakeWebSocket extends EventTarget {
  static instances: FakeWebSocket[] = [];
  sent: string[] = [];
  constructor(readonly url: string) {
    super();
    FakeWebSocket.instances.push(this);
  }
  send(value: string) { this.sent.push(value); }
  close() { this.dispatchEvent(new Event("close")); }
  receive(value: unknown) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(value) })); }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeWebSocket.instances = [];
});

describe("Bilibili danmaku bridge", () => {
  it("accepts only ordinary text with a real UID", () => {
    expect(parseBilibiliTextPacket(textPacket(), new Set())).toMatchObject({ uid: "42", answer: "答案" });
    expect(parseBilibiliTextPacket(textPacket(), new Set(["42"]))).toBeNull();
    expect(parseBilibiliTextPacket(textPacket("0"), new Set())).toBeNull();
    expect(parseBilibiliTextPacket({ ...textPacket(), cmd: 5 }, new Set())).toBeNull();
    const emoticon = textPacket(); emoticon.data[13] = 1;
    expect(parseBilibiliTextPacket(emoticon, new Set())).toBeNull();
    const gift = textPacket(); gift.data[6] = 1;
    expect(parseBilibiliTextPacket(gift, new Set())).toBeNull();
    const mirror = textPacket(); mirror.data[18] = 1;
    expect(parseBilibiliTextPacket(mirror, new Set())).toBeNull();
  });

  it("joins by room ID and applies edited blacklist without reconnecting", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const directory = mkdtempSync(join(tmpdir(), "arkfeets-live-"));
    const configPath = join(directory, "config.json");
    const config = { bilibili: { blivechatWsUrl: "ws://127.0.0.1:12450/api/chat", roomId: 123, authCode: "", uidBlacklist: [] as string[] } };
    writeFileSync(configPath, JSON.stringify(config));
    const answers: string[] = [];
    const bridge = new BilibiliDanmakuBridge(configPath, (_, answer) => answers.push(answer.answer), () => undefined);
    try {
      const connecting = bridge.start("LIVE");
      const socket = FakeWebSocket.instances[0];
      socket.dispatchEvent(new Event("open"));
      await connecting;
      expect(JSON.parse(socket.sent[0])).toMatchObject({ cmd: 1, data: { roomKey: { type: 1, value: 123 } } });
      socket.receive(textPacket());
      expect(answers).toEqual(["答案"]);
      config.bilibili.uidBlacklist = ["42"];
      writeFileSync(configPath, JSON.stringify(config));
      expect(JSON.parse(readFileSync(configPath, "utf8")).bilibili.uidBlacklist).toEqual(["42"]);
      const blocked = textPacket(); blocked.data[11] = "message-2";
      socket.receive(blocked);
      expect(answers).toEqual(["答案"]);
    } finally {
      bridge.stop();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("uses the configured identity code when present", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const directory = mkdtempSync(join(tmpdir(), "arkfeets-live-"));
    const configPath = join(directory, "config.json");
    writeFileSync(configPath, JSON.stringify({ bilibili: {
      blivechatWsUrl: "ws://127.0.0.1:12450/api/chat", roomId: 123, authCode: "secret-code", uidBlacklist: [],
    } }));
    const bridge = new BilibiliDanmakuBridge(configPath, () => undefined, () => undefined);
    try {
      const connecting = bridge.start("LIVE");
      const socket = FakeWebSocket.instances[0];
      socket.dispatchEvent(new Event("open"));
      await connecting;
      expect(JSON.parse(socket.sent[0])).toMatchObject({ data: { roomKey: { type: 2, value: "secret-code" } } });
    } finally {
      bridge.stop();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects startup when blivechat reports a fatal join error", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const directory = mkdtempSync(join(tmpdir(), "arkfeets-live-"));
    const configPath = join(directory, "config.json");
    writeFileSync(configPath, JSON.stringify({ bilibili: {
      blivechatWsUrl: "ws://127.0.0.1:12450/api/chat", roomId: 123, authCode: "", uidBlacklist: [],
    } }));
    const bridge = new BilibiliDanmakuBridge(configPath, () => undefined, () => undefined);
    try {
      const connecting = bridge.start("LIVE");
      const socket = FakeWebSocket.instances[0];
      socket.dispatchEvent(new Event("open"));
      socket.receive({ cmd: 8 });
      await expect(connecting).rejects.toThrow("直播连接被拒绝");
      expect(bridge.roomCode).toBeUndefined();
    } finally {
      bridge.stop();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
