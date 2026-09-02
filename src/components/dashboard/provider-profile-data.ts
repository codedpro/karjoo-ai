import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { boardAccounts, boardProfileSnapshots } from "@/db/schema";
import { readApplyFilters, type ActiveApplyBoard } from "@/lib/apply/filters";

export const PROFILE_PROVIDER_IDS = [
  "jobinja",
  "jobvision",
  "e-estekhdam",
  "irantalent",
  "karboom",
] as const satisfies readonly ActiveApplyBoard[];

export type ProfileProviderId = (typeof PROFILE_PROVIDER_IDS)[number];

const PROFILE_URLS: Record<ProfileProviderId, string> = {
  jobinja: "https://jobinja.ir/app/cv-builder",
  jobvision: "https://jobvision.ir/resume",
  "e-estekhdam": "https://www.e-estekhdam.com/karfarmas/profile",
  irantalent: "https://www.irantalent.com/candidate/cv/edit",
  karboom: "https://karboom.io/profile",
};

export interface ProviderProfileView {
  board: ProfileProviderId;
  status: "connected" | "needs_reauth" | "disconnected";
  accountLabel: string | null;
  lastConnectedAt: Date | null;
  profileUrl: string;
  snapshot: {
    fullName: string | null;
    headline: string | null;
    city: string | null;
    yearsExperience: number | null;
    skills: string[];
    experienceCount: number;
    fetchedAt: Date;
    publicUrl: string | null;
  } | null;
  targeting: {
    enabled: boolean;
    categoryCount: number;
    employmentTypeCount: number;
    remoteOnly: boolean;
    cities: string[];
  };
}

type SnapshotRow = {
  data: Record<string, unknown>;
  publicUrl: string | null;
  fetchedAt: Date;
};

function cleanText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstText(data: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = cleanText(data[key]);
    if (value) return value;
  }
  return null;
}

function skills(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const name = typeof item === "string"
      ? item.trim()
      : cleanText((item as Record<string, unknown> | null)?.name);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
    if (out.length >= 12) break;
  }
  return out;
}

function finiteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function normalizeProviderSnapshot(raw: SnapshotRow | undefined): ProviderProfileView["snapshot"] {
  if (!raw) return null;
  const data = raw.data ?? {};
  const experience = Array.isArray(data.experience)
    ? data.experience
    : Array.isArray(data.workExperience)
      ? data.workExperience
      : [];
  return {
    fullName: firstText(data, ["fullName", "full_name", "name"]),
    headline: firstText(data, ["headline", "jobTitle", "title"]),
    city: firstText(data, ["city", "location"]),
    yearsExperience: finiteNumber(data.yearsExperience),
    skills: skills(data.skills),
    experienceCount: experience.length,
    fetchedAt: raw.fetchedAt,
    publicUrl: raw.publicUrl,
  };
}

export async function getProviderProfiles(userId: string): Promise<ProviderProfileView[]> {
  const [accounts, snapshots, filters] = await Promise.all([
    db
      .select({
        board: boardAccounts.board,
        status: boardAccounts.status,
        accountLabel: boardAccounts.accountLabel,
        lastConnectedAt: boardAccounts.lastConnectedAt,
      })
      .from(boardAccounts)
      .where(eq(boardAccounts.userId, userId)),
    db
      .select({
        board: boardProfileSnapshots.board,
        data: boardProfileSnapshots.data,
        publicUrl: boardProfileSnapshots.publicUrl,
        fetchedAt: boardProfileSnapshots.fetchedAt,
      })
      .from(boardProfileSnapshots)
      .where(eq(boardProfileSnapshots.userId, userId)),
    readApplyFilters(userId),
  ]);

  const accountByBoard = new Map(accounts.map((account) => [account.board, account]));
  const snapshotByBoard = new Map(snapshots.map((snapshot) => [snapshot.board, snapshot]));

  return PROFILE_PROVIDER_IDS.map((board) => {
    const account = accountByBoard.get(board);
    const rawSnapshot = snapshotByBoard.get(board);
    const filter = filters.boardFilters[board];
    return {
      board,
      status: account?.status === "connected"
        ? "connected"
        : account
          ? "needs_reauth"
          : "disconnected",
      accountLabel: account?.accountLabel ?? null,
      lastConnectedAt: account?.lastConnectedAt ?? null,
      profileUrl: PROFILE_URLS[board],
      snapshot: normalizeProviderSnapshot(rawSnapshot),
      targeting: {
        enabled: filter.enabled,
        categoryCount: filter.categoryKeys.length,
        employmentTypeCount: filter.employmentTypeKeys.length,
        remoteOnly: filter.remoteOnly,
        cities: filter.cities,
      },
    };
  });
}
