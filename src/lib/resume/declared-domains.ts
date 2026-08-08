import "server-only";

/**
 * «حوزه‌های اعلامیِ کاربر» — راهِ عملیِ گفتنِ «من در این زمینه‌ها کار کرده‌ام»، بدونِ
 * تایپ‌کردنِ هزار مهارت.
 *
 * مسئله‌ی واقعی: رزومه‌ی آپلودیِ یک نفر با ۸ سال سابقه و ۲۰۰+ پروژه، بخشِ کوچکی از
 * دامنه‌ی واقعیِ اوست. گاردِ مهارت (که برای جلوگیری از **جعلِ مدل** ساخته شده) هر مهارتی
 * را که در همان دو صفحه نیامده حذف می‌کند — حتی وقتی کاربر واقعاً آن را دارد. نتیجه:
 * کاربر باید تک‌تک مهارت‌ها را دستی اعلام کند، که عملی نیست.
 *
 * راه‌حل: کاربر **حوزه** اعلام می‌کند (۵-۱۰ کلمه)، و مدل آزاد است هر مهارتِ متعارفِ درونِ
 * همان حوزه‌ها را — وقتی آگهی می‌خواهد — نام ببرد. مرجعِ ادعا همچنان خودِ کاربر است؛
 * چیزی که همچنان مجاز نیست، ادعای حوزه‌ای است که کاربر **اعلام نکرده**.
 *
 * یعنی: اعلامِ «Web3/Blockchain» ⇒ Solidity/ethers.js/smart contracts مجاز می‌شوند.
 * اعلام‌نکردنِ «Sales» ⇒ رزومه به فروش تبدیل نمی‌شود.
 */

export interface DomainVocabulary {
  id: string;
  labelFa: string;
  /** واژگانِ متعارفِ این حوزه — چیزی که «درونِ» ادعای کاربر می‌گنجد. */
  skills: string[];
}

export const SKILL_DOMAINS: DomainVocabulary[] = [
  {
    id: "web-fullstack",
    labelFa: "توسعه‌ی وب / فول‌استک",
    skills: [
      "React", "Next.js", "Vue.js", "Nuxt.js", "Angular", "Svelte", "TypeScript", "JavaScript",
      "Tailwind CSS", "shadcn/ui", "Redux", "Zustand", "Vite", "Webpack", "HTML5", "CSS3",
      "Node.js", "Express", "NestJS", "Fastify", "REST APIs", "GraphQL", "tRPC", "WebSockets",
      "Microservices", "Server-Side Rendering", "Progressive Web Apps",
    ],
  },
  {
    id: "backend-python",
    labelFa: "بک‌اند / پایتون",
    skills: ["Python", "Django", "FastAPI", "Flask", "Celery", "SQLAlchemy", "Pydantic", "asyncio"],
  },
  {
    id: "databases",
    labelFa: "پایگاه داده",
    skills: [
      "PostgreSQL", "MySQL", "MongoDB", "Redis", "SQL Server", "SQLite", "Elasticsearch",
      "Prisma", "Drizzle ORM", "Database Design", "Query Optimization", "Vector Databases", "Qdrant",
    ],
  },
  {
    id: "baas-cloud",
    labelFa: "سرویس‌های ابری و BaaS",
    skills: [
      "Supabase", "Firebase", "Appwrite", "AWS", "Azure", "Google Cloud", "Vercel", "Cloudflare",
      "S3", "Lambda", "Serverless", "Cloud Deployment", "CDN",
    ],
  },
  {
    id: "devops",
    labelFa: "دواپس و زیرساخت",
    skills: [
      "Docker", "Kubernetes", "CI/CD", "GitHub Actions", "Nginx", "Linux", "Terraform",
      "Monitoring", "Logging", "Grafana", "Prometheus", "Load Balancing",
    ],
  },
  {
    id: "web3",
    labelFa: "وب‌۳ و بلاک‌چین",
    skills: [
      "Web3", "Blockchain", "Solidity", "Smart Contracts", "ethers.js", "web3.js", "EVM",
      "Hardhat", "Truffle", "NFT", "DeFi", "Wallet Integration", "IPFS", "Token Standards",
    ],
  },
  {
    id: "mobile",
    labelFa: "موبایل",
    skills: [
      "Flutter", "Dart", "React Native", "Android", "iOS", "Swift", "Kotlin",
      "Mobile App Development", "App Store Deployment", "Push Notifications",
    ],
  },
  {
    id: "ai-ml",
    labelFa: "هوش مصنوعی و داده",
    skills: [
      "LLM Orchestration", "RAG", "Vector Search", "Prompt Engineering", "OpenAI API",
      "Claude", "LangChain", "TensorFlow", "PyTorch", "Pandas", "Data Analysis",
      "Machine Learning", "AI Agents", "Fine-tuning", "Embeddings",
    ],
  },
  {
    id: "security",
    labelFa: "امنیت",
    skills: [
      "OAuth", "JWT", "Authentication", "Authorization", "API Security", "Encryption",
      "Secrets Management", "Penetration Testing", "OWASP", "Security Auditing",
    ],
  },
  {
    id: "product-management",
    labelFa: "مدیریت محصول و کسب‌وکار",
    skills: [
      "Product Management", "Product Ownership", "Roadmapping", "Prioritisation", "Agile",
      "Scrum", "Stakeholder Management", "Team Leadership", "Technical Leadership",
      "Business Analysis", "Requirements Gathering", "Go-to-Market", "Budgeting",
    ],
  },
  {
    id: "sales-bizdev",
    labelFa: "فروش و توسعه‌ی کسب‌وکار",
    skills: [
      "Sales", "B2B Sales", "Business Development", "Lead Generation", "Client Relationship Management",
      "CRM", "Negotiation", "Account Management", "Proposal Writing", "Pipeline Management",
      "Customer Success", "Upselling", "Partnerships", "Market Research",
    ],
  },
  {
    id: "design",
    labelFa: "طراحی",
    skills: ["UI Design", "UX Design", "Figma", "Design Systems", "Prototyping", "Responsive Design", "Accessibility"],
  },
];

const BY_ID = new Map(SKILL_DOMAINS.map((d) => [d.id, d]));

/** واژگانِ مجازِ حاصل از حوزه‌های اعلامیِ کاربر (رشته‌ی واحد برای بررسیِ شاهد). */
export function vocabularyForDomains(domains: readonly string[]): string {
  const out: string[] = [];
  for (const raw of domains) {
    const d = BY_ID.get(String(raw).trim().toLowerCase());
    if (d) out.push(...d.skills, d.labelFa);
  }
  return out.join(" | ");
}

/** برچسبِ فارسیِ حوزه‌های اعلامی — برای نمایش در پرامپت/رابط. */
export function labelsForDomains(domains: readonly string[]): string[] {
  return domains
    .map((raw) => BY_ID.get(String(raw).trim().toLowerCase())?.labelFa)
    .filter((v): v is string => Boolean(v));
}
