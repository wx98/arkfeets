import { createServer } from "node:http";
import express from "express";
import { describe, expect, it } from "vitest";
import { AdminSessionManager } from "../admin/adminSessionManager.js";
import type { QuestionAdminService } from "../admin/questionAdminService.js";
import type { BilibiliDanmakuBridge } from "../multiplayer/bilibiliDanmakuBridge.js";
import type { GameAuditReader } from "../multiplayer/gameAuditReader.js";
import { createAdminRoutes } from "./adminRoutes.js";

describe("shared admin session", () => {
  it("protects all three modules and reuses one login cookie", async () => {
    const sessions = new AdminSessionManager("test-password", 60_000);
    const questions = { list: () => ({ questions: [] }), listTopics: () => [{ id: "脚", name: "脚", isDefault: true, questionCount: 0 }] } as unknown as QuestionAdminService;
    const live = { snapshot: () => ({ users: [] }) } as unknown as BilibiliDanmakuBridge;
    const audit = { list: async () => ({ items: [], total: 0 }) } as unknown as GameAuditReader;
    const app = express();
    app.use(express.json());
    app.use("/api/admin", createAdminRoutes(sessions, questions, live, audit));
    const server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("测试服务未启动");
      const base = `http://127.0.0.1:${address.port}/api/admin`;
      for (const path of ["session", "library", "topics", "games", "live/state"]) {
        expect((await fetch(`${base}/${path}`)).status).toBe(401);
      }
      const login = await fetch(`${base}/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "test-password" }) });
      expect(login.status).toBe(200);
      const cookie = login.headers.get("set-cookie")?.split(";")[0];
      expect(cookie).toMatch(/^arkfeets_admin=/);
      for (const path of ["session", "library", "topics", "games", "live/state"]) {
        expect((await fetch(`${base}/${path}`, { headers: { Cookie: cookie! } })).status).toBe(200);
      }
      expect((await fetch(`${base}/logout`, { method: "POST", headers: { Cookie: cookie! } })).status).toBe(200);
      expect((await fetch(`${base}/session`, { headers: { Cookie: cookie! } })).status).toBe(401);
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
});
