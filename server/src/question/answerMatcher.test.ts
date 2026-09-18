import { describe, expect, it } from "vitest";
import { matchesAnswer, normalizeAnswer } from "./answerMatcher.js";

describe("answerMatcher", () => {
  it("removes every whitespace character", () => {
    expect(normalizeAnswer(" 照 片\t墙\n")).toBe("照片墙");
  });

  it("matches one of multiple exact answers after whitespace removal", () => {
    expect(matchesAnswer("调 查 员", ["调查员", "调查人员"])).toBe(true);
  });

  it("keeps non-whitespace characters and letter case strict", () => {
    expect(matchesAnswer("调查", ["调查员"])).toBe(false);
    expect(matchesAnswer("abc", ["ABC"])).toBe(false);
  });
});
