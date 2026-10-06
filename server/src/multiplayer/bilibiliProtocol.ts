import { brotliDecompressSync, inflateSync } from "node:zlib";

export interface BilibiliPacket {
  operation: number;
  body: Buffer;
}

export interface BilibiliTextAnswer {
  uid: string;
  nickname: string;
  answer: string;
  messageId: string;
  timestamp: number;
}

const maxPacketBytes = 8 * 1024 * 1024;

export function makeBilibiliPacket(operation: number, body: string, version = 1): Buffer {
  const content = Buffer.from(body, "utf8");
  const packet = Buffer.allocUnsafe(16 + content.length);
  packet.writeUInt32BE(packet.length, 0);
  packet.writeUInt16BE(16, 4);
  packet.writeUInt16BE(version, 6);
  packet.writeUInt32BE(operation, 8);
  packet.writeUInt32BE(1, 12);
  content.copy(packet, 16);
  return packet;
}

export function decodeBilibiliPackets(input: Buffer, depth = 0): BilibiliPacket[] {
  if (depth > 3 || input.length > maxPacketBytes) return [];
  const packets: BilibiliPacket[] = [];
  for (let offset = 0; offset + 16 <= input.length;) {
    const length = input.readUInt32BE(offset);
    const headerLength = input.readUInt16BE(offset + 4);
    const version = input.readUInt16BE(offset + 6);
    const operation = input.readUInt32BE(offset + 8);
    if (length < 16 || length > maxPacketBytes || headerLength < 16 || headerLength > length || offset + length > input.length) break;
    const body = input.subarray(offset + headerLength, offset + length);
    if ((version === 2 || version === 3) && operation === 5) {
      try {
        const expanded = version === 2
          ? inflateSync(body, { maxOutputLength: maxPacketBytes })
          : brotliDecompressSync(body, { maxOutputLength: maxPacketBytes });
        packets.push(...decodeBilibiliPackets(expanded, depth + 1));
      } catch {
        // Malformed compressed frames are ignored without dropping the connection.
      }
    } else {
      packets.push({ operation, body });
    }
    offset += length;
  }
  return packets;
}

export function parseBilibiliTextCommand(command: unknown): BilibiliTextAnswer | null {
  if (!command || typeof command !== "object" || !("cmd" in command) || typeof command.cmd !== "string") return null;
  if (command.cmd === "LIVE_OPEN_PLATFORM_DM_MIRROR" || command.cmd.startsWith("DANMU_MSG_MIRROR")) return null;

  if (command.cmd === "LIVE_OPEN_PLATFORM_DM" && "data" in command && command.data && typeof command.data === "object") {
    const data = command.data as Record<string, unknown>;
    if (data.dm_type !== 0 || !data.open_id || typeof data.msg !== "string" || typeof data.uname !== "string") return null;
    return makeText(String(data.open_id), data.uname, data.msg, String(data.msg_id ?? ""), Number(data.timestamp) * 1000);
  }

  if (!command.cmd.startsWith("DANMU_MSG") || !("info" in command) || !Array.isArray(command.info)) return null;
  const info = command.info;
  const meta = Array.isArray(info[0]) ? info[0] : [];
  const user = Array.isArray(info[2]) ? info[2] : [];
  if (meta[9] || (meta[13] && typeof meta[13] === "object" && meta[13].url)) return null;
  let extra: Record<string, unknown> = {};
  const rawExtra = meta[15]?.extra;
  try {
    extra = typeof rawExtra === "string" ? JSON.parse(rawExtra) : rawExtra && typeof rawExtra === "object" ? rawExtra : {};
  } catch { /* optional metadata */ }
  const messageId = String(extra.id_str ?? meta[5] ?? "");
  return makeText(String(user[0] ?? ""), user[1], info[1], messageId, Number(meta[4]));
}

function makeText(uid: string, name: unknown, content: unknown, id: string, timestamp: number): BilibiliTextAnswer | null {
  const nickname = typeof name === "string" ? name.trim().slice(0, 20) : "";
  const answer = typeof content === "string" ? content.trim() : "";
  if (!uid || uid === "0" || !nickname || !answer || !id) return null;
  return { uid, nickname, answer, messageId: id, timestamp: Number.isFinite(timestamp) ? timestamp : Date.now() };
}
