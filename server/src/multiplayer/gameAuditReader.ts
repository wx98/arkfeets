import { createReadStream } from "node:fs";
import { lstat, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { AnswerAudit, GameEndAudit, GameStartAudit } from "./gameAuditLogger.js";

export type StartRecord = GameStartAudit & { type: "start"; timestamp: string; roomCode: string };
export type AnswerRecord = AnswerAudit & { type: "answer"; timestamp: string; roomCode: string };
export type EndRecord = GameEndAudit & { type: "end"; timestamp: string; roomCode: string };
type AuditRecord = StartRecord | AnswerRecord | EndRecord;

export interface GameLogSummary {
  id: string;
  roomCode: string;
  startedAt: string;
  endedAt: string | null;
  answerSource: string;
  difficulty: string;
  requestedCount: number;
  questionCount: number;
  answerCount: number;
  correctCount: number;
  playerCount: number;
  status: "completed" | "room_closed" | "server_stopped" | "in_progress";
  invalidLines: number;
}

interface ScanResult {
  summary: GameLogSummary;
  start: StartRecord | null;
  end: EndRecord | null;
  answers: AnswerRecord[];
  matchedCount: number;
}

const logName = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z_[A-Za-z0-9_-]+_[a-f0-9]{8}\.jsonl$/;

export class GameAuditReader {
  private readonly summaryCache = new Map<string, { size: number; modified: number; summary: GameLogSummary }>();

  constructor(private readonly directory: string, private readonly isActive: (id: string) => boolean = () => false) {}

  async list(page: number, pageSize: number): Promise<{ items: GameLogSummary[]; total: number; page: number; pageSize: number }> {
    const files = (await readdir(this.directory, { withFileTypes: true }))
      .filter(entry => entry.isFile() && logName.test(entry.name))
      .map(entry => entry.name).sort().reverse();
    const known = new Set(files);
    for (const id of this.summaryCache.keys()) if (!known.has(id)) this.summaryCache.delete(id);
    const selected = files.slice(page * pageSize, (page + 1) * pageSize);
    const items = await Promise.all(selected.map(id => this.summaryFor(id)));
    return { items, total: files.length, page, pageSize };
  }

  async detail(id: string, page: number, pageSize: number, search = "", correct?: boolean): Promise<ScanResult & { page: number; pageSize: number }> {
    if (!logName.test(id)) throw new Error("无效的对局记录 ID");
    const result = await this.scan(id, page * pageSize, pageSize, search.trim().toLocaleLowerCase(), correct);
    return { ...result, page, pageSize };
  }

  async delete(id: string): Promise<{ deleted: true; id: string }> {
    if (!logName.test(id)) throw new Error("无效的对局记录 ID");
    if (this.isActive(id)) throw new Error("对局仍在进行，不能删除正在写入的记录");
    const path = join(this.directory, id);
    const file = await lstat(path);
    if (!file.isFile()) throw new Error("对局记录不存在");
    await unlink(path);
    this.summaryCache.delete(id);
    return { deleted: true, id };
  }

  private async scan(id: string, offset = 0, limit = 0, search = "", correct?: boolean): Promise<ScanResult> {
    const file = await lstat(join(this.directory, id));
    if (!file.isFile()) throw new Error("对局记录不存在");
    const summary: GameLogSummary = {
      id, roomCode: "", startedAt: "", endedAt: null, answerSource: "", difficulty: "",
      requestedCount: 0, questionCount: 0, answerCount: 0, correctCount: 0, playerCount: 0,
      status: "in_progress", invalidLines: 0,
    };
    let start: StartRecord | null = null;
    let end: EndRecord | null = null;
    const answers: AnswerRecord[] = [];
    const users = new Set<string>();
    let matchedCount = 0;
    const stream = createReadStream(join(this.directory, id), { encoding: "utf8" });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if (!line.trim()) continue;
        let record: AuditRecord;
        try { record = JSON.parse(line) as AuditRecord; }
        catch { summary.invalidLines++; continue; }
        if (!record || typeof record !== "object") { summary.invalidLines++; continue; }
        if (record.type === "start") {
          start = record;
          summary.roomCode = record.roomCode;
          summary.startedAt = record.timestamp;
          summary.answerSource = record.answerSource;
          summary.difficulty = record.difficulty;
          summary.requestedCount = record.requestedCount;
          summary.questionCount = record.questionCount;
        } else if (record.type === "answer") {
          summary.answerCount++;
          if (record.correct) summary.correctCount++;
          if (record.userId) users.add(record.userId);
          if (correct !== undefined && record.correct !== correct) continue;
          if (search && ![record.nickname, record.userId, record.answer, record.questionId, ...(Array.isArray(record.standardAnswers) ? record.standardAnswers : [])]
            .some(value => String(value ?? "").toLocaleLowerCase().includes(search))) continue;
          if (matchedCount >= offset && answers.length < limit) answers.push(record);
          matchedCount++;
        } else if (record.type === "end") {
          end = record;
          summary.endedAt = record.timestamp;
          summary.status = record.reason;
          summary.playerCount = record.players?.length ?? 0;
        } else {
          summary.invalidLines++;
        }
      }
    } finally {
      lines.close();
      stream.destroy();
    }
    if (!summary.playerCount) summary.playerCount = users.size;
    if (!summary.roomCode) summary.roomCode = id.split("_")[1] ?? "";
    if (!summary.startedAt) summary.startedAt = id.slice(0, 24).replace(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "$1:$2:$3.$4Z");
    return { summary, start, end, answers, matchedCount };
  }

  private async summaryFor(id: string): Promise<GameLogSummary> {
    const file = await lstat(join(this.directory, id));
    const cached = this.summaryCache.get(id);
    if (cached && cached.size === file.size && cached.modified === file.mtimeMs) return cached.summary;
    const summary = (await this.scan(id)).summary;
    this.summaryCache.set(id, { size: file.size, modified: file.mtimeMs, summary });
    return summary;
  }
}
