/**
 * تستِ راهبردِ ذخیره‌سازیِ آپلود (WF1) — تمرکز بر دفاع در برابرِ path traversal و
 * راه‌رفت/برگشتِ نوشتن/خواندن روی یک پوشه‌ی موقتِ تزریق‌شده (baseDir).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  readResumeFile,
  resolveWithinBase,
  saveResumeFile,
  uploadsBaseDir,
} from "@/lib/resume/storage";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "karjoo-uploads-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("راهبردِ ذخیره‌سازیِ آپلود", () => {
  it("uploadsBaseDir یک مسیرِ مطلقِ غیرخالی می‌دهد (پیش‌فرضِ ./uploads)", () => {
    expect(uploadsBaseDir().length).toBeGreaterThan(0);
  });

  it("فایل را زیرِ پوشه‌ی کاربر می‌نویسد و دوباره می‌خواند", async () => {
    const userId = "11111111-2222-3333-4444-555555555555";
    const bytes = new TextEncoder().encode("%PDF-1.4 fake");
    const saved = await saveResumeFile(userId, bytes, tempDir);

    expect(saved.relativePath).toMatch(/\.pdf$/);
    // پوشه‌ی کاربر (UUID با خط‌تیره‌های مجاز) در ابتدای مسیرِ نسبی هست.
    expect(saved.relativePath.startsWith(userId)).toBe(true);
    expect(saved.absolutePath.startsWith(tempDir)).toBe(true);

    const read = await readResumeFile(saved.relativePath, tempDir);
    expect(new TextDecoder().decode(read)).toBe("%PDF-1.4 fake");
  });

  it("مسیرهای traversal را رد می‌کند", () => {
    expect(() => resolveWithinBase("../../etc/passwd", tempDir)).toThrow();
    expect(() => resolveWithinBase("../outside.pdf", tempDir)).toThrow();
  });

  it("مسیرِ نسبیِ امن را درونِ پوشه‌ی پایه حل می‌کند", () => {
    const abs = resolveWithinBase("user/file.pdf", tempDir);
    expect(abs.startsWith(tempDir)).toBe(true);
    expect(abs.endsWith(join("user", "file.pdf"))).toBe(true);
  });
});
