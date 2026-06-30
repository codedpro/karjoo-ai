/**
 * تست‌های هندلرهای `/api/resume/*` — نشستِ وب، استخراج، AI و سرویسِ DB کاملاً mock.
 *
 * تمرکزِ بحرانی:
 *   • همه‌ی مسیرها بدونِ نشست → ۴۰۱ (gate شده).
 *   • upload: PDF نامعتبر → ۴۰۰ پیش از لمسِ دیسک؛ PDF معتبر → ۲۰۱ + طولِ متن.
 *   • parse: مالکیت (قاعده‌ی ۴) — getResumeFileOwned با userIdِ نشست صدا می‌شود؛ نبودِ
 *     رکورد → ۴۰۴؛ نبودِ متن → ۴۲۲؛ مسیرِ موفق → فیلدها + پروفایل.
 *   • profile: ویرایشِ کاربر روی پروفایلِ خودش ذخیره می‌شود (به نشست مقید).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/http", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/resume/storage", () => ({ saveResumeFile: vi.fn() }));
vi.mock("@/lib/resume/pdf", async () => {
  const actual = await vi.importActual<typeof import("@/lib/resume/pdf")>(
    "@/lib/resume/pdf",
  );
  return { ...actual, extractText: vi.fn() };
});
vi.mock("@/lib/resume/parse", async () => {
  const actual = await vi.importActual<typeof import("@/lib/resume/parse")>(
    "@/lib/resume/parse",
  );
  return { ...actual, parseResumeText: vi.fn() };
});
// مسیرِ تولید اکنون از نسخه‌ی *مترشده* استفاده می‌کند (بیلینگ مقید به کاربر)؛ همان را
// mock می‌کنیم تا تستِ روت بدونِ کیف‌پول/گیت‌وی اجرا شود (همان شکلِ ParsedResume برمی‌گرداند).
vi.mock("@/lib/resume/metered-parse", () => ({
  meteredParseResumeText: vi.fn(),
}));
vi.mock("@/lib/resume/service", () => ({
  createResumeFileRecord: vi.fn(),
  getResumeFileOwned: vi.fn(),
  persistParsedFields: vi.fn(),
  saveProfileFields: vi.fn(),
}));

import { getCurrentUser } from "@/lib/auth/http";
import { extractText } from "@/lib/resume/pdf";
import { meteredParseResumeText } from "@/lib/resume/metered-parse";
import { saveResumeFile } from "@/lib/resume/storage";
import {
  createResumeFileRecord,
  getResumeFileOwned,
  persistParsedFields,
  saveProfileFields,
} from "@/lib/resume/service";

import { POST as uploadPOST } from "@/app/api/resume/upload/route";
import { POST as parsePOST } from "@/app/api/resume/parse/route";
import { PATCH as profilePATCH } from "@/app/api/resume/profile/route";

const getCurrentUserMock = vi.mocked(getCurrentUser);
const extractTextMock = vi.mocked(extractText);
const parseResumeTextMock = vi.mocked(meteredParseResumeText);
const saveResumeFileMock = vi.mocked(saveResumeFile);
const createRecordMock = vi.mocked(createResumeFileRecord);
const getOwnedMock = vi.mocked(getResumeFileOwned);
const persistMock = vi.mocked(persistParsedFields);
const saveProfileMock = vi.mocked(saveProfileFields);

const USER = { id: "user-1", phone: "0912", isActive: true } as never;

/** یک «PDF» معتبرِ مینیمال (امضای %PDF + padding). */
function fakePdfBytes(): Uint8Array {
  const head = new TextEncoder().encode("%PDF-1.7\n");
  const pad = new Uint8Array(300).fill(0x20);
  const out = new Uint8Array(head.length + pad.length);
  out.set(head, 0);
  out.set(pad, head.length);
  return out;
}

function uploadJsonReq(body: unknown) {
  return new Request("https://k.app/api/resume/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function jsonReq(url: string, method: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

/* ────────────────────────────── upload ────────────────────────────── */

describe("POST /api/resume/upload", () => {
  it("بدونِ نشست → ۴۰۱", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    const res = await uploadPOST(uploadJsonReq({ data: "x" }));
    expect(res.status).toBe(401);
    expect(saveResumeFileMock).not.toHaveBeenCalled();
  });

  it("PDF نامعتبر (base64 غیر-PDF) → ۴۰۰ و دیسک لمس نمی‌شود", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    const notPdf = Buffer.from("just some text, not a pdf at all".repeat(10)).toString(
      "base64",
    );
    const res = await uploadPOST(uploadJsonReq({ data: notPdf }));
    expect(res.status).toBe(400);
    expect(saveResumeFileMock).not.toHaveBeenCalled();
    expect(createRecordMock).not.toHaveBeenCalled();
  });

  it("PDF معتبر → ذخیره، استخراجِ متن، رکورد و ۲۰۱ با طولِ متن", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    saveResumeFileMock.mockResolvedValue({
      relativePath: "user-1/abc.pdf",
      absolutePath: "/uploads/user-1/abc.pdf",
    });
    extractTextMock.mockResolvedValue({ text: "متنِ رزومه استخراج‌شده", pageCount: 1 });
    createRecordMock.mockResolvedValue({
      id: "rf-1",
      fileName: "resume.pdf",
      byteSize: 309,
      createdAt: new Date("2026-06-30"),
    } as never);

    const b64 = Buffer.from(fakePdfBytes()).toString("base64");
    const res = await uploadPOST(uploadJsonReq({ fileName: "resume.pdf", data: b64 }));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.resumeFile.id).toBe("rf-1");
    expect(body.resumeFile.hasText).toBe(true);
    expect(body.extractedTextLength).toBe("متنِ رزومه استخراج‌شده".length);

    // userId به نشست مقید است (نه از بدنه).
    expect(saveResumeFileMock.mock.calls[0][0]).toBe("user-1");
    expect(createRecordMock.mock.calls[0][0]).toBe("user-1");
  });

  it("شکستِ استخراجِ متن فایل را باطل نمی‌کند (رکورد بدونِ متن، ۲۰۱)", async () => {
    const { PdfExtractError } = await vi.importActual<
      typeof import("@/lib/resume/pdf")
    >("@/lib/resume/pdf");
    getCurrentUserMock.mockResolvedValue(USER);
    saveResumeFileMock.mockResolvedValue({
      relativePath: "user-1/abc.pdf",
      absolutePath: "/uploads/user-1/abc.pdf",
    });
    extractTextMock.mockRejectedValue(new PdfExtractError("خراب"));
    createRecordMock.mockResolvedValue({
      id: "rf-2",
      fileName: "resume.pdf",
      byteSize: 309,
      createdAt: new Date("2026-06-30"),
    } as never);

    const b64 = Buffer.from(fakePdfBytes()).toString("base64");
    const res = await uploadPOST(uploadJsonReq({ data: b64 }));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.resumeFile.hasText).toBe(false);
    expect(body.extractedTextLength).toBe(0);
    // extractedText=null به رکورد رفته.
    expect(createRecordMock.mock.calls[0][1].extractedText).toBeNull();
  });
});

/* ────────────────────────────── parse ────────────────────────────── */

describe("POST /api/resume/parse", () => {
  const ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

  it("بدونِ نشست → ۴۰۱", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    const res = await parsePOST(jsonReq("https://k.app/api/resume/parse", "POST", { resumeFileId: ID }));
    expect(res.status).toBe(401);
  });

  it("رکوردِ متعلق به کاربرِ دیگر/ناموجود → ۴۰۴ (قاعده‌ی ۴)", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    getOwnedMock.mockResolvedValue(null);
    const res = await parsePOST(
      jsonReq("https://k.app/api/resume/parse", "POST", { resumeFileId: ID }),
    );
    expect(res.status).toBe(404);
    // مالکیت با userIdِ نشست بررسی شده.
    expect(getOwnedMock).toHaveBeenCalledWith("user-1", ID);
    expect(parseResumeTextMock).not.toHaveBeenCalled();
  });

  it("رکورد بدونِ متنِ استخراج‌شده → ۴۲۲", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    getOwnedMock.mockResolvedValue({ id: ID, extractedText: null } as never);
    const res = await parsePOST(
      jsonReq("https://k.app/api/resume/parse", "POST", { resumeFileId: ID }),
    );
    expect(res.status).toBe(422);
    expect(parseResumeTextMock).not.toHaveBeenCalled();
  });

  it("مسیرِ موفق → فیلدهای AI + پروفایلِ به‌روز", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    getOwnedMock.mockResolvedValue({
      id: ID,
      extractedText: "متنِ رزومه",
    } as never);
    parseResumeTextMock.mockResolvedValue({
      fullName: "سارا احمدی",
      skills: ["React"],
      experience: [],
      education: [],
    } as never);
    persistMock.mockResolvedValue({
      profile: {
        fullName: "سارا احمدی",
        headline: null,
        city: "تهران",
        yearsExperience: 4,
        skills: ["React"],
      },
    } as never);

    const res = await parsePOST(
      jsonReq("https://k.app/api/resume/parse", "POST", { resumeFileId: ID }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.parsed.fullName).toBe("سارا احمدی");
    expect(body.profile.city).toBe("تهران");
    expect(body.profile.skills).toEqual(["React"]);
    // ذخیره به نشست مقید است (userId اول، resumeFileId دوم).
    expect(persistMock.mock.calls[0][0]).toBe("user-1");
    expect(persistMock.mock.calls[0][1]).toBe(ID);
  });

  it("resumeFileId غیر-UUID → ۴۰۰", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    const res = await parsePOST(
      jsonReq("https://k.app/api/resume/parse", "POST", { resumeFileId: "not-a-uuid" }),
    );
    expect(res.status).toBe(400);
  });
});

/* ────────────────────────────── profile (ویرایش/ذخیره) ────────────────────────────── */

describe("PATCH /api/resume/profile", () => {
  it("بدونِ نشست → ۴۰۱", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    const res = await profilePATCH(
      jsonReq("https://k.app/api/resume/profile", "PATCH", { fullName: "x" }),
    );
    expect(res.status).toBe(401);
  });

  it("فیلدهای ویرایش‌شده‌ی کاربر را روی پروفایلِ خودش ذخیره می‌کند", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    saveProfileMock.mockResolvedValue({
      fullName: "سارا احمدی",
      headline: "فرانت‌اند",
      city: "تهران",
      yearsExperience: 5,
      skills: ["React", "TypeScript"],
    } as never);

    const res = await profilePATCH(
      jsonReq("https://k.app/api/resume/profile", "PATCH", {
        fullName: "سارا احمدی",
        headline: "فرانت‌اند",
        city: "تهران",
        yearsExperience: 5,
        skills: ["React", "TypeScript"],
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profile.fullName).toBe("سارا احمدی");
    // به نشست مقید.
    expect(saveProfileMock.mock.calls[0][0]).toBe("user-1");
  });

  it("نامِ خالی → ۴۰۰ (اعتبارسنجی)", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    const res = await profilePATCH(
      jsonReq("https://k.app/api/resume/profile", "PATCH", { fullName: "  " }),
    );
    expect(res.status).toBe(400);
    expect(saveProfileMock).not.toHaveBeenCalled();
  });
});
