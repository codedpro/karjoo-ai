import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/http", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/resume/settings", () => ({
  readResumeSettings: vi.fn(),
  writeResumeSettings: vi.fn(),
}));

import { getCurrentUser } from "@/lib/auth/http";
import { readResumeSettings, writeResumeSettings } from "@/lib/resume/settings";
import { GET, PATCH } from "@/app/api/resume/settings/route";

const auth = vi.mocked(getCurrentUser);
const read = vi.mocked(readResumeSettings);
const write = vi.mocked(writeResumeSettings);

const SETTINGS = {
  gender: "male" as const,
  fullNameLatin: "Amir Nouri",
  resumePhone: "+98 935",
  resumeLang: "en" as const,
  resumeTemplate: "signature" as const,
  hideLocation: true,
  broadMatchingMode: true,
  broadMatchingSections: ["software" as const],
  declaredDomains: ["web-fullstack"],
  resumeEmphasis: "Broad expert mode",
  clients: ["CCTV Line"],
  unlimitedApply: true,
};

beforeEach(() => vi.clearAllMocks());

describe("/api/resume/settings", () => {
  it("requires a web session", async () => {
    auth.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    const response = await PATCH(new Request("https://k/api/resume/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(SETTINGS),
    }));
    expect(response.status).toBe(401);
    expect(write).not.toHaveBeenCalled();
  });

  it("reads settings for the signed-in user only", async () => {
    auth.mockResolvedValue({ id: "user-1" } as never);
    read.mockResolvedValue(SETTINGS);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(read).toHaveBeenCalledWith("user-1");
    expect((await response.json()).settings.resumeTemplate).toBe("signature");
  });

  it("validates and writes settings against the session user", async () => {
    auth.mockResolvedValue({ id: "user-1", name: "Amir" } as never);
    write.mockResolvedValue(SETTINGS);
    const response = await PATCH(new Request("https://k/api/resume/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...SETTINGS, userId: "other-user" }),
    }));
    expect(response.status).toBe(400);

    const valid = await PATCH(new Request("https://k/api/resume/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(SETTINGS),
    }));
    expect(valid.status).toBe(200);
    expect(write).toHaveBeenCalledWith("user-1", SETTINGS, { fallbackFullName: "Amir" });
  });
});
