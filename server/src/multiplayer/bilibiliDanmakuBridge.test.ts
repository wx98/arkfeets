import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliCompressSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { BilibiliDanmakuBridge } from "./bilibiliDanmakuBridge.js";
import { decodeBilibiliPackets, makeBilibiliPacket, parseBilibiliTextCommand } from "./bilibiliProtocol.js";

describe("Bilibili direct protocol", () => {
  it("decodes compressed and plain websocket packets", () => {
    const command = makeBilibiliPacket(5, JSON.stringify({ cmd: "DANMU_MSG" }));
    expect(decodeBilibiliPackets(command)[0]?.operation).toBe(5);
    const compressed = brotliCompressSync(command);
    const frame = Buffer.alloc(16 + compressed.length);
    frame.writeUInt32BE(frame.length, 0);
    frame.writeUInt16BE(16, 4);
    frame.writeUInt16BE(3, 6);
    frame.writeUInt32BE(5, 8);
    compressed.copy(frame, 16);
    expect(decodeBilibiliPackets(frame)[0]?.body.toString()).toBe(command.subarray(16).toString());
  });

  it("accepts text and rejects emoticons, gifts and mirrors", () => {
    const ordinary = { cmd: "DANMU_MSG", info: [[0, 0, 0, 0, 1, "mid"], " 答案 ", ["42", "玩家"]] };
    expect(parseBilibiliTextCommand(ordinary)).toMatchObject({ uid: "42", nickname: "玩家", answer: "答案" });
    expect(parseBilibiliTextCommand({ ...ordinary, cmd: "DANMU_MSG_MIRROR" })).toBeNull();
    expect(parseBilibiliTextCommand({ cmd: "SEND_GIFT", data: {} })).toBeNull();
    expect(parseBilibiliTextCommand({ cmd: "LIVE_OPEN_PLATFORM_DM", data: { open_id: "id", uname: "玩家", msg: "abc", msg_id: "m", dm_type: 1 } })).toBeNull();
    expect(parseBilibiliTextCommand({ cmd: "LIVE_OPEN_PLATFORM_DM", data: { open_id: "id", uname: "玩家", msg: " abc ", msg_id: "m", dm_type: 0 } })).toMatchObject({ uid: "id", answer: "abc" });
  });
});

describe("Bilibili live access lists", () => {
  it("migrates old lists and persists every user action in a separate file", () => {
    const directory = mkdtempSync(join(tmpdir(), "arkfeets-live-"));
    const path = join(directory, "config.json");
    const original = JSON.stringify({ bilibili: { roomId: 123, authCode: "private-code", uidBlacklist: ["1"] } });
    writeFileSync(path, original);
    try {
      const bridge = new BilibiliDanmakuBridge(path, () => undefined, () => undefined);
      bridge.setAccess("2", "white");
      bridge.setAccess("1", "normal");
      bridge.setAllowlistMode(true);
      expect(readFileSync(path, "utf8")).toBe(original);
      const value = JSON.parse(readFileSync(join(directory, "live_user_access.json"), "utf8"));
      expect(value).toMatchObject({ version: 1, allowlistMode: true, users: [
        { uid: "1", status: "normal" }, { uid: "2", status: "white" },
      ] });
      const restarted = new BilibiliDanmakuBridge(path, () => undefined, () => undefined);
      expect(restarted.snapshot()).toMatchObject({ blacklist: [], whitelist: ["2"], allowlistMode: true });
      expect(restarted.snapshot().users).toEqual(expect.arrayContaining([
        expect.objectContaining({ uid: "1", count: 0 }), expect.objectContaining({ uid: "2", count: 0 }),
      ]));
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("starts with listening off, ignores the legacy config flag, and keeps manual changes in memory", async () => {
    const directory = mkdtempSync(join(tmpdir(), "arkfeets-listening-"));
    const path = join(directory, "config.json");
    writeFileSync(path, JSON.stringify({ bilibili: { roomId: 123, listeningEnabled: true } }));
    const changed = vi.fn();
    const bridge = new BilibiliDanmakuBridge(path, () => undefined, changed);
    try {
      const release = await bridge.acquireMonitor(() => undefined);
      expect(bridge.snapshot()).toMatchObject({ listeningEnabled: false, connected: false });
      await expect(bridge.start("LIVE")).rejects.toThrow("监听已关闭");
      release();
      bridge.setListeningEnabled(true);
      expect(bridge.snapshot().listeningEnabled).toBe(true);
      expect(JSON.parse(readFileSync(path, "utf8")).bilibili.listeningEnabled).toBe(true);
      Object.assign(bridge, { activeRoomCode: "LIVE", connected: true, connection: { roomId: 123, close: vi.fn() } });
      bridge.setListeningEnabled(false);
      expect(bridge.snapshot()).toMatchObject({ listeningEnabled: false, connected: false });
      expect(changed).toHaveBeenCalledWith("LIVE", false);
      const restarted = new BilibiliDanmakuBridge(path, () => undefined, () => undefined);
      expect(restarted.snapshot().listeningEnabled).toBe(false);
    } finally {
      bridge.stop();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("saves the observed danmaku nickname with the selected access state", () => {
    const directory = mkdtempSync(join(tmpdir(), "arkfeets-live-nickname-"));
    const path = join(directory, "config.json");
    writeFileSync(path, JSON.stringify({ bilibili: { roomId: 123 } }));
    try {
      const bridge = new BilibiliDanmakuBridge(path, () => undefined, () => undefined);
      bridge.setListeningEnabled(true);
      (bridge as unknown as { onCommand: (command: unknown) => void }).onCommand({
        cmd: "DANMU_MSG", info: [[0, 0, 0, 0, 1, "message-1"], "答案", ["42", "玩家"]],
      });
      bridge.setAccess("42", "black");
      const file = JSON.parse(readFileSync(join(directory, "live_user_access.json"), "utf8"));
      expect(file.users).toEqual([expect.objectContaining({ uid: "42", nickname: "玩家", status: "black" })]);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
