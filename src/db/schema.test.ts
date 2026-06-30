/**
 * تست دودی (smoke) اسکیما — بدون شبکه و بدون دیتابیس زنده.
 *
 * صرفاً وجود جدول‌ها/enumها و چند ستون کلیدی را وارسی می‌کند تا اگر کسی ناخواسته
 * بخشی از مدل داده را حذف کرد، همین‌جا شکست بخورد. خود اسکیما هیچ اتصالی باز نمی‌کند.
 */
import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";

import {
  applications,
  applyTypeEnum,
  auditEvents,
  boardAccounts,
  candidateProfiles,
  jobListings,
  matches,
  rawListings,
  resumes,
  sessionBlobs,
  sessionShapeEnum,
  taskStatusEnum,
  tasks,
  users,
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

  it("enumهای وضعیت با مقادیر درست تعریف شده‌اند", () => {
    expect(applyTypeEnum.enumValues).toEqual(["structured", "contact"]);
    expect(sessionShapeEnum.enumValues).toEqual(["cookie", "token"]);
    expect(taskStatusEnum.enumValues).toContain("pending");
    expect(taskStatusEnum.enumValues).toContain("leased");
  });

  it("صف (tasks) ستون idempotency_key دارد (یکتایی dedupe)", () => {
    expect(tasks.idempotencyKey).toBeDefined();
    expect(tasks.runAfter).toBeDefined();
    expect(tasks.attempts).toBeDefined();
  });
});
