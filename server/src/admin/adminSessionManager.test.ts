import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminSessionManager } from "./adminSessionManager.js";

afterEach(() => vi.useRealTimers());

describe("AdminSessionManager", () => {
  it("rejects invalid passwords and accepts a valid short-term token", () => {
    const sessions = new AdminSessionManager("secret", 1_000);
    expect(() => sessions.login("wrong")).toThrow("后台密码错误");
    const session = sessions.login("secret");
    expect(sessions.verify(session.token)).toBe(true);
    sessions.logout(session.token);
    expect(sessions.verify(session.token)).toBe(false);
  });

  it("expires admin tokens", () => {
    vi.useFakeTimers();
    const sessions = new AdminSessionManager("secret", 1_000);
    const session = sessions.login("secret");
    vi.advanceTimersByTime(1_001);
    expect(sessions.verify(session.token)).toBe(false);
  });
});
