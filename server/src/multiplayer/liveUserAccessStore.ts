import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { z } from "zod";

const uidSchema = z.string().regex(/^[\w-]{1,100}$/);
const statusSchema = z.enum(["normal", "white", "black"]);
const userSchema = z.object({
  uid: uidSchema,
  nickname: z.string().max(80),
  status: statusSchema,
  updatedAt: z.string(),
}).strict();
const fileSchema = z.object({
  version: z.literal(1),
  allowlistMode: z.boolean(),
  users: z.array(userSchema),
}).strict();

export type LiveUserStatus = z.infer<typeof statusSchema>;
export type SavedLiveUser = z.infer<typeof userSchema>;

interface LegacyAccess {
  uidBlacklist?: Array<string | number>;
  uidWhitelist?: Array<string | number>;
  allowlistMode?: boolean;
}

export class LiveUserAccessStore {
  private readonly users = new Map<string, SavedLiveUser>();
  private allowlistMode = false;
  private revision = "";
  private readError = "";

  constructor(private readonly path: string, legacy: LegacyAccess) {
    if (existsSync(path)) {
      this.load();
      return;
    }
    this.allowlistMode = Boolean(legacy.allowlistMode);
    const updatedAt = new Date().toISOString();
    for (const uid of legacy.uidWhitelist ?? []) this.importUser(String(uid), "white", updatedAt);
    for (const uid of legacy.uidBlacklist ?? []) this.importUser(String(uid), "black", updatedAt);
    this.persist();
  }

  getUsers(): SavedLiveUser[] { this.refresh(); return [...this.users.values()]; }
  get(uid: string): SavedLiveUser | undefined { this.refresh(); return this.users.get(uid); }
  isAllowlistMode(): boolean { this.refresh(); return this.allowlistMode; }
  getError(): string { this.refresh(); return this.readError; }

  getLists(): { blacklist: string[]; whitelist: string[] } {
    this.refresh();
    const blacklist: string[] = [];
    const whitelist: string[] = [];
    for (const user of this.users.values()) {
      if (user.status === "black") blacklist.push(user.uid);
      if (user.status === "white") whitelist.push(user.uid);
    }
    return { blacklist, whitelist };
  }

  isAllowed(uid: string): boolean {
    this.refresh();
    if (this.readError) return false;
    const status = this.users.get(uid)?.status;
    return status !== "black" && (!this.allowlistMode || status === "white");
  }

  setStatus(uid: string, nickname: string, status: LiveUserStatus): void {
    this.refresh();
    if (this.readError) throw new Error(this.readError);
    uidSchema.parse(uid);
    statusSchema.parse(status);
    const previous = this.users.get(uid);
    this.users.set(uid, { uid, nickname: nickname.trim().slice(0, 80) || uid, status, updatedAt: new Date().toISOString() });
    try { this.persist(); }
    catch (error) {
      if (previous) this.users.set(uid, previous);
      else this.users.delete(uid);
      throw error;
    }
  }

  setAllowlistMode(enabled: boolean): void {
    this.refresh();
    if (this.readError) throw new Error(this.readError);
    const previous = this.allowlistMode;
    this.allowlistMode = enabled;
    try { this.persist(); }
    catch (error) { this.allowlistMode = previous; throw error; }
  }

  private importUser(uid: string, status: LiveUserStatus, updatedAt: string): void {
    if (!uidSchema.safeParse(uid).success) return;
    this.users.set(uid, { uid, nickname: uid, status, updatedAt });
  }

  private refresh(): void {
    try {
      const file = statSync(this.path);
      if (`${file.mtimeMs}:${file.size}` !== this.revision) this.load();
      this.readError = "";
    } catch {
      this.readError = "直播用户权限配置文件无法读取，请检查 live_user_access.json";
    }
  }

  private load(): void {
    let file: z.infer<typeof fileSchema>;
    try { file = fileSchema.parse(JSON.parse(readFileSync(this.path, "utf8"))); }
    catch { throw new Error("直播用户权限配置文件格式无效，请检查 live_user_access.json"); }
    this.allowlistMode = file.allowlistMode;
    this.users.clear();
    for (const user of file.users) this.users.set(user.uid, user);
    const info = statSync(this.path);
    this.revision = `${info.mtimeMs}:${info.size}`;
  }

  private persist(): void {
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify({ version: 1, allowlistMode: this.allowlistMode, users: [...this.users.values()] }, null, 2) + "\n", { flag: "wx" });
      renameSync(temporary, this.path);
      const info = statSync(this.path);
      this.revision = `${info.mtimeMs}:${info.size}`;
      this.readError = "";
    } finally {
      rmSync(temporary, { force: true });
    }
  }
}
