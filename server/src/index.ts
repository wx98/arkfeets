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
import { BilibiliDanmakuBridge } from "./multiplayer/bilibiliDanmakuBridge.js";
import { GameAuditLogger } from "./multiplayer/gameAuditLogger.js";
import { GameAuditReader } from "./multiplayer/gameAuditReader.js";
import { relayLiveDanmaku } from "./multiplayer/liveDanmakuRelay.js";
import { managerCallbacks, registerMultiplayerGateway } from "./multiplayer/socketGateway.js";
import { QuestionRepository } from "./question/questionRepository.js";
import { SoloSessionManager } from "./solo/soloSessionManager.js";
import { GamePreferencesStore, gamePreferencesSchema, roomSetupSchema } from "./gamePreferences.js";

const app = express();
const httpServer = createServer(app);
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const currentDir = process.env.ARKFEETS_APP_ROOT
  ? join(process.env.ARKFEETS_APP_ROOT, "server", "dist")
  : dirname(fileURLToPath(import.meta.url));
const resourceDirectory = join(currentDir, "../resource");
const preferencesStore = new GamePreferencesStore(join(currentDir, "../config.json"));
const config = JSON.parse(readFileSync(join(currentDir, "../config.json"), "utf8")) as {
  adminPassword: string;
  adminSessionHours?: number;
  appName?: string;
};
const questionRepository = new QuestionRepository(resourceDirectory);
const soloSessionManager = new SoloSessionManager(questionRepository, () => preferencesStore.read());
const adminSessions = new AdminSessionManager(config.adminPassword, (config.adminSessionHours ?? 8) * 60 * 60 * 1000);
const questionAdminService = new QuestionAdminService(resourceDirectory, questionRepository);
const gameAuditLogger = new GameAuditLogger(join(currentDir, "../logs/games"));
const gameAuditReader = new GameAuditReader(join(currentDir, "../logs/games"), id => gameAuditLogger.isActiveFile(id));
let bilibiliBridge: BilibiliDanmakuBridge;

app.use("/full-data", express.static(join(resourceDirectory, "full_data")));
app.get("/api/site", (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  const exclude = typeof request.query.exclude === "string" ? request.query.exclude : undefined;
  response.json({
    appName: typeof config.appName === "string" ? config.appName.trim() || "粥粥图猜猜" : "粥粥图猜猜",
    homeImageUrl: questionRepository.getRandomOriginalImageUrl(exclude),
    questionCount: questionRepository.getEnabledQuestionCount(),
  });
});
app.use("/api/solo", createSoloRoutes(soloSessionManager));
app.get("/api/game/setup", (_request, response) => {
  response.json({ topics: questionRepository.getTopics(), preferences: preferencesStore.read(), roomSetup: preferencesStore.readRoomSetup() });
});
app.put("/api/game/preferences", (request, response) => {
  try { response.json(preferencesStore.save(gamePreferencesSchema.parse(request.body))); }
  catch (error) { response.status(400).json({ message: error instanceof Error ? error.message : "保存失败" }); }
});
app.put("/api/game/room-setup", (request, response) => {
  try { response.json(preferencesStore.saveRoomSetup(roomSetupSchema.parse(request.body))); }
  catch (error) { response.status(400).json({ message: error instanceof Error ? error.message : "保存失败" }); }
});

app.get("/api/health", (request, response) => {
  const address = request.socket.remoteAddress;
  const local = address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
  response.json({
    ok: true,
    time: Date.now(),
    questions: questionRepository.getValidationReport().validCount,
    ...(local && process.env.ARKFEETS_INSTANCE_ID ? { instanceId: process.env.ARKFEETS_INSTANCE_ID } : {}),
  });
});

app.get("/api/questions/validation", (_request, response) => {
  response.json(questionRepository.getValidationReport());
});

const io = new Server(httpServer, {
  cors: { origin: true, credentials: true },
});
const multiplayerRoomManager = new MultiplayerRoomManager(questionRepository, {
  onGameStarted: (roomCode, details) => gameAuditLogger.start(roomCode, details),
  onAnswerReceived: (roomCode, details) => gameAuditLogger.answer(roomCode, details),
  onGameEnded: (roomCode, details) => gameAuditLogger.end(roomCode, details),
  onRoomUpdated: (roomCode) => {
    if (bilibiliBridge?.roomCode === roomCode && !multiplayerRoomManager.getActiveBilibiliRoomCode()) {
      const view = multiplayerRoomManager.getView(roomCode, "");
      if (view.state === "RANKING") bilibiliBridge.stop();
    }
    managerCallbacks.get(multiplayerRoomManager)?.update(roomCode);
  },
  onRoomClosed: (roomCode, message) => {
    if (bilibiliBridge?.roomCode === roomCode) bilibiliBridge.stop();
    managerCallbacks.get(multiplayerRoomManager)?.close(roomCode, message);
  },
});
bilibiliBridge = new BilibiliDanmakuBridge(
  join(currentDir, "../config.json"),
  (roomCode, answer) => relayLiveDanmaku(multiplayerRoomManager, io, roomCode, answer),
  (roomCode, connected) => multiplayerRoomManager.setBilibiliConnection(roomCode, connected),
);
app.use("/api/admin", createAdminRoutes(adminSessions, questionAdminService, bilibiliBridge, gameAuditReader));
registerMultiplayerGateway(io, multiplayerRoomManager, bilibiliBridge);
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
  console.log(`${config.appName?.trim() || "粥粥图猜猜"} server: http://localhost:${port}`);
});
