import { describe, expect, it } from "vitest";
import { formatSaved, savedPercent } from "../src/lib/count";

describe("formatSaved", () => {
  it("menampilkan persen hemat bila positif", () => {
    expect(formatSaved(66)).toBe("66% saved");
  });

  it("tidak pernah menampilkan persen nol atau negatif", () => {
    expect(formatSaved(0)).toBe("no savings");
    expect(formatSaved(savedPercent(10, 34))).toBe("no savings");
  });
});
