/**
 * تصویرِ Open Graph (اشتراکِ اجتماعی) — نشانِ KafSpark + وردمارکِ «کارجو» روی گرادیانِ
 * برند، تولیدشده با next/og (Satori). این فایلْ کانونشنِ متادیتای Next است: خودش تگ‌های
 * og:image / twitter:image را با اندازه و نوعِ درست به <head> اضافه می‌کند.
 *
 * فونتِ فارسی: Satori فونتِ سیستمی ندارد و فقط TTF/OTF می‌فهمد (نه woff2). برای رندرِ
 * «کارجو» وزیرمتنِ *استاتیکِ TTF* را از CDNِ jsDelivr می‌گیریم و پیش از تحویل به Satori
 * امضای فایل را چک می‌کنیم؛ اگر شبکه نبود یا فایل TTF نبود، loadVazirmatn مقدارِ null
 * می‌دهد و به چیدمانِ لاتین-امن («Karjoo AI») برمی‌گردیم تا prerender/رندر هرگز نشکند.
 */
import { ImageResponse } from "next/og";

import { site } from "@/lib/site";

// متادیتای تصویر — اندازه‌ی استانداردِ OG.
export const alt = "کارجو — اپلای هوشمند کار با هوش مصنوعی";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// روی Node اجرا شود (هم‌راستا با runtime='nodejs' پروژه؛ fetchِ فونت بی‌دردسر است).
export const runtime = "nodejs";

/** آدرسِ وزیرمتنِ استاتیکِ Bold (TTF) روی jsDelivr — امضای فایل 0x00010000 است. */
const VAZIR_TTF_URL =
  "https://cdn.jsdelivr.net/npm/vazirmatn@33.0.3/fonts/ttf/Vazirmatn-Bold.ttf";

/** آیا این بایت‌ها یک فونتِ TTF/OTFِ معتبرِ قابل‌فهمِ Satori هستند؟ (نه woff/woff2). */
function isTrueTypeOrOpenType(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 4) return false;
  const sig = new Uint32Array(buf.slice(0, 4))[0];
  const b = new Uint8Array(buf.slice(0, 4));
  const tag = String.fromCharCode(b[0], b[1], b[2], b[3]);
  // 0x00010000 (TrueType) | 'OTTO' (CFF/OpenType) | 'true'/'typ1' (Apple).
  return (
    sig === 0x00_01_00_00 || tag === "OTTO" || tag === "true" || tag === "typ1"
  );
}

/**
 * وزیرمتنِ Bold (TTF) را می‌گیرد. هرگز throw نمی‌کند و *هرگز* یک woff2 به Satori نمی‌دهد:
 * در صورتِ خطا یا امضای نامعتبر null می‌دهد تا OG با چیدمانِ لاتین رندر شود (fail-safe).
 */
async function loadVazirmatn(): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(VAZIR_TTF_URL);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return isTrueTypeOrOpenType(buf) ? buf : null;
  } catch {
    return null;
  }
}

/** نشانِ K به‌صورتِ SVGِ درون‌خطی — بَجِ سفید + Kِ گرادیانی (روی زمینه‌ی گرادیانِ برند). */
function MarkSvg({ dim }: { dim: number }) {
  return (
    <svg width={dim} height={dim} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="og-k" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5b3df5" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="56" height="56" rx="18" fill="#ffffff" />
      <path d="M23 15V49" stroke="url(#og-k)" strokeWidth="6.5" strokeLinecap="round" />
      <path
        d="M43.5 15 27.5 32 43.5 49"
        fill="none"
        stroke="url(#og-k)"
        strokeWidth="6.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="45.5" cy="13.5" r="4.6" fill="#06b6d4" />
    </svg>
  );
}

export default async function OpengraphImage() {
  const wordmark = site.name; // «کارجو»
  const font = await loadVazirmatn();
  const hasFa = font !== null;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 40,
          // گرادیانِ برند (هم‌راستا با توکن‌های --brand/--brand-2/--accent).
          background:
            "radial-gradient(1200px 600px at 78% -10%, #06b6d4 0%, transparent 55%), linear-gradient(135deg, #5b3df5 0%, #7c3aed 55%, #8b5cf6 100%)",
          direction: "rtl",
          color: "#ffffff",
          fontFamily: hasFa ? "Vazirmatn" : "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <MarkSvg dim={168} />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 132, fontWeight: 800, lineHeight: 1 }}>
              {hasFa ? wordmark : "Karjoo"}
            </div>
            <div
              style={{
                fontSize: 34,
                fontWeight: 700,
                letterSpacing: 2,
                opacity: 0.9,
                direction: "ltr",
                alignSelf: "flex-end",
              }}
            >
              Karjoo AI
            </div>
          </div>
        </div>
        <div style={{ fontSize: 40, opacity: 0.95, maxWidth: 900, textAlign: "center" }}>
          {hasFa ? site.tagline : "AI-powered job auto-apply for Iran"}
        </div>
      </div>
    ),
    {
      ...size,
      ...(hasFa && font
        ? { fonts: [{ name: "Vazirmatn", data: font, weight: 800, style: "normal" }] }
        : {}),
    },
  );
}
