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
}));
// مسیرِ ذخیره/فایلِ پروفایل اکنون از profile-service (Track C) استفاده می‌کند.
vi.mock("@/lib/resume/profile-service", () => ({
  saveFullProfile: vi.fn(),
  setPrimaryResumeFile: vi.fn(),
  deleteResumeFile: vi.fn(),
  getResumeFileForDownload: vi.fn(),
}));
vi.mock("@/lib/resume/storage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/resume/storage")>(
    "@/lib/resume/storage",
  );
  return {
    ...actual,
    saveResumeFile: vi.fn(),
    readResumeFile: vi.fn(),
    deleteStoredResumeFile: vi.fn(),
  };
});

import { getCurrentUser } from "@/lib/auth/http";
import { extractText } from "@/lib/resume/pdf";
import { meteredParseResumeText } from "@/lib/resume/metered-parse";
import {
  saveResumeFile,
  readResumeFile,
  deleteStoredResumeFile,
} from "@/lib/resume/storage";
import {
  createResumeFileRecord,
  getResumeFileOwned,
  persistParsedFields,
} from "@/lib/resume/service";
import {
  saveFullProfile,
  setPrimaryResumeFile,
  deleteResumeFile,
  getResumeFileForDownload,
} from "@/lib/resume/profile-service";

import { POST as uploadPOST } from "@/app/api/resume/upload/route";
import { POST as parsePOST } from "@/app/api/resume/parse/route";
import { PATCH as profilePATCH } from "@/app/api/resume/profile/route";
import { POST as primaryPOST } from "@/app/api/resume/primary/route";
import { DELETE as fileDELETE } from "@/app/api/resume/file/route";
import { GET as downloadGET } from "@/app/api/resume/download/route";

const getCurrentUserMock = vi.mocked(getCurrentUser);
const extractTextMock = vi.mocked(extractText);
const parseResumeTextMock = vi.mocked(meteredParseResumeText);
const saveResumeFileMock = vi.mocked(saveResumeFile);
const readResumeFileMock = vi.mocked(readResumeFile);
const deleteStoredMock = vi.mocked(deleteStoredResumeFile);
const createRecordMock = vi.mocked(createResumeFileRecord);
const getOwnedMock = vi.mocked(getResumeFileOwned);
const persistMock = vi.mocked(persistParsedFields);
const saveFullProfileMock = vi.mocked(saveFullProfile);
const setPrimaryMock = vi.mocked(setPrimaryResumeFile);
const deleteFileMock = vi.mocked(deleteResumeFile);
const getForDownloadMock = vi.mocked(getResumeFileForDownload);

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
        summary: null,
        city: "تهران",
        phone: null,
        avatarUrl: null,
        expectedSalary: null,
        yearsExperience: 4,
        skills: ["React"],
        workExperience: [],
        education: [],
        languages: [],
        links: [],
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
    // پروفایلِ کامل برمی‌گردد (آرایه‌های خالی هم حاضرند).
    expect(body.profile.workExperience).toEqual([]);
    expect(body.profile.languages).toEqual([]);
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

  it("حالتِ نگه‌داریِ هوش مصنوعی (AiMaintenanceError مستقیم) → ۵۰۳ + code=ai_maintenance", async () => {
    const { AiMaintenanceError } = await import("@/lib/billing/errors");
    getCurrentUserMock.mockResolvedValue(USER);
    getOwnedMock.mockResolvedValue({ id: ID, extractedText: "متنِ رزومه" } as never);
    parseResumeTextMock.mockRejectedValue(new AiMaintenanceError({ manual: false }));

    const res = await parsePOST(
      jsonReq("https://k.app/api/resume/parse", "POST", { resumeFileId: ID }),
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("ai_maintenance");
    expect(body.reason).toBe("cap");
    expect(body.error).toContain("سرویس هوش مصنوعی");
    expect(persistMock).not.toHaveBeenCalled();
  });

  it("نگه‌داریِ پیچیده‌شده در ResumeParseError → همچنان ۵۰۳ با reason='manual'", async () => {
    const { AiMaintenanceError } = await import("@/lib/billing/errors");
    const { ResumeParseError } = await import("@/lib/resume/parse");
    getCurrentUserMock.mockResolvedValue(USER);
    getOwnedMock.mockResolvedValue({ id: ID, extractedText: "متنِ رزومه" } as never);
    // metered-parse خطاهای ناشناخته را در ResumeParseError می‌پیچد؛ نوعِ نگه‌داری نباید گم شود.
    parseResumeTextMock.mockRejectedValue(
      new ResumeParseError("wrapped", new AiMaintenanceError({ manual: true })),
    );

    const res = await parsePOST(
      jsonReq("https://k.app/api/resume/parse", "POST", { resumeFileId: ID }),
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("ai_maintenance");
    expect(body.reason).toBe("manual");
  });
});

/* ────────────────────────────── profile (ویرایش/ذخیره) ────────────────────────────── */

describe("PATCH /api/resume/profile", () => {
  const fullProfileRow = {
    fullName: "سارا احمدی",
    headline: "فرانت‌اند",
    summary: "خلاصه",
    city: "تهران",
    phone: "0912",
    avatarUrl: null,
    expectedSalary: "توافقی",
    yearsExperience: 5,
    skills: ["React", "TypeScript"],
    workExperience: [{ company: "شرکتِ الف", title: "توسعه‌دهنده" }],
    education: [{ institution: "دانشگاهِ ب", degree: "کارشناسی" }],
    languages: [{ name: "انگلیسی", level: "مسلط" }],
    links: [{ url: "https://example.com", label: "سایت" }],
  };

  it("بدونِ نشست → ۴۰۱", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    const res = await profilePATCH(
      jsonReq("https://k.app/api/resume/profile", "PATCH", { fullName: "x" }),
    );
    expect(res.status).toBe(401);
  });

  it("همه‌ی فیلدهای پروفایلِ جامعِ ویرایش‌شده را روی پروفایلِ خودِ کاربر ذخیره می‌کند", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    saveFullProfileMock.mockResolvedValue(fullProfileRow as never);

    const res = await profilePATCH(
      jsonReq("https://k.app/api/resume/profile", "PATCH", {
        fullName: "سارا احمدی",
        headline: "فرانت‌اند",
        summary: "خلاصه",
        city: "تهران",
        phone: "0912",
        expectedSalary: "توافقی",
        yearsExperience: 5,
        skills: ["React", "TypeScript"],
        workExperience: [{ company: "شرکتِ الف", title: "توسعه‌دهنده" }],
        education: [{ institution: "دانشگاهِ ب", degree: "کارشناسی" }],
        languages: [{ name: "انگلیسی", level: "مسلط" }],
        links: [{ url: "https://example.com", label: "سایت" }],
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profile.fullName).toBe("سارا احمدی");
    expect(body.profile.summary).toBe("خلاصه");
    expect(body.profile.workExperience).toEqual([
      { company: "شرکتِ الف", title: "توسعه‌دهنده" },
    ]);
    expect(body.profile.languages).toEqual([{ name: "انگلیسی", level: "مسلط" }]);
    // به نشست مقید (userId اول).
    expect(saveFullProfileMock.mock.calls[0][0]).toBe("user-1");
    // آرایه‌ها به سرویس رسیده‌اند.
    expect(saveFullProfileMock.mock.calls[0][1].education).toEqual([
      { institution: "دانشگاهِ ب", degree: "کارشناسی" },
    ]);
  });

  it("نامِ خالی → ۴۰۰ (اعتبارسنجی)", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    const res = await profilePATCH(
      jsonReq("https://k.app/api/resume/profile", "PATCH", { fullName: "  " }),
    );
    expect(res.status).toBe(400);
    expect(saveFullProfileMock).not.toHaveBeenCalled();
  });

  it("زبانِ بی‌نام (name خالی) → ۴۰۰ (اعتبارسنجی آرایه)", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    const res = await profilePATCH(
      jsonReq("https://k.app/api/resume/profile", "PATCH", {
        fullName: "سارا",
        languages: [{ name: "" }],
      }),
    );
    expect(res.status).toBe(400);
    expect(saveFullProfileMock).not.toHaveBeenCalled();
  });
});

/* ────────────────────────────── primary (رزومه‌ی اصلی — رایگان) ────────────────────────────── */

describe("POST /api/resume/primary", () => {
  const ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

  it("بدونِ نشست → ۴۰۱", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    const res = await primaryPOST(
      jsonReq("https://k.app/api/resume/primary", "POST", { resumeFileId: ID }),
    );
    expect(res.status).toBe(401);
    expect(setPrimaryMock).not.toHaveBeenCalled();
  });

  it("فایلِ خودِ کاربر را اصلی می‌کند (به نشست مقید)", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    setPrimaryMock.mockResolvedValue(true);
    const res = await primaryPOST(
      jsonReq("https://k.app/api/resume/primary", "POST", { resumeFileId: ID }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(setPrimaryMock).toHaveBeenCalledWith("user-1", ID);
  });

  it("فایلِ ناموجود/متعلق به دیگری → ۴۰۴", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    setPrimaryMock.mockResolvedValue(false);
    const res = await primaryPOST(
      jsonReq("https://k.app/api/resume/primary", "POST", { resumeFileId: ID }),
    );
    expect(res.status).toBe(404);
  });

  it("id غیر-UUID → ۴۰۰", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    const res = await primaryPOST(
      jsonReq("https://k.app/api/resume/primary", "POST", { resumeFileId: "nope" }),
    );
    expect(res.status).toBe(400);
    expect(setPrimaryMock).not.toHaveBeenCalled();
  });
});

/* ────────────────────────────── file DELETE ────────────────────────────── */

describe("DELETE /api/resume/file", () => {
  const ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

  it("بدونِ نشست → ۴۰۱", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    const res = await fileDELETE(
      jsonReq("https://k.app/api/resume/file", "DELETE", { resumeFileId: ID }),
    );
    expect(res.status).toBe(401);
    expect(deleteFileMock).not.toHaveBeenCalled();
  });

  it("رکورد + فایلِ دیسک را حذف می‌کند (به نشست مقید)", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    deleteFileMock.mockResolvedValue({ deleted: true, storagePath: "user-1/x.pdf" });
    deleteStoredMock.mockResolvedValue(undefined);

    const res = await fileDELETE(
      jsonReq("https://k.app/api/resume/file", "DELETE", { resumeFileId: ID }),
    );
    expect(res.status).toBe(200);
    expect(deleteFileMock).toHaveBeenCalledWith("user-1", ID);
    expect(deleteStoredMock).toHaveBeenCalledWith("user-1/x.pdf");
  });

  it("فایلِ ناموجود → ۴۰۴ و دیسک لمس نمی‌شود", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    deleteFileMock.mockResolvedValue({ deleted: false, storagePath: null });
    const res = await fileDELETE(
      jsonReq("https://k.app/api/resume/file", "DELETE", { resumeFileId: ID }),
    );
    expect(res.status).toBe(404);
    expect(deleteStoredMock).not.toHaveBeenCalled();
  });

  it("شکستِ حذفِ دیسک موفقیتِ حذفِ رکورد را باطل نمی‌کند (۲۰۰)", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    deleteFileMock.mockResolvedValue({ deleted: true, storagePath: "user-1/x.pdf" });
    deleteStoredMock.mockRejectedValue(new Error("disk gone"));
    const res = await fileDELETE(
      jsonReq("https://k.app/api/resume/file", "DELETE", { resumeFileId: ID }),
    );
    expect(res.status).toBe(200);
  });
});

/* ────────────────────────────── download ────────────────────────────── */

describe("GET /api/resume/download", () => {
  const ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

  it("بدونِ نشست → ۴۰۱", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    const res = await downloadGET(
      new Request(`https://k.app/api/resume/download?id=${ID}`),
    );
    expect(res.status).toBe(401);
  });

  it("id غیر-UUID → ۴۰۰", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    const res = await downloadGET(
      new Request("https://k.app/api/resume/download?id=nope"),
    );
    expect(res.status).toBe(400);
    expect(getForDownloadMock).not.toHaveBeenCalled();
  });

  it("فایلِ ناموجود/متعلق به دیگری → ۴۰۴", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    getForDownloadMock.mockResolvedValue(null);
    const res = await downloadGET(
      new Request(`https://k.app/api/resume/download?id=${ID}`),
    );
    expect(res.status).toBe(404);
    expect(getForDownloadMock).toHaveBeenCalledWith("user-1", ID);
  });

  it("مسیرِ موفق → بایت‌های PDF با هدرِ دانلود", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    getForDownloadMock.mockResolvedValue({
      storagePath: "user-1/x.pdf",
      fileName: "رزومه.pdf",
      mimeType: "application/pdf",
      byteSize: 4,
    });
    readResumeFileMock.mockResolvedValue(Buffer.from("%PDF"));

    const res = await downloadGET(
      new Request(`https://k.app/api/resume/download?id=${ID}`),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    // نامِ یونیکد در filename* کدگذاری شده.
    expect(res.headers.get("content-disposition")).toContain("filename*=UTF-8''");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.toString()).toBe("%PDF");
  });
});
