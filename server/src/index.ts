import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";
import { createSoloRoutes } from "./api/soloRoutes.js";
import { createGameRoutes } from "./api/gameRoutes.js";
import { createAdminRoutes } from "./api/adminRoutes.js";
import { AdminSessionManager } from "./admin/adminSessionManager.js";
import { QuestionAdminService } from "./admin/questionAdminService.js";
import { MultiplayerRoomManager } from "./multiplayer/multiplayerRoomManager.js";
import { managerCallbacks, registerMultiplayerGateway } from "./multiplayer/socketGateway.js";
import { QuestionRepository } from "./question/questionRepository.js";
import { SoloSessionManager } from "./solo/soloSessionManager.js";

const app = express();
const httpServer = createServer(app);
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const currentDir = dirname(fileURLToPath(import.meta.url));
const questionDirectory = join(currentDir, "../resource/question");
const config = JSON.parse(readFileSync(join(currentDir, "../config.json"), "utf8")) as {
  adminPassword: string;
  adminSessionHours?: number;
};
const questionRepository = new QuestionRepository(questionDirectory);
const soloSessionManager = new SoloSessionManager(questionRepository);
const adminSessions = new AdminSessionManager(config.adminPassword, (config.adminSessionHours ?? 8) * 60 * 60 * 1000);
const questionAdminService = new QuestionAdminService(questionDirectory, questionRepository);

app.use("/questions", express.static(questionDirectory));
app.use("/api/solo", createSoloRoutes(soloSessionManager));
app.use("/api/admin", createAdminRoutes(adminSessions, questionAdminService));

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, time: Date.now(), questions: questionRepository.getValidationReport().validCount });
});

app.get("/api/questions/validation", (_request, response) => {
  response.json(questionRepository.getValidationReport());
});

const io = new Server(httpServer, {
  cors: { origin: true, credentials: true },
});
const multiplayerRoomManager = new MultiplayerRoomManager(questionRepository, {
  onRoomUpdated: (roomCode) => managerCallbacks.get(multiplayerRoomManager)?.update(roomCode),
  onRoomClosed: (roomCode, message) => managerCallbacks.get(multiplayerRoomManager)?.close(roomCode, message),
});
registerMultiplayerGateway(io, multiplayerRoomManager);
app.use("/api/game", createGameRoutes(multiplayerRoomManager));

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "请求处理失败";
  const status = typeof error === "object" && error !== null && "code" in error && error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
  response.status(status).json({ message });
});

const webDist = join(currentDir, "../../web/dist");

if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get("/{*path}", (_request, response) => response.sendFile(join(webDist, "index.html")));
}

httpServer.listen(port, host, () => {
  console.log(`粥批来猜∠ server: http://localhost:${port}`);
});
