import { Router, type RequestHandler } from "express";
import multer from "multer";
import { z } from "zod";
import type { AdminSessionManager } from "../admin/adminSessionManager.js";
import type { QuestionAdminService } from "../admin/questionAdminService.js";

const loginSchema = z.object({ password: z.string().min(1).max(200) }).strict();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
const zipUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024, files: 1 } });

export function createAdminRoutes(sessions: AdminSessionManager, questions: QuestionAdminService): Router {
  const router = Router();
  router.post("/login", (request, response) => run(response, () => sessions.login(loginSchema.parse(request.body).password)));
  router.use(authenticate(sessions));
  router.post("/logout", (request, response) => {
    sessions.logout(readBearerToken(request.headers.authorization));
    response.json({ ok: true });
  });
  router.get("/questions", (_request, response) => run(response, () => questions.list()));
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
  return router;
}

function authenticate(sessions: AdminSessionManager): RequestHandler {
  return (request, response, next) => {
    if (!sessions.verify(readBearerToken(request.headers.authorization))) {
      response.status(401).json({ message: "管理会话无效或已过期" });
      return;
    }
    next();
  };
}

function readBearerToken(authorization: string | undefined): string | undefined {
  return authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
}

function run(response: import("express").Response, action: () => unknown): void {
  try {
    response.json(action());
  } catch (error) {
    const message = error instanceof Error ? error.message : "请求失败";
    response.status(message.includes("密码") ? 401 : 400).json({ message });
  }
}
