/**
 * آیکن‌های مرکزیِ کارجو (بر پایه‌ی `lucide-react`) — منبعِ حقیقتِ همه‌ی آیکن‌های UI.
 *
 * چرا این ماژول؟ تا هر جای اپ (داشبورد + لندینگ/مارکتینگ + رزومه) از «یک» ست آیکنِ
 * معنایی و *یکدست* استفاده کند — نه ایموجی، نه SVGِ دست‌سازِ پراکنده. هر آیکن یک
 * lucide iconِ نام‌دار است که پیش‌تنظیمِ زیر را می‌گیرد:
 *   • strokeWidth = ۱٫۷۵ (هم‌سبک با `dashboard-nav`)،
 *   • رنگ از `currentColor` (پس با توکن‌های brand/amber/rose/muted والد هماهنگ می‌شود)،
 *   • `aria-hidden` (آیکن‌ها تزئینی‌اند؛ معنا در متنِ کنارشان است)،
 *   • کلاسِ پایه‌ی `shrink-0` تا در فلکس‌باکس له نشوند.
 *
 * اندازه: با `className` (مثلِ `h-5 w-5`) یا پراپِ `size` کنترل می‌شود. قرارداد پروژه:
 * ۱۸–۲۰px داخلِ کارت/StatCard، ۱۶px این‌لاین کنارِ متن. lucide با `currentColor` رندر
 * می‌کند؛ پس رنگ را با کلاسِ `text-*` روی خودِ آیکن یا والدش بده.
 *
 * RTL: آیکن‌های جهت‌دار (فلش/شِوران) در راست‌به‌چپ باید قرینه شوند. برای آن‌ها از
 * واریانتِ *End/*Start (که کلاسِ `rtl:-scale-x-100` دارند) استفاده کن، نه آیکنِ خام.
 *
 * server-safe: نه state، نه `use client`، نه import از `server-only`. پس در هر
 * Server یا Client component بدونِ اصطکاک قابلِ استفاده است. importهای نام‌دار تا
 * باندل لاغر بماند (tree-shaking).
 */
import type { ComponentType } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Bell,
  Bot,
  Building2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleDot,
  CirclePause,
  Compass,
  Download,
  FileText,
  Gauge,
  GraduationCap,
  Hand,
  Inbox,
  Languages,
  Link2,
  ListChecks,
  Lock,
  type LucideIcon,
  type LucideProps,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plug,
  Plus,
  Power,
  Puzzle,
  Receipt,
  RefreshCw,
  Reply,
  Send,
  Server,
  ShieldCheck,
  Sparkles,
  SquarePen,
  Star,
  Target,
  Trash2,
  UploadCloud,
  User,
  Wallet,
  X,
  Zap,
} from "lucide-react";

import { cn } from "./ui";

/** پراپ‌های یک آیکنِ کارجو — هم‌شکلِ lucide (className/size/… همه پذیرفته می‌شوند). */
export type IconProps = LucideProps;

/** نوعِ یک کامپوننتِ آیکن — برای امضای پراپ‌هایی که «یک آیکن» می‌گیرند. */
export type IconComponent = ComponentType<IconProps>;

/** کلاسِ پایه‌ی مشترکِ همه‌ی آیکن‌ها — در فلکس‌باکس له نشوند. */
const ICON_BASE = "shrink-0";

/**
 * یک lucide icon را با پیش‌تنظیم‌های کارجو می‌پوشاند: strokeWidth ثابت، aria-hidden،
 * و کلاسِ پایه. پراپ‌های ورودی (به‌ویژه className/size) روی پیش‌فرض‌ها می‌نشینند تا
 * فراخواننده هرجا لازم بود override کند. `flip` برای آیکن‌های جهت‌دار در RTL.
 */
function icon(
  Base: LucideIcon,
  opts: { flip?: boolean } = {},
): IconComponent {
  function KarjooIcon({ className, strokeWidth, ...props }: IconProps) {
    return (
      <Base
        aria-hidden
        strokeWidth={strokeWidth ?? 1.75}
        className={cn(ICON_BASE, opts.flip && "rtl:-scale-x-100", className)}
        {...props}
      />
    );
  }
  KarjooIcon.displayName = `Icon(${Base.displayName ?? "lucide"})`;
  return KarjooIcon;
}

/* ─────────────────────────  آیکن‌های معناییِ کارجو  ──────────────────────── */
/*
 * نام‌ها *معنایی*‌اند (نقشِ آیکن، نه شکلش) تا اگر بعداً glyph عوض شد، نامِ فراخوانی
 * پایدار بماند. این نام‌ها با ست قبلیِ SVGِ دست‌ساز (track-icons/nav) هم‌راستا هستند
 * تا مهاجرت به lucide بدونِ تغییرِ نامِ فراخوانی ممکن باشد.
 */

// وضعیت / بازخورد
export const IconCheck = icon(CircleCheck); // موفقیت/تأیید/تیک
export const IconTarget = icon(Target); // هدف/آستانه/تطبیق
export const IconSend = icon(Send); // اپلای/ارسالِ درخواست
export const IconInbox = icon(Inbox); // حالتِ خالیِ عمومی (📭)
export const IconWarn = icon(CircleAlert); // هشدار/پیش‌نیاز
export const IconAlert = icon(CircleAlert); // نامِ جایگزینِ هشدار
export const IconPause = icon(CirclePause); // مکث/توقف (⏸️)
export const IconReply = icon(Reply, { flip: true }); // ارجاع/پاسخ (↪️) — جهت‌دار

// وضعیتِ نقطه‌ای (سلامتِ ناوگان: 🟢 🟡 ⚪ → یک شکل، رنگ از text-*)
export const IconStatusDot = icon(CircleDot);

// ناوبری / کشف
export const IconCompass = icon(Compass); // تطبیق‌ها/کشف
export const IconGauge = icon(Gauge); // سنجه/سقفِ مصرف
export const IconChart = icon(BarChart3); // آمار/تاریخچه (📊)
export const IconChecklist = icon(ListChecks); // فهرست/مراحل

// افزونه / اتصال
export const IconPuzzle = icon(Puzzle); // افزونه/پازل (🧩)
export const IconPlug = icon(Plug); // اتصالِ حساب
export const IconChip = icon(Puzzle); // میراثِ نامِ chip → همان پازل

// پول / بیلینگ
export const IconWallet = icon(Wallet); // کیف‌پول
export const IconReceipt = icon(Receipt); // رسید/ردِ ممیزی

// اعلان / امنیت / هوش مصنوعی
export const IconBell = icon(Bell); // اعلانِ تطبیقِ تازه (🔔)
export const IconShield = icon(ShieldCheck); // امنیت/مرزِ نشست (🔒)
export const IconLock = icon(Lock); // دسترسیِ محافظت‌شده
export const IconBot = icon(Bot); // دستیارِ هوش مصنوعی (🤖)
export const IconSparkle = icon(Sparkles); // پردازشِ هوش مصنوعی/جادو (✨)
export const IconBolt = icon(Zap); // اپلای خودکار (⚡)

// رزومه / پروفایل
export const IconDoc = icon(FileText); // رزومه/فایل (📝 📄)
export const IconUpload = icon(UploadCloud); // آپلود
export const IconDownload = icon(Download); // دانلود
export const IconTrash = icon(Trash2); // حذف
export const IconStar = icon(Star); // علاقه‌مندی/اصلی (⭐)
export const IconUser = icon(User); // کاربر/پروفایل
export const IconPhone = icon(Phone); // شماره‌ی تماس
export const IconMail = icon(Mail); // ایمیل (📨 در فرم/پروفایل)
export const IconMapPin = icon(MapPin); // شهر/مکان
export const IconBuilding = icon(Building2); // شرکت/سابقه‌ی کاری
export const IconEducation = icon(GraduationCap); // تحصیلات
export const IconLanguages = icon(Languages); // زبان‌ها
export const IconLink = icon(Link2); // لینک‌ها
export const IconEdit = icon(Pencil); // ویرایش
export const IconEditBox = icon(SquarePen); // ویرایشِ فرم/بلوک

// زیرساخت / ناوگان
export const IconServer = icon(Server); // سرور/نودِ ناوگان
export const IconRefresh = icon(RefreshCw); // به‌روزرسانی/چرخش
export const IconPower = icon(Power); // ری‌استارت/پاور

// کنش‌های ریز
export const IconPlus = icon(Plus); // افزودن
export const IconClose = icon(X); // بستن/حذفِ چیپ
export const IconHand = icon(Hand); // خوش‌آمد (👋)

// جهت‌دارها (RTL-aware) — برای فلش/شِوران، همیشه واریانتِ End/Start را استفاده کن.
export const IconChevronEnd = icon(ChevronLeft, { flip: true }); // «جلو» در RTL
export const IconChevronStart = icon(ChevronRight, { flip: true }); // «عقب/بازگشت» در RTL
export const IconArrowEnd = icon(ArrowLeft, { flip: true });
export const IconArrowStart = icon(ArrowRight, { flip: true });

/* ─────────────────  گذرِ مستقیمِ lucide (برای مواردِ خاص)  ─────────────────── */
/*
 * اگر آیکنی لازم شد که این‌جا نام‌دار نشده، از خودِ `lucide-react` نام‌دار import کن
 * (مثلِ `import { Rocket } from "lucide-react"`) — همان قرارداد. این re-exportها فقط
 * برای راحتیِ ست پرمصرف‌اند؛ منبعِ نهایی همان بسته‌ی lucide است.
 */
export type { LucideIcon, LucideProps } from "lucide-react";
