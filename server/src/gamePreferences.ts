import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { difficulties } from "./question/types.js";

export const gamePreferencesSchema = z.object({
  hintRemainingPercent: z.number().int().min(0).max(100),
  revealSeconds: z.number().int().min(1).max(60),
  autoNext: z.boolean(),
}).strict();

export type GamePreferences = z.infer<typeof gamePreferencesSchema>;
export const defaultGamePreferences: GamePreferences = {
  hintRemainingPercent: 20,
  revealSeconds: 10,
  autoNext: false,
};

export const roomSetupSchema = z.object({
  topicId: z.string().min(1).max(80),
  difficulty: z.enum(difficulties),
  requestedCount: z.union([z.literal(0), z.literal(20), z.literal(50), z.literal(100)]),
  answerSource: z.enum(["WEB", "EXTERNAL_API", "BILIBILI"]),
  customDuration: z.boolean(),
  durationSeconds: z.number().int().min(5).max(600),
  durationMin: z.number().int().min(5).max(599),
  durationMax: z.number().int().min(6).max(600),
  preferences: gamePreferencesSchema,
}).strict().refine(value => value.durationMin < value.durationMax && value.durationSeconds >= value.durationMin && value.durationSeconds <= value.durationMax,
  "自定义时间必须在有效范围内");

export type RoomSetup = z.infer<typeof roomSetupSchema>;

export class GamePreferencesStore {
  constructor(private readonly configPath: string) {}

  read(): GamePreferences {
    const config = JSON.parse(readFileSync(this.configPath, "utf8"));
    return gamePreferencesSchema.parse({ ...defaultGamePreferences, ...config.gamePreferences });
  }

  save(input: GamePreferences): GamePreferences {
    const preferences = gamePreferencesSchema.parse(input);
    const config = JSON.parse(readFileSync(this.configPath, "utf8"));
    const temporary = join(dirname(this.configPath), `.config-${process.pid}-${Date.now()}.tmp`);
    writeFileSync(temporary, `${JSON.stringify({ ...config, gamePreferences: preferences }, null, 2)}\n`, "utf8");
    renameSync(temporary, this.configPath);
    return preferences;
  }

  readRoomSetup(): RoomSetup | null {
    const config = JSON.parse(readFileSync(this.configPath, "utf8"));
    return config.roomSetup ? roomSetupSchema.parse(config.roomSetup) : null;
  }

  saveRoomSetup(input: RoomSetup): RoomSetup {
    const roomSetup = roomSetupSchema.parse(input);
    const config = JSON.parse(readFileSync(this.configPath, "utf8"));
    const temporary = join(dirname(this.configPath), `.config-${process.pid}-${Date.now()}.tmp`);
    writeFileSync(temporary, `${JSON.stringify({ ...config, gamePreferences: roomSetup.preferences, roomSetup }, null, 2)}\n`, "utf8");
    renameSync(temporary, this.configPath);
    return roomSetup;
  }
}
