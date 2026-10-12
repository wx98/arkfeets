import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

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
}
