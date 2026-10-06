import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { connectBilibili, type LiveConfig, type LiveConnection } from "./bilibiliDirectClient.js";
import { parseBilibiliTextCommand, type BilibiliTextAnswer } from "./bilibiliProtocol.js";

export interface BilibiliConfig extends LiveConfig {
  uidBlacklist?: Array<string | number>;
  uidWhitelist?: Array<string | number>;
  allowlistMode?: boolean;
}

export interface LiveSnapshot {
  roomId: number;
  connected: boolean;
  listeningEnabled: boolean;
  error: string;
  messages: Array<BilibiliTextAnswer & { allowed: boolean }>;
  users: Array<{ uid: string; nickname: string; count: number; lastSeen: number }>;
  blacklist: string[];
  whitelist: string[];
  allowlistMode: boolean;
}

export class BilibiliDanmakuBridge {
  private activeRoomCode?: string;
  private connection?: LiveConnection;
  private connecting?: Promise<void>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private listeners = new Set<(snapshot: LiveSnapshot) => void>();
  private messages: LiveSnapshot["messages"] = [];
  private users = new Map<string, LiveSnapshot["users"][number]>();
  private seenIds = new Set<string>();
  private connected = false;
  private listeningEnabled = false;
  private error = "";

  constructor(
    private readonly configPath: string,
    private readonly onAnswer: (roomCode: string, answer: BilibiliTextAnswer) => void,
    private readonly onConnectionChange: (roomCode: string, connected: boolean) => void,
  ) {}

  get roomCode(): string | undefined { return this.activeRoomCode; }

  async start(roomCode: string): Promise<void> {
    if (this.activeRoomCode) throw new Error("已有直播间正在接收弹幕");
    if (!this.listeningEnabled) throw new Error("直播弹幕监听已关闭，请在监控页开启");
    this.activeRoomCode = roomCode;
    try {
      await this.ensureConnected();
      if (!this.connected) throw new Error("直播弹幕监听已关闭");
      this.onConnectionChange(roomCode, true);
    } catch (error) {
      this.activeRoomCode = undefined;
      this.maybeClose();
      throw error;
    }
  }

  stop(): void {
    const roomCode = this.activeRoomCode;
    this.activeRoomCode = undefined;
    if (roomCode) this.onConnectionChange(roomCode, false);
    this.maybeClose();
  }

  async acquireMonitor(listener: (snapshot: LiveSnapshot) => void): Promise<() => void> {
    this.listeners.add(listener);
    listener(this.snapshot());
    if (this.listeningEnabled) void this.ensureConnected().catch(() => undefined);
    return () => {
      this.listeners.delete(listener);
      this.maybeClose();
    };
  }

  snapshot(): LiveSnapshot {
    const config = this.readConfig();
    return {
      roomId: this.connection?.roomId ?? config.roomId ?? 0,
      connected: this.connected,
      listeningEnabled: this.listeningEnabled,
      error: this.error,
      messages: [...this.messages],
      users: [...this.users.values()].sort((a, b) => b.lastSeen - a.lastSeen),
      blacklist: (config.uidBlacklist ?? []).map(String),
      whitelist: (config.uidWhitelist ?? []).map(String),
      allowlistMode: Boolean(config.allowlistMode),
    };
  }

  setAccess(uid: string, status: "normal" | "white" | "black"): LiveSnapshot {
    if (!/^[\w-]{1,100}$/.test(uid)) throw new Error("无效的用户 ID");
    this.editConfig(config => {
      const black = new Set((config.uidBlacklist ?? []).map(String));
      const white = new Set((config.uidWhitelist ?? []).map(String));
      black.delete(uid); white.delete(uid);
      if (status === "black") black.add(uid);
      if (status === "white") white.add(uid);
      config.uidBlacklist = [...black];
      config.uidWhitelist = [...white];
    });
    this.publish();
    return this.snapshot();
  }

  setAllowlistMode(enabled: boolean): LiveSnapshot {
    this.editConfig(config => { config.allowlistMode = enabled; });
    this.publish();
    return this.snapshot();
  }

  setListeningEnabled(enabled: boolean): LiveSnapshot {
    this.listeningEnabled = enabled;
    if (!enabled) {
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
      this.connection?.close();
      this.connection = undefined;
      this.connected = false;
      this.error = "直播弹幕监听已关闭";
      if (this.activeRoomCode) this.onConnectionChange(this.activeRoomCode, false);
    } else {
      this.error = "";
      if (this.activeRoomCode || this.listeners.size) {
        void this.ensureConnected().then(() => {
          if (this.activeRoomCode && this.connected) this.onConnectionChange(this.activeRoomCode, true);
        }).catch(() => undefined);
      }
    }
    this.publish();
    return this.snapshot();
  }

  private readConfig(): BilibiliConfig {
    const value = JSON.parse(readFileSync(this.configPath, "utf8")) as { bilibili?: BilibiliConfig };
    if (!value.bilibili) throw new Error("请在 server/config.json 中配置 bilibili");
    return value.bilibili;
  }

  private editConfig(change: (config: BilibiliConfig) => void): void {
    const value = JSON.parse(readFileSync(this.configPath, "utf8")) as { bilibili?: BilibiliConfig };
    if (!value.bilibili) throw new Error("缺少 bilibili 配置");
    change(value.bilibili);
    const temporary = `${this.configPath}.tmp`;
    writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n");
    renameSync(temporary, this.configPath);
  }

  private async ensureConnected(): Promise<void> {
    if (!this.listeningEnabled) return;
    if (this.connected) return;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const config = this.readConfig();
      if (!config.authCode?.trim() && !config.roomId) throw new Error("请配置 bilibili.authCode 或 bilibili.roomId");
      const connection = await connectBilibili(config, command => this.onCommand(command), message => this.disconnected(message));
      if ((!this.activeRoomCode && !this.listeners.size) || !this.listeningEnabled) { connection.close(); return; }
      this.connection = connection;
      this.connected = true;
      this.error = "";
      this.publish();
    })().catch(error => {
      this.error = error instanceof Error ? error.message : "直播弹幕连接失败";
      this.publish();
      if ((this.activeRoomCode || this.listeners.size) && this.listeningEnabled) this.scheduleReconnect();
      throw error;
    }).finally(() => { this.connecting = undefined; });
    return this.connecting;
  }

  private onCommand(command: unknown): void {
    if (!this.listeningEnabled) return;
    const answer = parseBilibiliTextCommand(command);
    if (!answer || this.seenIds.has(answer.messageId)) return;
    this.seenIds.add(answer.messageId);
    if (this.seenIds.size > 2_000) this.seenIds.delete(this.seenIds.values().next().value!);
    let config: BilibiliConfig;
    try { config = this.readConfig(); }
    catch { this.error = "无法读取名单配置，弹幕已拒绝"; this.publish(); return; }
    const black = new Set((config.uidBlacklist ?? []).map(String));
    const white = new Set((config.uidWhitelist ?? []).map(String));
    const allowed = !black.has(answer.uid) && (!config.allowlistMode || white.has(answer.uid));
    this.messages.unshift({ ...answer, allowed });
    if (this.messages.length > 100) this.messages.pop();
    const previous = this.users.get(answer.uid);
    this.users.delete(answer.uid);
    this.users.set(answer.uid, { uid: answer.uid, nickname: answer.nickname, count: (previous?.count ?? 0) + 1, lastSeen: Date.now() });
    if (this.users.size > 500) this.users.delete(this.users.keys().next().value!);
    this.publish();
    if (allowed && this.activeRoomCode) this.onAnswer(this.activeRoomCode, answer);
  }

  private disconnected(message: string): void {
    if (!this.connection) return;
    this.connection.close();
    this.connection = undefined;
    this.connected = false;
    this.error = message;
    if (this.activeRoomCode) this.onConnectionChange(this.activeRoomCode, false);
    this.publish();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this.listeningEnabled || (!this.activeRoomCode && !this.listeners.size)) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.activeRoomCode || this.listeners.size) void this.ensureConnected().then(() => {
        if (this.activeRoomCode && this.connected) this.onConnectionChange(this.activeRoomCode, true);
      }).catch(() => undefined);
    }, 3_000);
  }

  private maybeClose(): void {
    if (this.activeRoomCode || this.listeners.size) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.connection?.close();
    this.connection = undefined;
    this.connected = false;
    this.error = "";
  }

  private publish(): void {
    if (!this.listeners.size) return;
    const value = this.snapshot();
    for (const listener of this.listeners) listener(value);
  }
}
