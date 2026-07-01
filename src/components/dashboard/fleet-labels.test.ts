/**
 * تست‌های برچسب‌ها/کمک‌کننده‌های نمایشیِ ناوگان (Track C) — خالص، بدونِ I/O.
 *
 * تمرکز:
 *   • نگاشتِ پلن → قابلیتِ سرورِ اپلای (Free/Pro=بدونِ ورکر، Max=۱، MaxPlus=۵؛
 *     پلن‌های تاریخی payg/premium نرمال می‌شوند).
 *   • فاصله‌ی زمانیِ نسبی و تشخیصِ نودِ مرده (stale).
 *   • جمع‌بندیِ تازگیِ نشست.
 *   • قالبِ امنِ نسخه/کلید/سلامتِ نود.
 */
import { describe, expect, it } from "vitest";

import {
  agentVersionLabel,
  isNodeStale,
  nodeHealthLabel,
  planFleetCapability,
  relativeTimeFa,
  shortNodeKey,
  summarizeSessionFreshness,
  workerIpCapacityLabel,
} from "./fleet-labels";

describe("planFleetCapability — نگاشتِ پلن به قابلیتِ سرورِ اپلای", () => {
  it("Free: بدونِ سرورِ اپلای (سقفِ IP = ۰)", () => {
    const cap = planFleetCapability("free");
    expect(cap.planKey).toBe("free");
    expect(cap.workerIpLimit).toBe(0);
    expect(cap.hasWorkerAutoApply).toBe(false);
  });

  it("Pro: بدونِ سرورِ اپلای (افزونه‌محور)", () => {
    const cap = planFleetCapability("pro");
    expect(cap.workerIpLimit).toBe(0);
    expect(cap.hasWorkerAutoApply).toBe(false);
  });

  it("Max: یک سرورِ اپلای", () => {
    const cap = planFleetCapability("max");
    expect(cap.planKey).toBe("max");
    expect(cap.workerIpLimit).toBe(1);
    expect(cap.hasWorkerAutoApply).toBe(true);
    expect(cap.planLabelFa).toBe("مکس");
  });

  it("MaxPlus: پنج سرورِ اپلای", () => {
    const cap = planFleetCapability("maxplus");
    expect(cap.workerIpLimit).toBe(5);
    expect(cap.hasWorkerAutoApply).toBe(true);
  });

  it("پلنِ تاریخیِ payg → free (بدونِ ورکر)", () => {
    const cap = planFleetCapability("payg");
    expect(cap.planKey).toBe("free");
    expect(cap.hasWorkerAutoApply).toBe(false);
  });

  it("پلنِ تاریخیِ premium → pro (بدونِ ورکر)", () => {
    const cap = planFleetCapability("premium");
    expect(cap.planKey).toBe("pro");
    expect(cap.hasWorkerAutoApply).toBe(false);
  });

  it("پلنِ ناشناخته → دفاعی free (هرگز throw نمی‌کند)", () => {
    const cap = planFleetCapability("bogus");
    expect(cap.planKey).toBe("free");
    expect(cap.workerIpLimit).toBe(0);
  });
});

describe("workerIpCapacityLabel", () => {
  it("سقفِ مثبت → «N سرورِ اپلای»", () => {
    expect(workerIpCapacityLabel(1)).toBe("1 سرورِ اپلای");
    expect(workerIpCapacityLabel(5)).toBe("5 سرورِ اپلای");
  });

  it("سقفِ صفر/منفی → null (پلن ورکر ندارد)", () => {
    expect(workerIpCapacityLabel(0)).toBeNull();
    expect(workerIpCapacityLabel(-1)).toBeNull();
  });
});

describe("nodeHealthLabel", () => {
  it("هر وضعیتِ شناخته‌شده برچسب/لحن/آیکن دارد", () => {
    for (const h of ["online", "degraded", "offline"] as const) {
      const meta = nodeHealthLabel(h);
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.icon.length).toBeGreaterThan(0);
    }
    expect(nodeHealthLabel("online").tone).toBe("green");
    expect(nodeHealthLabel("offline").tone).toBe("rose");
  });

  it("وضعیتِ ناشناخته → fallbackِ خنثی", () => {
    const meta = nodeHealthLabel("weird");
    expect(meta.label).toBe("weird");
    expect(meta.tone).toBe("muted");
  });
});

describe("relativeTimeFa", () => {
  const NOW = Date.UTC(2026, 5, 30, 12, 0, 0);

  it("null → «هیچ‌گاه»", () => {
    expect(relativeTimeFa(null, NOW)).toBe("هیچ‌گاه");
  });

  it("کمتر از یک دقیقه → «همین حالا»", () => {
    expect(relativeTimeFa(new Date(NOW - 30 * 1000), NOW)).toBe("همین حالا");
  });

  it("چند دقیقه/ساعت/روز پیش", () => {
    expect(relativeTimeFa(new Date(NOW - 5 * 60 * 1000), NOW)).toBe("5 دقیقه پیش");
    expect(relativeTimeFa(new Date(NOW - 3 * 60 * 60 * 1000), NOW)).toBe("3 ساعت پیش");
    expect(relativeTimeFa(new Date(NOW - 2 * 24 * 60 * 60 * 1000), NOW)).toBe("2 روز پیش");
  });

  it("رشته‌ی تاریخِ معتبر هم پذیرفته می‌شود", () => {
    const iso = new Date(NOW - 60 * 1000).toISOString();
    expect(relativeTimeFa(iso, NOW)).toBe("1 دقیقه پیش");
  });

  it("ورودیِ نامعتبر → «—»", () => {
    expect(relativeTimeFa("not-a-date", NOW)).toBe("—");
  });
});

describe("isNodeStale", () => {
  const NOW = Date.UTC(2026, 5, 30, 12, 0, 0);

  it("null → مرده (true)", () => {
    expect(isNodeStale(null, NOW)).toBe(true);
  });

  it("جدیدتر از آستانه → زنده (false)", () => {
    expect(isNodeStale(new Date(NOW - 30 * 1000), NOW)).toBe(false);
  });

  it("قدیمی‌تر از آستانه‌ی پیش‌فرض (۲ دقیقه) → مرده (true)", () => {
    expect(isNodeStale(new Date(NOW - 5 * 60 * 1000), NOW)).toBe(true);
  });

  it("آستانه‌ی سفارشی محترم شمرده می‌شود", () => {
    const t = new Date(NOW - 90 * 1000);
    expect(isNodeStale(t, NOW, 60 * 1000)).toBe(true);
    expect(isNodeStale(t, NOW, 5 * 60 * 1000)).toBe(false);
  });
});

describe("summarizeSessionFreshness", () => {
  it("بدونِ سایت → anyFresh=false، total=۰", () => {
    const f = summarizeSessionFreshness([]);
    expect(f.total).toBe(0);
    expect(f.anyFresh).toBe(false);
    expect(f.staleCount).toBe(0);
  });

  it("همه stale → anyFresh=false", () => {
    const f = summarizeSessionFreshness([{ stale: true }, { stale: true }]);
    expect(f.total).toBe(2);
    expect(f.staleCount).toBe(2);
    expect(f.anyFresh).toBe(false);
  });

  it("دستِ‌کم یکی تازه → anyFresh=true", () => {
    const f = summarizeSessionFreshness([{ stale: true }, { stale: false }]);
    expect(f.staleCount).toBe(1);
    expect(f.anyFresh).toBe(true);
  });
});

describe("agentVersionLabel", () => {
  it("نسخه‌ی موجود را برمی‌گرداند", () => {
    expect(agentVersionLabel("1.2.3")).toBe("1.2.3");
  });

  it("null/خالی/فاصله → «نامشخص»", () => {
    expect(agentVersionLabel(null)).toBe("نامشخص");
    expect(agentVersionLabel(undefined)).toBe("نامشخص");
    expect(agentVersionLabel("   ")).toBe("نامشخص");
  });
});

describe("shortNodeKey", () => {
  it("کلیدِ کوتاه را دست‌نخورده برمی‌گرداند", () => {
    expect(shortNodeKey("node-1")).toBe("node-1");
  });

  it("کلیدِ بلند را کوتاه می‌کند", () => {
    const long = "abcdefgh-ijkl-mnop-qrst";
    expect(shortNodeKey(long)).toBe("abcdefgh…");
  });
});
