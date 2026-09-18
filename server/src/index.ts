import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";

const app = express();
const httpServer = createServer(app);
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, time: Date.now() });
});

const io = new Server(httpServer, {
  cors: { origin: true, credentials: true },
});

io.on("connection", (socket) => {
  socket.emit("server:ready", { connectedAt: Date.now() });
});

const currentDir = dirname(fileURLToPath(import.meta.url));
const webDist = join(currentDir, "../../web/dist");

if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get("/{*path}", (_request, response) => response.sendFile(join(webDist, "index.html")));
}

httpServer.listen(port, host, () => {
  console.log(`粥批来猜∠ server: http://localhost:${port}`);
});
