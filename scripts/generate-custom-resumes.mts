/**
 * Generate tailored resume PDFs for jobs the user supplies (not from a job board).
 *
 *   EMAIL=user@example.com JOBS=jobs.json OUT_DIR=out npm run resumes:custom
 *
 * JOBS is a JSON array of { key, title, url?, description }. Each job is saved as
 * a "custom" listing, a resume is generated once (later runs reuse it) and the
 * PDF is written to OUT_DIR as `<key>__<file name>`, with an index4.json map.
 * Generation is an AI call billed to the user's 1xAi account.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { db, client } from "@/db";
import { jobListings, users, resumes, candidateProfiles } from "@/db/schema";
import { generateTailoredResume } from "@/lib/resume/custom-resume-service";
import { renderResumePdf } from "@/lib/resume/pdf-renderer";
import { resumeFileName } from "@/lib/resume/resume-templates";
const EMAIL = process.env.EMAIL!, OUT = process.env.OUT_DIR!;
const jobs = JSON.parse(readFileSync(process.env.JOBS!, "utf8")) as { key:string; title:string; url?:string; description:string }[];
const user = await db.query.users.findFirst({ where: eq(users.email, EMAIL), columns:{id:true} });
const profile = await db.query.candidateProfiles.findFirst({ where: eq(candidateProfiles.userId, user!.id), columns:{fullName:true,preferences:true} });
const latin = (profile!.preferences as {fullNameLatin?:string})?.fullNameLatin ?? null;
mkdirSync(OUT, { recursive: true });
const idx: Record<string,string> = {};
for (const job of jobs) {
  const externalId = createHash("sha256").update(`${job.title}\n${job.description}`).digest("hex").slice(0,32);
  const [listing] = await db.insert(jobListings).values({
    board:"custom", externalId, canonicalId:`custom:${externalId}`, title:job.title, company:null, city:null,
    url: job.url ?? `karjoo://custom/${externalId}`, description: job.description, applyType:"contact", postedAt:new Date(),
  }).onConflictDoUpdate({ target: jobListings.canonicalId, set:{ title:job.title, description:job.description, lastSeenAt:new Date(), updatedAt:new Date() } })
    .returning({ id: jobListings.id });
  const existing = await db.query.resumes.findFirst({ where: and(eq(resumes.userId,user!.id), eq(resumes.listingId,listing!.id), eq(resumes.isBase,false)), columns:{id:true,content:true} });
  const r = existing ? { id:existing.id, html:existing.content, headline:"(cached)", fullName:profile!.fullName }
                     : await generateTailoredResume(user!.id, listing!.id, { source:"manual" });
  const pdf = await renderResumePdf(r.html);
  const p = join(OUT, `${job.key}__${resumeFileName(r.fullName, job.title, { latinName: latin, unique: job.key })}`);
  writeFileSync(p, pdf); idx[job.key] = p;
  console.log(JSON.stringify({ key:job.key, cached:!!existing, headline:r.headline, kb:Math.round(pdf.length/1024) }));
}
writeFileSync(join(OUT,"index4.json"), JSON.stringify(idx,null,2));
await client.end({ timeout: 5 }).catch(()=>{});
process.exit(0);
