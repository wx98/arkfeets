import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AnswerSource } from "./multiplayerRoomManager.js";

export interface GameStartAudit {
  answerSource: AnswerSource;
  difficulty: string;
  requestedCount: number;
  questionCount: number;
}

export interface AnswerAudit {
  answerSource: AnswerSource;
  questionId: string;
  questionIndex: number;
  overtime: boolean;
  standardAnswers: string[];
  userId: string;
  nickname: string;
  answer: string;
  correct: boolean;
  score: number;
  rank: number;
}

export interface GameEndAudit {
  reason: "completed" | "room_closed" | "server_stopped";
  players: Array<{ userId: string; nickname: string; score: number; rank: number }>;
}

export class GameAuditLogger {
  private readonly active = new Map<string, string>();

  constructor(private readonly directory: string) {
    mkdirSync(directory, { recursive: true });
  }

  isActiveFile(id: string): boolean {
    for (const file of this.active.values()) if (basename(file) === id) return true;
    return false;
  }

  start(roomCode: string, details: GameStartAudit): string {
    if (this.active.has(roomCode)) throw new Error("当前房间的日志尚未结束");
    const stamp = new Date().toISOString();
    const file = join(this.directory, `${stamp.replace(/[:.]/g, "-")}_${roomCode.replace(/[^A-Z0-9-]/gi, "_")}_${randomUUID().slice(0, 8)}.jsonl`);
    writeFileSync(file, line({ type: "start", timestamp: stamp, roomCode, ...details }), { flag: "wx" });
    this.active.set(roomCode, file);
    return file;
  }

  answer(roomCode: string, details: AnswerAudit): void {
    this.append(roomCode, { type: "answer", timestamp: new Date().toISOString(), roomCode, ...details });
  }

  end(roomCode: string, details: GameEndAudit): void {
    this.append(roomCode, { type: "end", timestamp: new Date().toISOString(), roomCode, ...details });
    this.active.delete(roomCode);
  }

  private append(roomCode: string, record: object): void {
    const file = this.active.get(roomCode);
    if (!file) return;
    try {
      appendFileSync(file, line(record));
    } catch (error) {
      console.error(`对局日志写入失败 (${roomCode}):`, error);
    }
  }
}

function line(value: object): string {
  return JSON.stringify(value) + "\n";
}
