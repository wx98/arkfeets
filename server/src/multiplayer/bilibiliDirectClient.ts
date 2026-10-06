import { createHash, createHmac, randomUUID } from "node:crypto";
import WebSocket from "ws";
import { decodeBilibiliPackets, makeBilibiliPacket } from "./bilibiliProtocol.js";

export interface LiveConfig {
  roomId?: number;
  authCode?: string;
  sessdata?: string;
  openLive?: { appId: number; accessKeyId: string; accessKeySecret: string };
}

export interface LiveConnection {
  roomId: number;
  close(): void;
}

type CommandHandler = (command: unknown) => void;
const webHeaders = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/147.0.0.0 Safari/537.36",
  Origin: "https://live.bilibili.com",
  Referer: "https://live.bilibili.com/",
};
const mixinTable = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52];

async function getJson(url: string, headers: Record<string, string>): Promise<Record<string, any>> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Bilibili 接口响应 ${response.status}`);
  return await response.json() as Record<string, any>;
}

async function roomDetails(config: LiveConfig): Promise<{ roomId: number; urls: string[]; auth: string; headers: Record<string, string> }> {
  const requested = config.roomId;
  if (!Number.isSafeInteger(requested) || !requested || requested < 1) throw new Error("请在 server/config.json 中填写 bilibili.roomId");
  const cookie = config.sessdata ? `SESSDATA=${config.sessdata}` : "";
  const headers = { ...webHeaders, ...(cookie ? { Cookie: cookie } : {}) };
  const room = await getJson(`https://api.live.bilibili.com/room/v1/Room/room_init?id=${requested}`, headers);
  if (room.code !== 0 || !room.data?.room_id) throw new Error("直播房间号无效或无法访问");
  const roomId = Number(room.data.room_id);
  const nav = await getJson("https://api.bilibili.com/x/web-interface/nav", headers);
  const img = String(nav.data?.wbi_img?.img_url ?? "").split("/").pop()?.split(".")[0] ?? "";
  const sub = String(nav.data?.wbi_img?.sub_url ?? "").split("/").pop()?.split(".")[0] ?? "";
  const raw = img + sub;
  if (raw.length < 64) throw new Error("无法获取 Bilibili WBI 签名密钥");
  const key = mixinTable.map(index => raw[index]).join("").slice(0, 32);
  const query = new URLSearchParams({ id: String(roomId), type: "0", wts: String(Math.floor(Date.now() / 1000)) });
  query.sort();
  const signed = query.toString();
  query.set("w_rid", createHash("md5").update(signed + key).digest("hex"));
  const danmu = await getJson(`https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?${query}`, headers);
  if (danmu.code !== 0 || !Array.isArray(danmu.data?.host_list) || !danmu.data?.token) {
    throw new Error(`无法取得直播弹幕地址：${String(danmu.message ?? danmu.code)}`);
  }
  return {
    roomId,
    urls: danmu.data.host_list.map((host: { host: string; wss_port: number }) => `wss://${host.host}:${host.wss_port}/sub`),
    auth: JSON.stringify({ uid: 0, roomid: roomId, protover: 3, platform: "web", type: 2, key: danmu.data.token }),
    headers,
  };
}

async function openLiveRequest(config: LiveConfig, endpoint: "start_game" | "end_game" | "game_heartbeat", body: object): Promise<Record<string, any>> {
  const own = config.openLive;
  const direct = own?.appId && own.accessKeyId && own.accessKeySecret;
  const paths = direct
    ? [`https://live-open.biliapi.com/v2/app/${endpoint === "start_game" ? "start" : endpoint === "end_game" ? "end" : "heartbeat"}`]
    : ["https://api1.blive.chat", "https://api2.blive.chat"].map(base => `${base}/api/internal/open_live/${endpoint}`);
  const payload = JSON.stringify({ ...body, app_id: direct ? own.appId : 0 });
  let lastError: unknown;
  for (const url of paths) {
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
      if (direct) {
        Object.assign(headers, {
          "x-bili-accesskeyid": own.accessKeyId,
          "x-bili-content-md5": createHash("md5").update(payload).digest("hex"),
          "x-bili-signature-method": "HMAC-SHA256",
          "x-bili-signature-nonce": randomUUID().replace(/-/g, ""),
          "x-bili-signature-version": "1.0",
          "x-bili-timestamp": String(Math.floor(Date.now() / 1000)),
        });
        const signatureBase = ["x-bili-accesskeyid", "x-bili-content-md5", "x-bili-signature-method", "x-bili-signature-nonce", "x-bili-signature-version", "x-bili-timestamp"].map(key => `${key}:${headers[key]}`).join("\n");
        headers.Authorization = createHmac("sha256", own.accessKeySecret).update(signatureBase).digest("hex");
      }
      const response = await fetch(url, { method: "POST", headers, body: payload, signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`身份码接口响应 ${response.status}`);
      const result = await response.json() as Record<string, any>;
      if (result.code !== 0 && !(endpoint === "end_game" && [7000, 7003].includes(result.code))) {
        throw new Error(`身份码接口拒绝：${String(result.message ?? result.code)}`);
      }
      return result;
    } catch (error) { lastError = error; }
  }
  throw lastError instanceof Error ? lastError : new Error("身份码接口不可用");
}

export async function connectBilibili(config: LiveConfig, onCommand: CommandHandler, onDisconnect: (message: string) => void): Promise<LiveConnection> {
  let gameId = "";
  let roomId = 0;
  let urls: string[];
  let auth: string;
  let headers: Record<string, string>;
  if (config.authCode?.trim()) {
    const response = await openLiveRequest(config, "start_game", { code: config.authCode.trim() });
    gameId = String(response.data?.game_info?.game_id ?? "");
    roomId = Number(response.data?.anchor_info?.room_id ?? config.roomId ?? 0);
    urls = response.data?.websocket_info?.wss_link ?? [];
    auth = String(response.data?.websocket_info?.auth_body ?? "");
    headers = webHeaders;
    if (!gameId || !auth || !Array.isArray(urls) || !urls.length) {
      if (gameId) void openLiveRequest(config, "end_game", { game_id: gameId }).catch(() => undefined);
      throw new Error("身份码接口未返回完整直播连接信息");
    }
  } else {
    ({ roomId, urls, auth, headers } = await roomDetails(config));
  }
  try {
    for (const value of urls) {
      const url = new URL(value);
      if (url.protocol !== "wss:" || !url.hostname.endsWith(".bilibili.com")) throw new Error("弹幕服务器地址不安全");
    }
  } catch (error) {
    if (gameId) void openLiveRequest(config, "end_game", { game_id: gameId }).catch(() => undefined);
    throw error;
  }
  let socket: WebSocket | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let gameHeartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  const cleanup = () => {
    if (heartbeat) clearInterval(heartbeat);
    if (gameHeartbeat) clearInterval(gameHeartbeat);
    heartbeat = undefined;
    gameHeartbeat = undefined;
  };
  const close = () => {
    if (closed) return;
    closed = true;
    cleanup();
    socket?.close();
    if (gameId) void openLiveRequest(config, "end_game", { game_id: gameId }).catch(() => undefined);
  };
  try {
    let lastError: unknown;
    for (const url of urls) {
      try {
        await new Promise<void>((resolve, reject) => {
          let settled = false;
          const fail = (message: string) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(new Error(message));
          };
          const timer = setTimeout(() => { fail("直播 WebSocket 鉴权超时"); socket?.terminate(); }, 8_000);
          socket = new WebSocket(url, { headers });
          socket.on("open", () => socket?.send(makeBilibiliPacket(7, auth)));
          socket.on("message", (data) => {
            const binary = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
            for (const packet of decodeBilibiliPackets(binary)) {
              if (packet.operation === 8) {
                let result: { code?: number } = {};
                try { result = JSON.parse(packet.body.toString("utf8")); } catch { /* malformed auth */ }
                if (result.code !== 0) { fail("直播弹幕鉴权失败"); socket?.close(); return; }
                if (!settled) { settled = true; clearTimeout(timer); resolve(); }
              } else if (packet.operation === 5) {
                try { onCommand(JSON.parse(packet.body.toString("utf8"))); } catch { /* malformed event */ }
              }
            }
          });
          socket.on("error", error => fail(`直播 WebSocket 连接失败：${error.message}`));
          socket.on("close", () => {
            if (!settled) fail("直播 WebSocket 连接已关闭");
            else if (!closed) { cleanup(); onDisconnect("直播弹幕连接中断"); }
          });
        });
        heartbeat = setInterval(() => socket?.send(makeBilibiliPacket(2, "")), 25_000);
        socket?.send(makeBilibiliPacket(2, ""));
        if (gameId) gameHeartbeat = setInterval(() => {
          void openLiveRequest(config, "game_heartbeat", { game_id: gameId }).catch(() => onDisconnect("身份码会话心跳失败"));
        }, 20_000);
        return { roomId, close };
      } catch (error) { lastError = error; socket?.terminate(); }
    }
    throw lastError instanceof Error ? lastError : new Error("直播弹幕服务器不可用");
  } catch (error) {
    close();
    throw error;
  }
}
