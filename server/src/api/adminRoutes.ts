import { Router, type RequestHandler } from "express";
import multer from "multer";
import { z } from "zod";
import type { AdminSessionManager } from "../admin/adminSessionManager.js";
import type { QuestionAdminService } from "../admin/questionAdminService.js";

const loginSchema = z.object({ password: z.string().min(1).max(200) }).strict();
const createDraftSchema = z.object({ title: z.string().max(100).default("") }).strict();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
const zipUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024, files: 1 } });
const batchUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 200 } });

export function createAdminRoutes(sessions: AdminSessionManager, questions: QuestionAdminService): Router {
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
  router.post("/logout", (request, response) => {
    sessions.logout(readAdminToken(request.headers.authorization, request.headers.cookie));
    response.clearCookie("arkfeets_admin", { path: "/api/admin" });
    response.json({ ok: true });
  });
  router.get("/questions", (_request, response) => run(response, () => questions.list()));
  router.post("/questions", (request, response) => run(response, () => ({ id: questions.createDraft(createDraftSchema.parse(request.body).title) })));
  router.get("/questions/export", (_request, response) => {
    try {
      const archive = questions.exportZip();
      response.setHeader("Content-Type", "application/zip");
      response.setHeader("Content-Disposition", `attachment; filename="arkfeets-questions-${new Date().toISOString().slice(0, 10)}.zip"`);
      response.send(archive);
    } catch (error) {
      response.status(400).json({ message: error instanceof Error ? error.message : "导出失败" });
    }
  });
  router.put("/questions/:id/info", (request, response) => run(response, () => questions.updateInfo(String(request.params.id), request.body)));
  router.post("/questions/:id/images/:kind", upload.single("image"), (request, response) => run(response, () => {
    if (request.params.kind !== "question" && request.params.kind !== "reveal") throw new Error("图片类型无效");
    if (!request.file) throw new Error("请选择图片文件");
    return questions.replaceImage(String(request.params.id), request.params.kind, request.file);
  }));
  router.post("/questions/import-zip", zipUpload.single("archive"), (request, response) => run(response, () => {
    if (!request.file || !request.file.originalname.toLowerCase().endsWith(".zip")) throw new Error("请选择 ZIP 资源包");
    return questions.importZip(request.file.buffer);
  }));
  router.post("/questions/batch-images", batchUpload.array("images", 200), (request, response) => run(response, () => {
    const files = request.files as Express.Multer.File[] | undefined;
    const paths = z.array(z.string().max(500)).parse(JSON.parse(String(request.body.paths ?? "[]")));
    if (!files || files.length !== paths.length) throw new Error("批量图片与路径信息不匹配");
    const drafts = files.map((file, index) => ({ ...file, relativePath: paths[index] }));
    return { ids: questions.createDraftsFromImages(drafts) };
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
