/**
 * خواندنِ فرم‌های HTML **بدونِ DOM**.
 *
 * چرا اصلاً لازم است؟ آداپتورهای کاربوم و ای‌استخدام در افزونه داخلِ مرورگر اجرا
 * می‌شوند و آن‌جا `document`/`DOMParser` در دسترس است. همان منطق وقتی به کنترل‌پلین
 * می‌آید هیچ مرورگری ندارد و در پروژه هم هیچ پارسرِ HTML نصب نیست. پس همان چیزی را
 * که واقعاً لازم داریم — «فیلدهای یک فرم، همان‌طور که سرور پیش‌پر کرده» — با regex
 * روی متنِ خام می‌خوانیم.
 *
 * دامنه‌ی این ماژول عمداً باریک است: فرم‌هایی که خودِ سایت رندر کرده‌اند (ورودی‌های
 * ساده، textarea، select). این‌جا نه HTML عمومی parse می‌شود و نه چیزی اجرا می‌شود؛
 * فقط ویژگی‌های تگ‌ها خوانده می‌شوند تا همان چیزی پس فرستاده شود که مرورگر می‌فرستاد.
 *
 * §۱۰: هیچ مقداری ساخته یا حدس زده نمی‌شود. اگر سایت فیلدی را لازم بداند که در قالبِ
 * پیش‌پرشده نیست، فراخواننده باید شکست بخورد — نه این‌که داده‌ی جعلی بسازد.
 */

/** مقدارِ یک ویژگی از متنِ داخلِ تگ (`<input name="x" value="y">` → `attribute(tag,"value")`). */
export function attribute(tag: string, name: string): string | undefined {
  const quoted = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i").exec(tag);
  if (quoted) return decodeEntities(quoted[1]!);
  const single = new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, "i").exec(tag);
  if (single) return decodeEntities(single[1]!);
  const bare = new RegExp(`\\b${name}\\s*=\\s*([^\\s"'>]+)`, "i").exec(tag);
  return bare ? decodeEntities(bare[1]!) : undefined;
}

/** آیا ویژگیِ بولینی مثلِ checked/selected/disabled روی تگ هست؟ */
export function hasFlag(tag: string, name: string): boolean {
  return new RegExp(`\\b${name}\\b`, "i").test(tag);
}

/** موجودیت‌های HTMLِ رایج را باز می‌کند (فقط آن‌قدر که برای مقدارِ فرم لازم است). */
export function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    // `&amp;` آخر باز می‌شود تا `&amp;lt;` به `<` تبدیل نشود.
    .replace(/&amp;/gi, "&");
}

/** متنِ قابلِ خواندنِ یک قطعه HTML (تگ‌ها حذف، فاصله‌ها یکدست). */
export function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

/** یک بلوکِ `<form>` با ویژگی‌های خودش. */
export interface FormBlock {
  /** متنِ داخلِ تگِ باز (برای خواندنِ action/method). */
  openTag: string;
  /** محتوای بینِ `<form>` و `</form>`. */
  inner: string;
  /** کلِ بلوک، برای تشخیص‌های متنی. */
  outer: string;
}

/** همه‌ی فرم‌های یک سند را جدا می‌کند (تودرتو نیستند؛ HTML اجازه نمی‌دهد). */
export function formBlocks(html: string): FormBlock[] {
  const blocks: FormBlock[] = [];
  for (const match of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    blocks.push({ openTag: match[1]!, inner: match[2]!, outer: match[0]! });
  }
  return blocks;
}

/** آپشن‌های `collectFormFields`. */
export interface CollectFieldsOptions {
  /**
   * وقتی هیچ `<option>`ای `selected` نیست، مرورگر اولی را می‌فرستد. پیش‌فرض همین
   * رفتار است؛ `false` یعنی selectِ بدونِ انتخاب اصلاً فرستاده نشود.
   */
  firstOptionWhenNoneSelected?: boolean;
  /** دکمه‌های submit/button هم برگردانده شوند (پیش‌فرض: نه، مثلِ مرورگر). */
  includeButtons?: boolean;
}

/**
 * فیلدهای یک قالب را همان‌طور که سرور پیش‌پر کرده جمع می‌کند.
 *
 * دقیقاً همان چیزی برمی‌گردد که مرورگر می‌فرستاد: ورودیِ فایل بیرون می‌ماند (فراخواننده
 * خودش فایل را می‌گذارد)، رادیو/چک‌باکسِ تیک‌نخورده هم نه، و فیلدِ `disabled` هم نه.
 * جفت‌ها به ترتیبِ ظهور برمی‌گردند تا سرورهایی که به ترتیب حساس‌اند هم درست کار کنند.
 */
export function collectFormFields(
  html: string,
  options: CollectFieldsOptions = {},
): Array<[string, string]> {
  const { firstOptionWhenNoneSelected = true, includeButtons = false } = options;
  const fields: Array<[string, string]> = [];

  for (const match of html.matchAll(/<input\b([^>]*)>/gi)) {
    const tag = match[1]!;
    const name = attribute(tag, "name");
    if (!name || hasFlag(tag, "disabled")) continue;
    const type = (attribute(tag, "type") ?? "text").toLowerCase();
    if (type === "file" || type === "image") continue;
    if (!includeButtons && (type === "submit" || type === "button" || type === "reset")) continue;
    if ((type === "checkbox" || type === "radio") && !hasFlag(tag, "checked")) continue;
    fields.push([name, attribute(tag, "value") ?? ""]);
  }

  for (const match of html.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)) {
    const tag = match[1]!;
    const name = attribute(tag, "name");
    if (!name || hasFlag(tag, "disabled")) continue;
    fields.push([name, decodeEntities(match[2]!).trim()]);
  }

  for (const match of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const tag = match[1]!;
    const name = attribute(tag, "name");
    if (!name || hasFlag(tag, "disabled")) continue;
    const options_ = [...match[2]!.matchAll(/<option\b([^>]*)>([\s\S]*?)(?=<option\b|$)/gi)];
    const chosen = options_.filter((option) => hasFlag(option[1]!, "selected"));
    const effective =
      chosen.length > 0 ? chosen : firstOptionWhenNoneSelected ? options_.slice(0, 1) : [];
    for (const option of effective) {
      // `<option>` بدونِ value یعنی متنِ خودش ارسال می‌شود (رفتارِ استانداردِ مرورگر).
      fields.push([name, attribute(option[1]!, "value") ?? stripTags(option[2] ?? "")]);
    }
  }

  return fields;
}

/** نامِ اولین ورودیِ فایلِ این قالب (یا null اگر فرم فایلی نخواهد). */
export function fileInputName(html: string): string | null {
  for (const match of html.matchAll(/<input\b([^>]*)>/gi)) {
    const tag = match[1]!;
    if ((attribute(tag, "type") ?? "").toLowerCase() !== "file") continue;
    const name = attribute(tag, "name");
    if (name) return name;
  }
  return null;
}

/**
 * توکنِ CSRF را از یک صفحه بیرون می‌کشد — `<meta name="csrf-token">` یا
 * `<input name="_token">`، همان دو جایی که فریم‌ورک‌های PHP آن را می‌گذارند.
 */
export function csrfTokenFromHtml(html: string): string | null {
  for (const match of html.matchAll(/<meta\b([^>]*)>/gi)) {
    const tag = match[1]!;
    if ((attribute(tag, "name") ?? "").toLowerCase() !== "csrf-token") continue;
    const content = attribute(tag, "content")?.trim();
    if (content) return content;
  }
  for (const match of html.matchAll(/<input\b([^>]*)>/gi)) {
    const tag = match[1]!;
    if ((attribute(tag, "name") ?? "") !== "_token") continue;
    const value = attribute(tag, "value")?.trim();
    if (value) return value;
  }
  return null;
}
