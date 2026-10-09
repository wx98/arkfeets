import { Router, type RequestHandler } from "express";
import { mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import multer from "multer";
import { z } from "zod";
import type { AdminSessionManager } from "../admin/adminSessionManager.js";
import type { QuestionAdminService } from "../admin/questionAdminService.js";
import type { BilibiliDanmakuBridge } from "../multiplayer/bilibiliDanmakuBridge.js";
import type { GameAuditReader } from "../multiplayer/gameAuditReader.js";

const loginSchema = z.object({ password: z.string().min(1).max(200) }).strict();
const importDirectory = join(tmpdir(), "arkfeets-imports");
mkdirSync(importDirectory, { recursive: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
const zipUpload = multer({ dest: importDirectory, limits: { fileSize: 8 * 1024 * 1024 * 1024, files: 1 } });
const batchUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 200 } });
const exportProgress = new Map<string, { written: number; total: number; done: boolean; error?: string }>();

export function createAdminRoutes(sessions: AdminSessionManager, questions: QuestionAdminService, live?: BilibiliDanmakuBridge, audit?: GameAuditReader): Router {
  const router = Router();
  router.post("/login", (request, response) => {
    try {
      const session = sessions.login(loginSchema.parse(request.body).password);
      response.cookie("arkfeets_admin", session.token, {
        httpOnly: true,
        sameSite: "strict",
        path: "/api/admin",
        maxAge: Math.max(0, session.expiresAt - Date.now()),
      });
      response.json(session);
    } catch (error) {
      response.status(401).json({ message: error instanceof Error ? error.message : "登录失败" });
    }
  });
  router.use(authenticate(sessions));
  router.get("/session", (_request, response) => response.json({ authenticated: true }));
  if (audit) {
    const pagination = z.object({
      page: z.coerce.number().int().min(0).max(100_000).default(0),
      pageSize: z.coerce.number().int().min(1).max(100).default(20),
    });
    router.get("/games", (request, response) => runAsync(response, () => {
      const { page, pageSize } = pagination.parse(request.query);
      return audit.list(page, pageSize);
    }));
    router.get("/games/:id", (request, response) => runAsync(response, () => {
      const { page, pageSize } = pagination.parse(request.query);
      const search = z.string().max(100).default("").parse(request.query.search);
      const correct = z.enum(["true", "false"]).optional().parse(request.query.correct);
      return audit.detail(String(request.params.id), page, pageSize, search, correct === undefined ? undefined : correct === "true");
    }));
    router.delete("/games/:id", (request, response) => runAsync(response, () => audit.delete(String(request.params.id))));
  }
  if (live) {
    router.get("/live/state", (_request, response) => run(response, () => live.snapshot()));
    router.get("/live/stream", async (_request, response) => {
      response.setHeader("Content-Type", "text/event-stream");
      response.setHeader("Cache-Control", "no-cache, no-transform");
      response.setHeader("Connection", "keep-alive");
      response.flushHeaders();
      const release = await live.acquireMonitor(snapshot => {
        if (!response.destroyed) response.write(`data: ${JSON.stringify(snapshot)}\n\n`);
      });
      if (response.destroyed) { release(); return; }
      const keepalive = setInterval(() => {
        if (!response.destroyed) response.write(": keepalive\n\n");
      }, 20_000);
      response.on("close", () => { clearInterval(keepalive); release(); });
    });
    router.put("/live/users/:uid", (request, response) => run(response, () => {
      const status = z.enum(["normal", "white", "black"]).parse(request.body?.status);
      return live.setAccess(String(request.params.uid), status);
    }));
    router.put("/live/allowlist", (request, response) => run(response, () => {
      const enabled = z.boolean().parse(request.body?.enabled);
      return live.setAllowlistMode(enabled);
    }));
    router.put("/live/listening", (request, response) => run(response, () => {
      const enabled = z.boolean().parse(request.body?.enabled);
      return live.setListeningEnabled(enabled);
    }));
  }
  router.post("/logout", (request, response) => {
    sessions.logout(readAdminToken(request.headers.authorization, request.headers.cookie));
    response.clearCookie("arkfeets_admin", { path: "/api/admin" });
    response.json({ ok: true });
  });
  router.get("/library", (_request, response) => run(response, () => questions.list()));
  router.get("/topics", (_request, response) => run(response, () => questions.listTopics()));
  router.post("/topics", (request, response) => run(response, () => questions.createTopic(z.string().parse(request.body?.name))));
  router.put("/topics/:id", (request, response) => run(response, () => questions.updateTopic(String(request.params.id), z.object({ name: z.string(), isDefault: z.boolean() }).strict().parse(request.body))));
  router.delete("/topics/:id", (request, response) => run(response, () => questions.deleteTopic(String(request.params.id))));
  router.get("/questions", (_request, response) => run(response, () => questions.list()));
  router.post("/questions", (request, response) => run(response, () => ({ id: questions.createQuestion(request.body) })));
  router.get("/questions/export-progress/:jobId", (request, response) => {
    const progress = exportProgress.get(String(request.params.jobId));
    if (!progress) {
      response.status(404).json({ message: "导出任务尚未开始或已结束" });
      return;
    }
    response.json(progress);
  });
  router.get("/questions/export", async (request, response) => {
    const jobId = typeof request.query.jobId === "string" && /^[a-zA-Z0-9_-]{8,80}$/.test(request.query.jobId) ? request.query.jobId : "";
    let progress: { written: number; total: number; done: boolean; error?: string } | undefined;
    try {
      const archive = questions.createExport();
      if (jobId) {
        progress = { written: 0, total: archive.sourceBytes, done: false };
        exportProgress.set(jobId, progress);
      }
      response.setHeader("Content-Type", "application/zip");
      response.setHeader("Content-Disposition", `attachment; filename="arkfeets-questions-${new Date().toISOString().slice(0, 10)}.zip"`);
      response.setHeader("X-Archive-Source-Bytes", archive.sourceBytes);
      await archive.writeTo(response, (written) => { if (progress) progress.written = written; });
      if (progress) progress.done = true;
    } catch (error) {
      if (progress) {
        progress.done = true;
        progress.error = error instanceof Error ? error.message : "导出失败";
      }
      if (response.headersSent) response.destroy(error instanceof Error ? error : undefined);
      else response.status(400).json({ message: error instanceof Error ? error.message : "导出失败" });
    } finally {
      if (jobId) setTimeout(() => exportProgress.delete(jobId), 5 * 60 * 1000).unref();
    }
  });
  router.put("/questions/:id", (request, response) => run(response, () => questions.updateQuestion(String(request.params.id), request.body)));
  router.delete("/questions/:id", (request, response) => run(response, () => questions.deleteQuestion(String(request.params.id))));
  router.post("/trash/:trashId/restore", (request, response) => run(response, () => questions.restoreQuestion(String(request.params.trashId))));
  router.delete("/trash/:trashId", (request, response) => run(response, () => questions.permanentlyDeleteQuestion(String(request.params.trashId))));
  router.post("/images", upload.single("image"), (request, response) => runAsync(response, async () => {
    if (!request.file) throw new Error("请选择图片文件");
    return await questions.addImages([request.file]);
  }));
  router.put("/images/:fileName/metadata", (request, response) => run(response, () => questions.updateImageMetadata(String(request.params.fileName), request.body)));
  router.post("/questions/import-zip", zipUpload.single("archive"), (request, response) => runAsync(response, async () => {
    if (!request.file || !request.file.originalname.toLowerCase().endsWith(".zip")) throw new Error("请选择 ZIP 资源包");
    try {
      return await questions.importZip(request.file.path);
    } finally {
      await rm(request.file.path, { force: true });
    }
  }));
  router.post("/questions/batch-images", batchUpload.array("images", 200), (request, response) => runAsync(response, async () => {
    const files = request.files as Express.Multer.File[] | undefined;
    const paths = z.array(z.string().max(500)).parse(JSON.parse(String(request.body.paths ?? "[]")));
    if (!files || files.length !== paths.length) throw new Error("批量图片与路径信息不匹配");
    const namedFiles = files.map((file, index) => ({ ...file, originalname: paths[index].split(/[\\/]/u).at(-1) || file.originalname }));
    return await questions.addImages(namedFiles);
  }));
  return router;
}

function authenticate(sessions: AdminSessionManager): RequestHandler {
  return (request, response, next) => {
    if (!sessions.verify(readAdminToken(request.headers.authorization, request.headers.cookie))) {
      response.status(401).json({ message: "管理会话无效或已过期" });
      return;
    }
    next();
  };
}

function readAdminToken(authorization: string | undefined, cookieHeader: string | undefined): string | undefined {
  if (authorization?.startsWith("Bearer ")) return authorization.slice(7);
  return cookieHeader?.split(";").map((part) => part.trim()).find((part) => part.startsWith("arkfeets_admin="))?.slice("arkfeets_admin=".length);
}

function run(response: import("express").Response, action: () => unknown): void {
  try {
    response.json(action());
  } catch (error) {
    const message = error instanceof Error ? error.message : "请求失败";
    response.status(message.includes("密码") ? 401 : 400).json({ message });
  }
}

async function runAsync(response: import("express").Response, action: () => Promise<unknown>): Promise<void> {
  try {
    response.json(await action());
  } catch (error) {
    const message = error instanceof Error ? error.message : "请求失败";
    response.status(message.includes("密码") ? 401 : 400).json({ message });
  }
}
