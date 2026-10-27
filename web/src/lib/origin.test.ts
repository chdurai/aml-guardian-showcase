import { describe, expect, it } from "vitest";
import { isSameOrigin } from "./origin";

describe("same-origin browser commands", () => {
  it("uses the actual Host, not Next.js's internal hostname", () => {
    expect(isSameOrigin("http://127.0.0.1:3000", "127.0.0.1:3000", "http:")).toBe(true);
  });
  it("rejects absent, malformed, cross-origin and protocol-mismatched origins", () => {
    for (const origin of [null, "null", "not-a-url", "https://127.0.0.1:3000", "http://other.test:3000", "http://127.0.0.1:4000"])
      expect(isSameOrigin(origin, "127.0.0.1:3000", "http:")).toBe(false);
  });
});
