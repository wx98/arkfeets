import { readFileSync } from "node:fs";

export interface BilibiliConfig {
  blivechatWsUrl: string;
  roomId?: number;
  authCode?: string;
  uidBlacklist?: Array<string | number>;
}

export interface BilibiliTextAnswer {
  uid: string;
  nickname: string;
  answer: string;
  messageId: string;
}

export function parseBilibiliTextPacket(packet: unknown, blacklist: ReadonlySet<string>): BilibiliTextAnswer | null {
  if (!packet || typeof packet !== "object" || !("cmd" in packet) || packet.cmd !== 2 || !("data" in packet)) return null;
  const data = packet.data;
  if (!Array.isArray(data) || data[13] !== 0 || data[6] || data[18]) return null;
  const uid = typeof data[16] === "string" || typeof data[16] === "number" ? String(data[16]).trim() : "";
  const nickname = typeof data[2] === "string" ? data[2].trim().slice(0, 20) : "";
  const answer = typeof data[4] === "string" ? data[4].trim() : "";
  const messageId = typeof data[11] === "string" || typeof data[11] === "number" ? String(data[11]) : "";
  if (!uid || uid === "0" || blacklist.has(uid) || !nickname || !answer || !messageId) return null;
  return { uid, nickname, answer, messageId };
}

export class BilibiliDanmakuBridge {
  private socket?: WebSocket;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private activeRoomCode?: string;
  private seenIds = new Set<string>();

  constructor(
    private readonly configPath: string,
    private readonly onAnswer: (roomCode: string, answer: BilibiliTextAnswer) => void,
    private readonly onConnectionChange: (roomCode: string, connected: boolean) => void,
  ) {}

  get roomCode(): string | undefined { return this.activeRoomCode; }

  async start(roomCode: string): Promise<void> {
    if (this.activeRoomCode) throw new Error("已有直播间正在接收弹幕");
    const config = this.readConfig();
    this.roomKey(config);
    this.activeRoomCode = roomCode;
    this.seenIds.clear();
    try {
      await this.connect(roomCode);
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  stop(): void {
    const roomCode = this.activeRoomCode;
    this.activeRoomCode = undefined;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.socket?.close();
    this.socket = undefined;
    this.seenIds.clear();
    if (roomCode) this.onConnectionChange(roomCode, false);
  }

  private readConfig(): BilibiliConfig {
    const config = JSON.parse(readFileSync(this.configPath, "utf8")) as { bilibili?: BilibiliConfig };
    if (!config.bilibili) throw new Error("请在 server/config.json 中配置 bilibili");
    return config.bilibili;
  }

  private roomKey(config: BilibiliConfig): { type: 1 | 2; value: number | string } {
    if (config.authCode?.trim()) return { type: 2, value: config.authCode.trim() };
    if (Number.isSafeInteger(config.roomId) && (config.roomId ?? 0) > 0) return { type: 1, value: config.roomId! };
    throw new Error("请在 server/config.json 中填写 bilibili.authCode 或 bilibili.roomId");
  }

  private async connect(roomCode: string): Promise<void> {
    const config = this.readConfig();
    const url = new URL(config.blivechatWsUrl);
    if (!["ws:", "wss:"].includes(url.protocol)) throw new Error("blivechatWsUrl 必须是 ws/wss 地址");
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      this.socket = socket;
      let opened = false;
      let ready = false;
      let settled = false;
      let readyTimer: ReturnType<typeof setTimeout> | undefined;
      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (readyTimer) clearTimeout(readyTimer);
        reject(new Error(message));
      };
      const timeout = setTimeout(() => {
        if (!opened) {
          fail("连接 blivechat 超时，请确认服务正在运行");
          socket.close();
        }
      }, 6_000);
      socket.addEventListener("open", () => {
        if (this.activeRoomCode !== roomCode) { socket.close(); return; }
        opened = true;
        clearTimeout(timeout);
        socket.send(JSON.stringify({ cmd: 1, data: { roomKey: this.roomKey(config), config: { autoTranslate: false } } }));
        readyTimer = setTimeout(() => {
          if (this.activeRoomCode !== roomCode || this.socket !== socket) return;
          ready = true;
          settled = true;
          this.onConnectionChange(roomCode, true);
          resolve();
        }, 300);
      });
      socket.addEventListener("message", (event) => {
        if (this.activeRoomCode !== roomCode) return;
        let packet: unknown;
        try { packet = JSON.parse(String(event.data)); } catch { return; }
        if (packet && typeof packet === "object" && "cmd" in packet && packet.cmd === 0) {
          socket.send(JSON.stringify({ cmd: 0 }));
          return;
        }
        if (packet && typeof packet === "object" && "cmd" in packet && packet.cmd === 8) {
          console.error("blivechat 直播连接被拒绝，请检查房间号或身份码");
          fail("blivechat 直播连接被拒绝，请检查房间号或身份码");
          socket.close();
          return;
        }
        if (!packet || typeof packet !== "object" || !("cmd" in packet) || packet.cmd !== 2) return;
        let blacklist: ReadonlySet<string>;
        try {
          blacklist = new Set((this.readConfig().uidBlacklist ?? []).map(String));
        } catch {
          console.error("无法读取 Bilibili UID 黑名单，当前弹幕已拒绝");
          return;
        }
        const answer = parseBilibiliTextPacket(packet, blacklist);
        if (!answer || this.seenIds.has(answer.messageId)) return;
        this.seenIds.add(answer.messageId);
        if (this.seenIds.size > 2_000) this.seenIds.delete(this.seenIds.values().next().value!);
        this.onAnswer(roomCode, answer);
      });
      socket.addEventListener("error", () => {
        if (!ready) fail("无法连接 blivechat，请检查服务地址与运行状态");
      });
      socket.addEventListener("close", () => {
        clearTimeout(timeout);
        if (readyTimer) clearTimeout(readyTimer);
        if (!ready) fail("blivechat 连接已关闭");
        if (this.activeRoomCode !== roomCode || this.socket !== socket) return;
        this.socket = undefined;
        this.onConnectionChange(roomCode, false);
        this.scheduleReconnect(roomCode);
      });
    });
  }

  private scheduleReconnect(roomCode: string): void {
    if (this.activeRoomCode !== roomCode) return;
    this.reconnectTimer = setTimeout(() => {
      if (this.activeRoomCode !== roomCode) return;
      void this.connect(roomCode).catch(() => undefined);
    }, 3_000);
  }
}
