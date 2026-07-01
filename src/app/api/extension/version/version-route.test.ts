/**
 * تست‌های `GET /api/extension/version` — مسیرِ عمومیِ اعلانِ نسخه‌ی افزونه.
 *
 * استراتژی: بدون DB/شبکه؛ مسیر فقط ثابت‌ها را برمی‌گرداند. تأیید می‌کنیم که:
 *   • بدون احراز هویت پاسخِ ۲۰۰ می‌دهد (عمومی؛ افزونه‌ی جفت‌نشده هم باید بفهمد)،
 *   • `version` دقیقاً برابرِ ثابتِ یگانه و برابرِ نسخه‌ی manifestِ افزونه است،
 *   • `downloadUrl` همان مسیرِ ZIPِ افزونه است،
 *   • هدرِ کش عمومی و کش‌پذیر است،
 *   • شکلِ پاسخ فقط فیلدهای عمومی دارد (بدونِ نشتِ داده).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { GET } from "@/app/api/extension/version/route";
import {
  KARJOO_EXTENSION_DOWNLOAD_PATH,
  KARJOO_EXTENSION_VERSION,
} from "@/lib/extension/version";

describe("GET /api/extension/version", () => {
  it("عمومی است: بدونِ احراز → ۲۰۰ با نسخه و لینکِ دانلود", async () => {
    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.version).toBe(KARJOO_EXTENSION_VERSION);
    expect(body.downloadUrl).toBe(KARJOO_EXTENSION_DOWNLOAD_PATH);
    expect(body.downloadUrl).toBe("/karjoo-extension.zip");
  });

  it("نسخه یک semver معتبر است (MAJOR.MINOR.PATCH)", async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("هدرِ کش عمومی و کش‌پذیر است (بارِ سرور را کم می‌کند)", async () => {
    const res = await GET();
    const cache = res.headers.get("Cache-Control") ?? "";
    expect(cache).toContain("public");
    expect(cache).toContain("max-age=");
  });

  it("فقط فیلدهای عمومی برمی‌گردد (بدونِ نشتِ داده)", async () => {
    const res = await GET();
    const body = await res.json();
    const keys = Object.keys(body).sort();
    // فقط این کلیدها مجازند؛ `notes` اختیاری است.
    for (const k of keys) {
      expect(["version", "downloadUrl", "notes"]).toContain(k);
    }
    expect(keys).toContain("version");
    expect(keys).toContain("downloadUrl");
  });

  it("ثابتِ نسخه با extension/manifest.json برابر است (منبعِ یگانه)", () => {
    // هر دو باید با هم حرکت کنند؛ اگر manifest بامپ شد و ثابت نه (یا برعکس)، این تست می‌شکند.
    const manifestPath = fileURLToPath(
      new URL("../../../../../extension/manifest.json", import.meta.url),
    );
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      version: string;
    };
    expect(KARJOO_EXTENSION_VERSION).toBe(manifest.version);
  });
});
