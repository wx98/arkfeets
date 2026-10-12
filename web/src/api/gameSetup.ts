export interface GamePreferences {
  hintRemainingPercent: number;
  revealSeconds: number;
  autoNext: boolean;
}

export interface GameTopic { id: string; name: string; isDefault: boolean }

export interface RoomSetup {
  topicId: string;
  difficulty: "simple" | "medium" | "hard" | "hell";
  requestedCount: 0 | 20 | 50 | 100;
  answerSource: "WEB" | "EXTERNAL_API" | "BILIBILI";
  customDuration: boolean;
  durationSeconds: number;
  durationMin: number;
  durationMax: number;
  preferences: GamePreferences;
}

export async function loadGameSetup(): Promise<{ topics: GameTopic[]; preferences: GamePreferences; roomSetup: RoomSetup | null }> {
  const response = await fetch("/api/game/setup");
  if (!response.ok) throw new Error("无法读取对局设置");
  return response.json();
}

export async function saveRoomSetup(roomSetup: RoomSetup): Promise<void> {
  const response = await fetch("/api/game/room-setup", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(roomSetup),
  });
  if (!response.ok) throw new Error((await response.json()).message ?? "无法保存建房配置");
}

export async function saveGamePreferences(preferences: GamePreferences): Promise<void> {
  const response = await fetch("/api/game/preferences", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(preferences),
  });
  if (!response.ok) throw new Error((await response.json()).message ?? "无法保存对局设置");
}
