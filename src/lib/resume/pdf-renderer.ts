import "server-only";

import { chromium, type Browser } from "playwright-core";

const globalForRenderer = globalThis as unknown as {
  __karjooResumeBrowser?: Promise<Browser>;
};

function browserInstance(): Promise<Browser> {
  if (!globalForRenderer.__karjooResumeBrowser) {
    globalForRenderer.__karjooResumeBrowser = chromium
      .launch({
        executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      })
      .catch((error) => {
        globalForRenderer.__karjooResumeBrowser = undefined;
        throw error;
      });
  }
  return globalForRenderer.__karjooResumeBrowser;
}

export async function renderResumePdf(html: string): Promise<Buffer> {
  const browser = await browserInstance();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "networkidle", timeout: 30_000 });
    await page.emulateMedia({ media: "print" });
    const bytes = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
    return Buffer.from(bytes);
  } finally {
    await page.close().catch(() => undefined);
  }
}
