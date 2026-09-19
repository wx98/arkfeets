import { randomBytes, timingSafeEqual } from "node:crypto";

interface Session {
  expiresAt: number;
}

export class AdminSessionManager {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly password: string,
    private readonly sessionDurationMs: number,
  ) {}

  login(password: string): { token: string; expiresAt: number } {
    if (!secureEquals(password, this.password)) throw new Error("后台密码错误");
    const token = randomBytes(32).toString("hex");
    const expiresAt = Date.now() + this.sessionDurationMs;
    this.sessions.set(token, { expiresAt });
    return { token, expiresAt };
  }

  verify(token: string | undefined): boolean {
    if (!token) return false;
    const session = this.sessions.get(token);
    if (!session) return false;
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(token);
      return false;
    }
    return true;
  }

  logout(token: string | undefined): void {
    if (token) this.sessions.delete(token);
  }
}

function secureEquals(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}
