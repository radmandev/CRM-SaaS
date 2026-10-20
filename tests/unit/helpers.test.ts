import { describe, expect, it } from "vitest";
import { backoffMs } from "@/server/jobs";
import { diff } from "@/server/audit";
import { after, decodeCursor, page } from "@/server/pagination";
import { sniffImage } from "@/modules/tenancy/service";
import { formatBytes, formatDate, formatDateTime } from "@/lib/format";

describe("job backoff (JOB-03)", () => {
  it("doubles from 30 s, caps at 6 h, and jitters ±20%", () => {
    expect(backoffMs(1, 0.5)).toBe(30_000);
    expect(backoffMs(2, 0.5)).toBe(60_000);
    expect(backoffMs(20, 0.5)).toBe(6 * 3_600_000);
    expect(backoffMs(1, 0)).toBe(24_000);
    expect(backoffMs(1, 1)).toBe(36_000);
  });
});

describe("audit diff (AUD-01)", () => {
  it("reports only changed fields and redacts secrets", () => {
    expect(diff({ a: 1, b: "x", d: new Date("2026-01-01") }, { a: 1, b: "y", d: new Date("2026-01-01") })).toEqual({ b: ["x", "y"] });
    expect(diff({ password: "old" }, { password: "new" })).toEqual({ password: ["[redacted]", "[redacted]"] });
    expect(diff({ a: 1 }, { a: 1 })).toBeNull();
  });
});

describe("keyset pagination (API-05)", () => {
  it("round-trips cursors and rejects garbage", () => {
    const rows = [{ id: "1", v: "a" }, { id: "2", v: "b" }, { id: "3", v: "c" }];
    const p = page(rows, 2, (r) => r.v);
    expect(p.data).toHaveLength(2);
    expect(p.page.hasMore).toBe(true);
    expect(decodeCursor(p.page.nextCursor!)).toEqual({ v: "b", id: "2" });
    expect(after(p.page.nextCursor!, "v", "asc")).toEqual({ OR: [{ v: { gt: "b" } }, { v: "b", id: { gt: "2" } }] });
    expect(page(rows, 5, (r) => r.v).page).toEqual({ nextCursor: null, hasMore: false });
    expect(() => decodeCursor("not-a-cursor")).toThrow();
  });
});

describe("image sniffing (DOC-01)", () => {
  it("detects by magic bytes, not by name", () => {
    expect(sniffImage(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImage(new TextEncoder().encode("RIFF....WEBPVP8 "))).toBe("image/webp");
    expect(sniffImage(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
  });
});

describe("formatting (LOC-02, LOC-03, LOC-05, LOC-06)", () => {
  it("shows timestamps in the tenant timezone with Western digits", () => {
    const utcMidnight = new Date("2026-10-19T21:30:00Z");
    expect(formatDateTime(utcMidnight, "en", "Asia/Riyadh")).toContain("Oct 20, 2026"); // 00:30 next day in Riyadh
    expect(formatDateTime(utcMidnight, "ar", "Asia/Riyadh")).toMatch(/2026/);
    expect(formatDateTime(utcMidnight, "en", "Asia/Riyadh", { hijri: true })).toMatch(/AH/);
  });
  it("keeps date-only values on their calendar day in any timezone", () => {
    expect(formatDate("2026-12-01", "en")).toBe("Dec 1, 2026");
  });
  it("formats sizes", () => {
    expect(formatBytes(1536, "en")).toBe("1.5 KB");
  });
});
