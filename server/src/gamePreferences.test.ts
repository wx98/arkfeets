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
});
