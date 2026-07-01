/**
 * انواعِ مشترکِ کلاینتِ رزومه/پروفایل (Track C) — سبک، بدونِ I/O، قابلِ مصرف در
 * server (page) و client (form/list). شکل با پاسخِ API (profile-view.ts) هم‌راستاست.
 */
import type {
  ProfileEducation,
  ProfileLanguage,
  ProfileLink,
  ProfileWorkExperience,
} from "@/db/schema";

/** پروفایلِ جامع به شکلِ کلاینت — عیناً همان چیزی که API برمی‌گرداند (ApiFullProfile). */
export interface ClientProfile {
  fullName: string;
  headline: string | null;
  summary: string | null;
  city: string | null;
  phone: string | null;
  avatarUrl: string | null;
  expectedSalary: string | null;
  yearsExperience: number | null;
  skills: string[];
  workExperience: ProfileWorkExperience[];
  education: ProfileEducation[];
  languages: ProfileLanguage[];
  links: ProfileLink[];
}

/** یک فایلِ رزومه در فهرستِ آپلودها (شکلِ ResumeFileItem از data.ts، createdAt به‌صورتِ رشته/عدد قابلِ سریال). */
export interface ClientResumeFile {
  id: string;
  fileName: string;
  byteSize: number;
  hasText: boolean;
  isParsed: boolean;
  isPrimary: boolean;
  createdAt: string;
}

/** پروفایلِ خالیِ اولیه — وقتی هنوز پروفایلی ساخته نشده. */
export const EMPTY_CLIENT_PROFILE: ClientProfile = {
  fullName: "",
  headline: null,
  summary: null,
  city: null,
  phone: null,
  avatarUrl: null,
  expectedSalary: null,
  yearsExperience: null,
  skills: [],
  workExperience: [],
  education: [],
  languages: [],
  links: [],
};
