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
    const refreshListeners = new Set<(status: unknown) => void>();
    const questions = {
      list: () => ({ questions: [] }),
      listTopics: () => [{ id: "脚", name: "脚", isDefault: true, questionCount: 1 }],
      listTopicQuestions: (id: string) => [{ id: "test", title: "test", topicId: id }],
      getTopicThumbnailProgress: () => ({ total: 1, ready: 1, failed: 0 }),
      getThumbnailRefreshStatus: () => ({ state: "idle", total: 0, processed: 0, failed: 0, revision: 0 }),
      startThumbnailRefresh: () => {
        const status = { state: "running", total: 1, processed: 0, failed: 0, revision: 0 };
        for (const listener of refreshListeners) listener(status);
        return status;
      },
      subscribeThumbnailRefresh: (listener: (status: unknown) => void) => {
        refreshListeners.add(listener);
        listener({ state: "idle", total: 0, processed: 0, failed: 0, revision: 0 });
        return () => refreshListeners.delete(listener);
      },
      getQuestionThumbnail: async () => Buffer.from("RIFF....WEBP"),
    } as unknown as QuestionAdminService;
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
      for (const path of ["session", "library", "topics", "topics/%E8%84%9A/questions", "topics/%E8%84%9A/thumbnail-progress", "thumbnails/refresh", "questions/test/thumbnail", "games", "live/state"]) {
        expect((await fetch(`${base}/${path}`)).status).toBe(401);
      }
      expect((await fetch(`${base}/thumbnails/refresh`, { method: "POST" })).status).toBe(401);
      expect((await fetch(`${base}/thumbnails/refresh/stream`)).status).toBe(401);
      const login = await fetch(`${base}/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "test-password" }) });
      expect(login.status).toBe(200);
      const cookie = login.headers.get("set-cookie")?.split(";")[0];
      expect(cookie).toMatch(/^arkfeets_admin=/);
      for (const path of ["session", "library", "topics", "topics/%E8%84%9A/questions", "topics/%E8%84%9A/thumbnail-progress", "thumbnails/refresh", "questions/test/thumbnail", "games", "live/state"]) {
        expect((await fetch(`${base}/${path}`, { headers: { Cookie: cookie! } })).status).toBe(200);
      }
      const streamController = new AbortController();
      const stream = await fetch(`${base}/thumbnails/refresh/stream`, { headers: { Cookie: cookie! }, signal: streamController.signal });
      expect(stream.status).toBe(200);
      const reader = stream.body!.getReader();
      expect(new TextDecoder().decode((await reader.read()).value)).toContain('"state":"idle"');
      expect((await fetch(`${base}/thumbnails/refresh`, { method: "POST", headers: { Cookie: cookie! } })).status).toBe(200);
      expect(new TextDecoder().decode((await reader.read()).value)).toContain('"state":"running"');
      streamController.abort();
      expect(await (await fetch(`${base}/topics/%E8%84%9A/questions`, { headers: { Cookie: cookie! } })).json()).toEqual([{ id: "test", title: "test", topicId: "脚" }]);
      expect(await (await fetch(`${base}/topics/%E8%84%9A/thumbnail-progress`, { headers: { Cookie: cookie! } })).json()).toEqual({ total: 1, ready: 1, failed: 0 });
      const thumbnail = await fetch(`${base}/questions/test/thumbnail`, { headers: { Cookie: cookie! } });
      expect(thumbnail.headers.get("content-type")).toContain("image/webp");
      expect(thumbnail.headers.get("content-length")).toBe("12");
      expect((await fetch(`${base}/logout`, { method: "POST", headers: { Cookie: cookie! } })).status).toBe(200);
      expect((await fetch(`${base}/session`, { headers: { Cookie: cookie! } })).status).toBe(401);
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
});
