import "server-only";

/**
 * داده‌ی پنلِ «ورودِ خودکار» (server-only).
 *
 * فقط وضعیتِ نمایشی برمی‌گرداند: کدام سایت‌ها ورودِ خودکار دارند، کدام‌ها را کاربر متصل
 * کرده، و اعتبارنامه‌ی ذخیره‌شده در چه حالی است. هرگز رمز — حتی رمزشده — از این مرز
 * عبور نمی‌کند.
 */
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { boardAccounts } from "@/db/schema";
import { boardsWithCredentialLogin } from "@/lib/apply/login/session-provider";
import { listCredentialStatuses } from "@/lib/vault/credential-store";
import { isVaultReady } from "@/lib/vault/crypto";

export async function readCredentialPanelData(userId: string) {
  const [credentials, accounts] = await Promise.all([
    isVaultReady() ? listCredentialStatuses(userId) : Promise.resolve([]),
    db
      .select({ board: boardAccounts.board, status: boardAccounts.status })
      .from(boardAccounts)
      .where(eq(boardAccounts.userId, userId)),
  ]);
  return {
    vaultReady: isVaultReady(),
    supportedBoards: boardsWithCredentialLogin() as string[],
    connectedBoards: accounts.filter((a) => a.status === "connected").map((a) => a.board as string),
    credentials,
  };
}
