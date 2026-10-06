import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LiveUserAccessStore } from "./liveUserAccessStore.js";

describe("live user access store", () => {
  it("migrates old lists, saves normal status, and restores policy after restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "arkfeets-live-users-"));
    const path = join(directory, "live_user_access.json");
    try {
      const store = new LiveUserAccessStore(path, { uidBlacklist: ["1"], uidWhitelist: ["2"], allowlistMode: false });
      expect(store.isAllowed("1")).toBe(false);
      store.setStatus("1", "玩家一", "normal");
      store.setStatus("2", "玩家二", "black");
      store.setStatus("3", "玩家三", "white");
      store.setAllowlistMode(true);
      expect(store.isAllowed("1")).toBe(false);
      expect(store.isAllowed("2")).toBe(false);
      expect(store.isAllowed("3")).toBe(true);
      const restarted = new LiveUserAccessStore(path, { uidBlacklist: ["1"], uidWhitelist: ["2"], allowlistMode: false });
      expect(restarted.getLists()).toEqual({ blacklist: ["2"], whitelist: ["3"] });
      expect(restarted.get("1")).toMatchObject({ uid: "1", nickname: "玩家一", status: "normal" });
      expect(restarted.isAllowlistMode()).toBe(true);
      expect(JSON.parse(readFileSync(path, "utf8")).users).toHaveLength(3);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("reloads external edits and rejects answers while the file is invalid", () => {
    const directory = mkdtempSync(join(tmpdir(), "arkfeets-live-users-"));
    const path = join(directory, "live_user_access.json");
    try {
      const store = new LiveUserAccessStore(path, {});
      expect(store.isAllowed("42")).toBe(true);
      writeFileSync(path, JSON.stringify({ version: 1, allowlistMode: false, users: [{ uid: "42", nickname: "博士", status: "black", updatedAt: new Date().toISOString() }] }));
      expect(store.isAllowed("42")).toBe(false);
      writeFileSync(path, "invalid json");
      expect(store.isAllowed("other")).toBe(false);
      expect(store.getError()).toContain("无法读取");
      expect(() => store.setStatus("42", "博士", "normal")).toThrow("无法读取");
      writeFileSync(path, JSON.stringify({ version: 1, allowlistMode: false, users: [] }));
      expect(store.isAllowed("42")).toBe(true);
      expect(store.getError()).toBe("");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
