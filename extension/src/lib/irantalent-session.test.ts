/**
 * IranTalent identity-probe tests. The probe must answer with a boolean, a
 * non-secret label, and a bounded reason — and must never hand the token back.
 */
import { describe, it, expect, vi } from "vitest";

import {
  accountLabelFromProfile,
  authorizationFromEnvelope,
  probeIranTalentIdentity,
} from "@ext/lib/irantalent-session";

const envelope = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({ token_type: "Bearer", access_token: "SECRET", token_user: "candidate", ...overrides });

describe("authorizationFromEnvelope", () => {
  it("rebuilds the header from the site's own stored envelope", () => {
    expect(authorizationFromEnvelope(envelope())).toBe("Bearer SECRET");
    expect(authorizationFromEnvelope(encodeURIComponent(envelope()))).toBe("Bearer SECRET");
  });

  it("treats an expired envelope as signed out", () => {
    const expired = envelope({ created_at: Date.now() - 10_000, expires_in: 1 });
    expect(authorizationFromEnvelope(expired)).toBeNull();
  });

  it("accepts an envelope that is still inside its lifetime", () => {
    const live = envelope({ created_at: Date.now(), expires_in: 3600 });
    expect(authorizationFromEnvelope(live)).toBe("Bearer SECRET");
  });

  it("returns null for missing, malformed, or incomplete values", () => {
    expect(authorizationFromEnvelope(null)).toBeNull();
    expect(authorizationFromEnvelope("")).toBeNull();
    expect(authorizationFromEnvelope("not-json")).toBeNull();
    expect(authorizationFromEnvelope(JSON.stringify({ access_token: "x" }))).toBeNull();
  });
});

describe("accountLabelFromProfile", () => {
  it("prefers the display name, then the email", () => {
    expect(accountLabelFromProfile({ user: { first_name: "سارا", surname: "کریمی" } })).toBe("سارا کریمی");
    expect(accountLabelFromProfile({ data: { user: { email: "a@b.c" } } })).toBe("a@b.c");
  });
  it("returns undefined when the payload carries no label", () => {
    expect(accountLabelFromProfile({})).toBeUndefined();
    expect(accountLabelFromProfile(null)).toBeUndefined();
  });
});

describe("probeIranTalentIdentity", () => {
  const ok = (body: unknown) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

  it("confirms a live session and surfaces only a non-secret label", async () => {
    const result = await probeIranTalentIdentity(
      ok({ id: 5, user: { first_name: "سارا", surname: "کریمی" } }),
      async () => "Bearer SECRET",
    );
    expect(result).toEqual({ loggedIn: true, accountLabelHint: "سارا کریمی" });
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });

  it("reports logged_out without calling the API when no token exists", async () => {
    const fetchMock = vi.fn();
    const result = await probeIranTalentIdentity(fetchMock as unknown as typeof fetch, async () => null);
    expect(result).toEqual({ loggedIn: false, reason: "logged_out" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("classifies the board's own rejections", async () => {
    const status = (code: number) =>
      vi.fn(async () => new Response("{}", { status: code })) as unknown as typeof fetch;
    const auth = async () => "Bearer SECRET";
    expect(await probeIranTalentIdentity(status(401), auth)).toEqual({ loggedIn: false, reason: "logged_out" });
    expect(await probeIranTalentIdentity(status(429), auth)).toEqual({ loggedIn: false, reason: "security_challenge" });
    expect(await probeIranTalentIdentity(status(500), auth)).toEqual({ loggedIn: false, reason: "probe_unavailable" });
  });

  it("reports probe_unavailable rather than guessing when the network fails", async () => {
    const failing = vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect(await probeIranTalentIdentity(failing, async () => "Bearer SECRET")).toEqual({
      loggedIn: false,
      reason: "probe_unavailable",
    });
  });

  it("is idempotent — repeated probes give the same answer and never mutate state", async () => {
    const impl = ok({ user: { first_name: "سارا" } });
    const first = await probeIranTalentIdentity(impl, async () => "Bearer SECRET");
    const second = await probeIranTalentIdentity(impl, async () => "Bearer SECRET");
    expect(second).toEqual(first);
  });
});
