import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GamePreferencesStore } from "./gamePreferences.js";

describe("GamePreferencesStore", () => {
  it("uses defaults and preserves unrelated configuration when saving", () => {
    const directory = mkdtempSync(join(tmpdir(), "arkfeets-settings-"));
    const path = join(directory, "config.json");
    writeFileSync(path, JSON.stringify({ adminPassword: "secret", bilibili: { authCode: "code" } }));
    try {
      const store = new GamePreferencesStore(path);
      expect(store.read()).toEqual({ hintRemainingPercent: 20, revealSeconds: 10, autoNext: false });
      store.save({ hintRemainingPercent: 35, revealSeconds: 45, autoNext: true });
      expect(store.read()).toEqual({ hintRemainingPercent: 35, revealSeconds: 45, autoNext: true });
      expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ adminPassword: "secret", bilibili: { authCode: "code" } });
      expect(() => store.save({ hintRemainingPercent: 20, revealSeconds: 61, autoNext: true })).toThrow();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("persists room creation options without losing other configuration", () => {
    const directory = mkdtempSync(join(tmpdir(), "arkfeets-room-settings-"));
    const path = join(directory, "config.json");
    writeFileSync(path, JSON.stringify({ adminPassword: "secret", bilibili: { roomId: 123 } }));
    try {
      const store = new GamePreferencesStore(path);
      expect(store.readRoomSetup()).toBeNull();
      const setup = {
        topicId: "脚", difficulty: "hard" as const, requestedCount: 0 as const,
        answerSource: "BILIBILI" as const, customDuration: true,
        durationSeconds: 42, durationMin: 8, durationMax: 90,
        preferences: { hintRemainingPercent: 30, revealSeconds: 12, autoNext: true },
      };
      store.saveRoomSetup(setup);
      expect(store.readRoomSetup()).toEqual(setup);
      expect(store.read()).toEqual(setup.preferences);
      expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ adminPassword: "secret", bilibili: { roomId: 123 } });
      expect(() => store.saveRoomSetup({ ...setup, durationSeconds: 91 })).toThrow();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
