/**
 * تست دودی (smoke) اسکیما — بدون شبکه و بدون دیتابیس زنده.
 *
 * صرفاً وجود جدول‌ها/enumها و چند ستون کلیدی را وارسی می‌کند تا اگر کسی ناخواسته
 * بخشی از مدل داده را حذف کرد، همین‌جا شکست بخورد. خود اسکیما هیچ اتصالی باز نمی‌کند.
 */
import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";

import {
  aiModelCatalog,
  aiProviderEnum,
  applications,
  applyTypeEnum,
  auditEvents,
  boardAccounts,
  candidateProfiles,
  jobBoardEnum,
  jobCategories,
  jobListings,
  ledgerKindEnum,
  matches,
  planEnum,
  profileImportStatusEnum,
  profileImports,
  rawListings,
  resumeFiles,
  resumeSourceEnum,
  resumes,
  sessionBlobs,
  sessionShapeEnum,
  taskStatusEnum,
  tasks,
  usageKindEnum,
  usageRecords,
  userAiSettings,
  userInterests,
  users,
  wallets,
  walletLedger,
  workerNodes,
} from "@/db/schema";

describe("schema داربست کارجو", () => {
  it("همه‌ی جدول‌های مدل داده (بخش ۵ معماری) را صادر می‌کند", () => {
    // جفت (نام موردانتظار در DB، شیء جدول) — همه‌ی ۱۲ جدول بخش ۵ معماری.
    const tablesByName: Record<string, ReturnType<typeof getTableName>> = {
      users: getTableName(users),
      candidate_profiles: getTableName(candidateProfiles),
      resumes: getTableName(resumes),
      board_accounts: getTableName(boardAccounts),
      session_blobs: getTableName(sessionBlobs),
      job_listings: getTableName(jobListings),
      raw_listings: getTableName(rawListings),
      matches: getTableName(matches),
      applications: getTableName(applications),
      worker_nodes: getTableName(workerNodes),
      tasks: getTableName(tasks),
      audit_events: getTableName(auditEvents),
    };
    for (const [expected, actual] of Object.entries(tablesByName)) {
      expect(actual, `نام جدول ${expected} باید درست باشد`).toBe(expected);
    }
  });

  it("جدول‌های WF1 (پروفایل‌سازی و ایمپورت) را صادر می‌کند", () => {
    const wf1: Record<string, ReturnType<typeof getTableName>> = {
      resume_files: getTableName(resumeFiles),
      job_categories: getTableName(jobCategories),
      user_interests: getTableName(userInterests),
      profile_imports: getTableName(profileImports),
    };
    for (const [expected, actual] of Object.entries(wf1)) {
      expect(actual, `نام جدول ${expected} باید درست باشد`).toBe(expected);
    }
  });

  it("enumهای وضعیت با مقادیر درست تعریف شده‌اند", () => {
    expect(applyTypeEnum.enumValues).toEqual(["structured", "contact"]);
    expect(sessionShapeEnum.enumValues).toEqual(["cookie", "token"]);
    expect(taskStatusEnum.enumValues).toContain("pending");
    expect(taskStatusEnum.enumValues).toContain("leased");
    // enumهای تازه‌ی WF1.
    expect(resumeSourceEnum.enumValues).toEqual(["upload", "board_import"]);
    expect(profileImportStatusEnum.enumValues).toEqual([
      "received",
      "applied",
      "failed",
    ]);
    // irantalent به enumِ سایت‌ها افزوده شده.
    expect(jobBoardEnum.enumValues).toContain("irantalent");
  });

  it("صف (tasks) ستون idempotency_key دارد (یکتایی dedupe)", () => {
    expect(tasks.idempotencyKey).toBeDefined();
    expect(tasks.runAfter).toBeDefined();
    expect(tasks.attempts).toBeDefined();
  });

  it("جدول‌های بیلینگ/مترینگ (کیف‌پول) را صادر می‌کند", () => {
    const billing: Record<string, ReturnType<typeof getTableName>> = {
      ai_model_catalog: getTableName(aiModelCatalog),
      user_ai_settings: getTableName(userAiSettings),
      wallets: getTableName(wallets),
      wallet_ledger: getTableName(walletLedger),
      usage_records: getTableName(usageRecords),
    };
    for (const [expected, actual] of Object.entries(billing)) {
      expect(actual, `نام جدول ${expected} باید درست باشد`).toBe(expected);
    }
  });

  it("enumهای بیلینگ با مقادیر درست تعریف شده‌اند", () => {
    expect(aiProviderEnum.enumValues).toEqual(["openai", "anthropic", "google"]);
    expect(planEnum.enumValues).toEqual(["free", "payg", "premium"]);
    expect(ledgerKindEnum.enumValues).toEqual(["topup", "charge", "refund", "grant"]);
    expect(usageKindEnum.enumValues).toEqual(["match", "cover_letter", "resume_parse"]);
    // users.plan افزوده شده (پیش‌فرض payg).
    expect(users.plan).toBeDefined();
  });
});
