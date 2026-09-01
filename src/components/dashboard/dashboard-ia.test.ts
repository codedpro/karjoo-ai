/**
 * Information-architecture guard for the dashboard.
 *
 * The dashboard had grown to 12 nav entries across 4 groups while the extension
 * did the same job in one panel with tabs — users could not find their settings.
 * These tests pin the smaller shape and, more importantly, make it impossible to
 * add a page that nobody can reach.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ADMIN_ITEMS, NAV_GROUPS } from "@/components/dashboard/dashboard-nav";
import { APPLY_TABS, ACCOUNT_TABS } from "@/components/dashboard/section-tabs";

const DASHBOARD_DIR = "src/app/(dashboard)/dashboard";

/** Every route that has a page.tsx, as a /dashboard/... href. */
function routesOnDisk(dir = DASHBOARD_DIR, prefix = "/dashboard"): string[] {
  const out: string[] = [];
  if (existsSync(join(dir, "page.tsx"))) out.push(prefix);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    // Dynamic segments and the admin area are not part of the user-facing IA.
    if (entry.name.startsWith("[") || entry.name === "admin") continue;
    out.push(...routesOnDisk(join(dir, entry.name), `${prefix}/${entry.name}`));
  }
  return out;
}

/** A page whose whole job is redirecting an old URL somewhere current. */
function isRedirectStub(href: string): boolean {
  const file = join(DASHBOARD_DIR, href.replace("/dashboard", "").replace(/^\//, ""), "page.tsx");
  if (!existsSync(file)) return false;
  const source = readFileSync(file, "utf8");
  return source.includes("redirect(") && !source.includes("<PageHeader");
}

const navItems = NAV_GROUPS.flatMap((group) => group.items);
const navHrefs = navItems.map((item) => item.href);
const tabHrefs = [...APPLY_TABS, ...ACCOUNT_TABS].map((tab) => tab.href);

describe("navigation shape", () => {
  it("is one short flat list, not four groups of a dozen links", () => {
    expect(NAV_GROUPS).toHaveLength(1);
    expect(navItems.length).toBeLessThanOrEqual(6);
  });

  it("never lists the same destination twice", () => {
    expect(new Set(navHrefs).size).toBe(navHrefs.length);
  });

  it("uses plain Persian labels — no Latin words or internal jargon", () => {
    for (const item of navItems) {
      expect(item.label, item.href).not.toMatch(/[A-Za-z]/);
      expect(item.hint, item.href).not.toMatch(/queue|fleet|threshold|task/i);
      expect(item.hint.length, item.href).toBeGreaterThan(0);
    }
  });

  it("points only at routes that actually exist", () => {
    const routes = routesOnDisk();
    for (const href of [...navHrefs, ...tabHrefs]) {
      expect(routes, href).toContain(href);
    }
  });
});

describe("no orphan pages", () => {
  it("every dashboard page is in the nav, in a tab bar, or a redirect stub", () => {
    // Admin pages are reachable too — just from the admin-only nav group, and
    // /dashboard/fleet lives outside the admin/ folder.
    const reachable = new Set([
      ...navHrefs,
      ...tabHrefs,
      ...ADMIN_ITEMS.map((item) => item.href),
    ]);
    const orphans = routesOnDisk().filter(
      (href) => !reachable.has(href) && !isRedirectStub(href),
    );
    expect(orphans).toEqual([]);
  });

  it("each tab bar's own pages all carry that bar, so a tab is never a dead end", () => {
    for (const [name, tabs] of [["apply", APPLY_TABS], ["account", ACCOUNT_TABS]] as const) {
      for (const tab of tabs) {
        const file = join(DASHBOARD_DIR, tab.href.replace("/dashboard/", ""), "page.tsx");
        const source = readFileSync(file, "utf8");
        expect(source, `${name}: ${tab.href}`).toContain("SectionTabs");
        expect(source, `${name}: ${tab.href}`).toContain(`active="${tab.href}"`);
      }
    }
  });
});

describe("the merged targeting page", () => {
  it("keeps job fields and filters together, because they write the same key", () => {
    const source = readFileSync(join(DASHBOARD_DIR, "auto-apply/page.tsx"), "utf8");
    expect(source).toContain("InterestsPickerSection");
    expect(source).toContain("FiltersSection");
  });

  it("leaves the old interests URL working", () => {
    const source = readFileSync(join(DASHBOARD_DIR, "interests/page.tsx"), "utf8");
    expect(source).toContain('redirect("/dashboard/auto-apply")');
  });
});
