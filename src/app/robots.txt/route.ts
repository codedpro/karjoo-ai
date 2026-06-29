import { createRobotsRoute } from "@itmaster/sdk/next";

import { itmaster } from "@/lib/itmaster";

// robots.txt مدیریت‌شده از داشبورد موتور IT Master.
export const GET = createRobotsRoute(itmaster);
