/**
 * `toKarjooHost` — هرچه از موتورِ محتوا می‌آید باید زیرِ دامنه‌ی خودِ کارجو
 * (`karjoo.1xai.ir`، عضوِ خانواده‌ی 1xAi) سرو شود، نه هاستِ موتور.
 *
 * چرا تست دارد: نشتِ هاست بی‌صدا است — صفحه سالم رندر می‌شود ولی کنونیکال/نقشه‌ی سایت/
 * llms.txt به دامنه‌ای اشاره می‌کنند که سایتِ ما نیست و آن URLها ۴۰۴ می‌دهند.
 */
import { describe, expect, it } from "vitest";

import { toKarjooHost } from "@/lib/itmaster";

describe("toKarjooHost", () => {
  it("خطِ Sitemap در robots.txt را به دامنه‌ی کارجو می‌برد", () => {
    const out = toKarjooHost("Sitemap: https://karjooai.itmaster.uk/sitemap.xml");
    expect(out).toBe("Sitemap: https://karjoo.1xai.ir/sitemap.xml");
  });

  it("همه‌ی لینک‌های llms.txt را بازنویسی می‌کند (نه فقط اولی)", () => {
    const out = toKarjooHost(
      "- [a](https://karjooai.itmaster.uk/blog/a)\n- [b](https://karjooai.itmaster.uk/blog/b)",
    );
    expect(out).not.toContain("itmaster.uk");
    expect(out.match(/karjoo\.1xai\.ir/g)).toHaveLength(2);
  });

  it("هاستِ داخلِ JSON-LD (@id/url) را هم می‌گیرد", () => {
    const graph = JSON.stringify({
      "@graph": [
        { "@type": "WebSite", "@id": "https://karjooai.itmaster.uk/#website" },
        { "@type": "Organization", url: "https://karjooai.itmaster.uk" },
      ],
    });
    const out = JSON.parse(toKarjooHost(graph)) as { "@graph": Record<string, string>[] };
    expect(out["@graph"][0]!["@id"]).toBe("https://karjoo.1xai.ir/#website");
    expect(out["@graph"][1]!.url).toBe("https://karjoo.1xai.ir");
  });

  it("متنی که هاستِ موتور ندارد دست‌نخورده می‌ماند", () => {
    const clean = "User-agent: *\nDisallow: /api/";
    expect(toKarjooHost(clean)).toBe(clean);
  });
});
