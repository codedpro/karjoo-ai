/**
 * سالِ پیدایشِ هر تکنولوژی — نگهبانِ **باورپذیریِ زمانیِ** رزومه.
 *
 * وقتی مهارت‌های خواسته‌شده‌ی آگهی را بینِ سوابقِ واقعیِ کاربر پخش می‌کنیم، پخش‌کردنِ کور
 * فاجعه می‌سازد: «در ۱۳۹۴ با Claude Code کار کردم» در حالی که Claude Code سالِ ۲۰۲۵ آمده.
 * چنین جمله‌ای نه‌فقط بی‌اثر است، بلکه کلِ رزومه را از چشمِ خواننده می‌اندازد — دقیقاً
 * برعکسِ چیزی که می‌خواهیم.
 *
 * پس هر تکنولوژی فقط به سابقه‌ای می‌چسبد که بازه‌اش با دورانِ وجودِ آن تکنولوژی هم‌پوشانی
 * دارد. سال‌ها تقریبی و محافظه‌کارانه‌اند (زمانِ در دسترسِ عمومی قرار گرفتن، نه اولین commit).
 *
 * ناشناخته‌ها **مجاز** می‌مانند (fail-open): این فهرست هرگز کامل نمی‌شود و نبودنِ یک نام
 * در آن نباید مهارتِ واقعیِ کاربر را حذف کند. کارِ این ماژول جلوگیری از نابه‌هنگامیِ آشکار
 * است، نه فیلترکردنِ مهارت — آن کارِ `keepOnlyRealSkills` است.
 */

/** سالِ در دسترس قرار گرفتنِ عمومیِ هر تکنولوژی. */
const FIRST_YEAR: Record<string, number> = {
  // ابزارهای هوش مصنوعی — بیشترین ریسکِ نابه‌هنگامی همین‌جاست.
  claudecode: 2025,
  claude: 2023,
  cursor: 2023,
  githubcopilot: 2021,
  copilot: 2021,
  openaicodex: 2021,
  codex: 2021,
  chatgpt: 2022,
  openaiapi: 2020,
  gpt4: 2023,
  langchain: 2022,
  llamaindex: 2022,
  rag: 2021,
  vectorsearch: 2021,
  vectordatabases: 2021,
  qdrant: 2021,
  pinecone: 2021,
  embeddings: 2019,
  llmorchestration: 2023,
  promptengineering: 2022,
  aiagents: 2023,
  finetuning: 2021,
  huggingface: 2018,
  tensorflow: 2015,
  pytorch: 2016,
  pandas: 2008,
  machinelearning: 2000,

  // فرانت‌اند
  react: 2013,
  reactnative: 2015,
  nextjs: 2016,
  vuejs: 2014,
  nuxtjs: 2016,
  angular: 2010,
  svelte: 2016,
  typescript: 2012,
  javascript: 1995,
  tailwindcss: 2017,
  shadcnui: 2023,
  framermotion: 2019,
  threejs: 2010,
  redux: 2015,
  zustand: 2019,
  reactquery: 2019,
  vite: 2020,
  webpack: 2012,
  html5: 2008,
  css3: 2009,
  progressivewebapps: 2015,
  serversiderendering: 2016,

  // بک‌اند
  nodejs: 2009,
  express: 2010,
  nestjs: 2017,
  fastify: 2016,
  deno: 2018,
  bun: 2021,
  python: 1991,
  django: 2005,
  fastapi: 2018,
  flask: 2010,
  celery: 2009,
  sqlalchemy: 2006,
  pydantic: 2017,
  asyncio: 2014,
  aspnet: 2002,
  dotnet: 2002,
  go: 2009,
  golang: 2009,
  restapis: 2000,
  graphql: 2015,
  trpc: 2020,
  websockets: 2011,
  microservices: 2011,
  kafka: 2011,

  // داده
  postgresql: 1996,
  mysql: 1995,
  mongodb: 2009,
  redis: 2009,
  sqlserver: 1989,
  sqlite: 2000,
  elasticsearch: 2010,
  prisma: 2019,
  drizzleorm: 2022,

  // ابر و BaaS
  supabase: 2020,
  firebase: 2011,
  appwrite: 2019,
  aws: 2006,
  azure: 2010,
  googlecloud: 2011,
  vercel: 2015,
  cloudflare: 2010,
  s3: 2006,
  lambda: 2014,
  serverless: 2014,

  // دواپس
  docker: 2013,
  kubernetes: 2014,
  cicd: 2007,
  githubactions: 2018,
  gitlabci: 2012,
  nginx: 2004,
  linux: 1991,
  terraform: 2014,
  ansible: 2012,
  grafana: 2014,
  prometheus: 2015,
  sentry: 2012,
  git: 2005,
  github: 2008,

  // وب‌۳
  blockchain: 2009,
  bitcoin: 2009,
  web3: 2015,
  ethereum: 2015,
  solidity: 2015,
  smartcontracts: 2015,
  evm: 2015,
  ethersjs: 2016,
  web3js: 2015,
  hardhat: 2019,
  truffle: 2015,
  nft: 2017,
  defi: 2018,
  ipfs: 2015,
  walletintegration: 2017,
  tokenstandards: 2015,

  // موبایل
  flutter: 2017,
  dart: 2013,
  swift: 2014,
  kotlin: 2011,
  android: 2008,
  ios: 2008,

  // پرداخت و سرویس‌های شخصِ ثالث
  stripe: 2011,
  checkoutcom: 2012,
  paypal: 1999,

  // طراحی
  figma: 2016,
  designsystems: 2014,
};

const norm = (v: string) => v.toLowerCase().replace(/[\s._/-]+/g, "").replace(/\.js$/, "js");

/**
 * سالی که این تکنولوژی برای اولین بار قابلِ استفاده بوده.
 * ناشناخته → `null` یعنی «محدودیتی نمی‌شناسم».
 */
export function firstAvailableYear(tech: string): number | null {
  const key = norm(tech);
  if (key in FIRST_YEAR) return FIRST_YEAR[key]!;
  // تطبیقِ جزئی: «Next.js 15» یا «React Query v5» هم باید پیدا شوند.
  for (const [k, year] of Object.entries(FIRST_YEAR)) {
    if (k.length >= 5 && key.startsWith(k)) return year;
  }
  return null;
}

/**
 * آیا می‌شود این تکنولوژی را به سابقه‌ای با این بازه نسبت داد؟
 *
 * شرط: سابقه باید **بعد از** پیدایشِ تکنولوژی هنوز ادامه داشته باشد. سابقه‌ی ۱۳۹۹–۱۴۰۱
 * می‌تواند Supabase (۲۰۲۰) داشته باشد ولی Claude Code (۲۰۲۵) نه.
 */
export function techFitsPeriod(
  tech: string,
  period: { startYear: number | null; endYear: number | null },
): boolean {
  const first = firstAvailableYear(tech);
  if (first === null) return true; // ناشناخته → مانع نمی‌شویم
  // سابقه‌ی جاری (بدونِ سالِ پایان) تا امروز ادامه دارد.
  const end = period.endYear ?? new Date().getFullYear();
  return end >= first;
}
