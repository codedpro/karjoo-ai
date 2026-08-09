# JD-Shaped Resume Positioning Design

## Goal

When the user manually picks a job, Karjoo should generate a resume that is deeply shaped to that JD without requiring the user to maintain a giant skills list. The generated resume should reposition real companies, clients, products, and achievements toward the target role.

The generator may rewrite displayed role titles and job descriptions under each real company. It must keep factual anchors fixed: company/client names, product names when useful, dates, education, contact details, and links.

## Positioning Rules

For manually selected jobs, the selected JD is treated as a strong user attestation: the user is saying "I can do this job." The generator can use JD technologies, responsibilities, seniority, and soft skills as resume-positioning material, even when those exact strings are not present in the uploaded resume.

The output may:

- Rewrite role titles per company to match the JD angle.
- Rewrite role bullets from scratch to match the JD's technologies, outcomes, domain, and responsibilities.
- Use real client/product names as proof only when they strengthen the JD match.
- Include JD technologies in the generated resume skill section for that resume.
- Describe broad capabilities from declared expertise domains without requiring a permanent list of every tool.
- Always include the pinned real companies `MTN Irancell`, `CCTV Line`, and `CodeNest`, repositioned to the JD angle.
- Use two searched, field-relevant company names as market/domain calibration, but not as employers or clients.

The output must not:

- Invent employers, clients, products, degrees, dates, or locations.
- Permanently add extracted JD skills to `candidate_profiles.skills` without explicit user approval.
- Claim a specific tool was used at a specific company when the only support is broad attestation. In that case, phrase it as capability, implementation style, or transferable project work.
- Apply the aggressive mode silently to untrusted jobs. The first implementation applies it to manual resume tailoring only.
- Present searched external company names as if the user worked for them, sold to them, partnered with them, or built their products.

## Example

For a sales or digital marketing JD, a factual role such as:

`Full-Stack & AI Engineer - CCTV Line`

may be positioned as:

`Growth Systems & AI Automation Lead - CCTV Line`

The bullets may emphasize ecommerce growth infrastructure, product feeds, marketplaces, sales operations dashboards, support automation, and reporting. The factual anchors remain `CCTV Line`, real marketplace/listing scale, and real product/client context.

For an AI workflow JD, the same company can become:

`AI Workflow & Operations Automation Engineer - CCTV Line`

For a sales or digital marketing JD, `MTN Irancell`, `CCTV Line`, and `CodeNest` still appear, but their titles and bullets shift toward growth systems, revenue operations, marketplace/channel scale, CRM/reporting, automation, and product-led sales infrastructure.

Two searched companies in the same field can influence wording, for example by helping the model understand common terminology in fintech, telecom, ecommerce, martech, cybersecurity, or AI automation. They are not rendered as resume experience unless they already exist in the user's stored factual profile.

## Architecture

The main change belongs in `src/lib/resume/custom-resume-service.ts` around the JD analysis and resume template data assembly.

Introduce a small positioning layer with a clear boundary:

- `buildPositioningContext(profile, job, reqs, prefs, source)` decides whether aggressive JD shaping is enabled and prepares allowed terms.
- `buildRolePositioningInstructions(...)` tells the model which real roles/clients/products are available and how to reposition them.
- `normalizePositionedExperience(...)` preserves fixed anchors after the model returns: real company names, selected dates, selected products/clients, and ordering.
- `resolvePinnedRoles(...)` ensures `MTN Irancell`, `CCTV Line`, and `CodeNest` are included for manual tailoring when present in the profile.
- `buildMarketCalibrationContext(...)` accepts up to two searched field-relevant company names and short public descriptors, then exposes them to the model only as tone/domain vocabulary.

The existing employer guard remains, but it should no longer reject a rewritten role title just because it does not equal the stored title. It should still reject unknown company names.

The existing skill guard changes for manual mode:

- Evidence-backed skills are always allowed.
- JD terms are allowed for this generated resume when manual selection and broad expertise declaration are active.
- Permanent profile skills are not mutated.

The resume layout constraint changes from "roughly enough content" to an explicit two-page target. The generation and repair passes should optimize for full JD coverage inside two fixed pages, not unlimited description length. If the JD is very broad, the generator should use dense bullets and compact grouped skills rather than adding a third page.

## Data Flow

1. Load `candidate_profiles`, user email, preferences, job listing, and JD description.
2. Extract JD requirements with the existing `extractJobRequirements`.
3. Select real roles and real clients relevant to the JD, forcing `MTN Irancell`, `CCTV Line`, and `CodeNest` into the selected role set when available.
4. Build a positioning prompt:
   - fixed facts,
   - real roles and dates,
   - real clients/products,
   - JD requirements,
   - pinned companies that must appear,
   - two searched company names as field vocabulary only, when available,
   - the two-page limit,
   - allowed positioning rules.
5. Call the resume tailor model.
6. Repair missing JD coverage when needed.
7. Validate and normalize output:
   - company names must be from selected real roles,
   - dates come from planned periods, not the model,
   - role titles may be JD-shaped,
   - skills may include manual-mode JD terms,
   - unknown employers/products are removed.
8. Check page-fit heuristics before render or PDF generation. If content exceeds the fixed two-page target, compact bullets while preserving JD term coverage.
9. Render and save the per-job resume only.

## Field Company Search

Manual tailoring may use a search provider to find two recognizable companies in the JD's field. This is research context, not resume evidence.

The search input should be derived from the JD domain, title, and technologies. The output should be reduced to:

- company name,
- field/category,
- one short public descriptor,
- source URL if available.

The prompt must label this block as "market vocabulary only." The renderer must not create sections that imply the user worked with those companies.

If search is unavailable, slow, or low confidence, skip this block. Resume generation must still succeed.

The selected external company names should not be stored permanently on the user's profile. They may be stored only on the generated resume metadata later if debugging or auditability needs it.

## AI Provider

Tailored resume generation should use OpenAI/ChatGPT-family API models. The current gateway is already OpenAI-compatible and supports model IDs such as `gpt-4o-mini` and `gpt-5`.

Implementation should prefer the existing metered gateway path so billing, usage records, and model selection keep working. A deployment can point it at OpenAI directly by configuring the OpenAI-compatible base URL and model. If a separate direct OpenAI provider is added later, it should reuse the same `chatComplete` adapter shape and not duplicate prompt logic.

Recommended default for this feature is a higher-quality OpenAI model for resume tailoring, because the task requires structured rewriting, factual constraint following, and nuanced positioning. Cheaper models can remain available for parsing and scoring.

## Error Handling

If JD extraction fails, fall back to the current tailoring behavior with broad user emphasis.

If the model returns unknown employers, remove those entries or map them back only when they clearly refer to an existing company. Never create a new employer row in the resume.

If the model omits too many JD terms, run the existing repair pass with explicit missing terms.

If the model exceeds the two-page target, run a compaction repair pass that preserves required JD terms, pinned companies, and strongest proof points.

If a pinned company is missing from the model output, run a repair pass before saving.

If field-company search fails, omit the market calibration block and continue.

If the provider is not configured, return the existing paid-action configuration error path.

## Testing

Add focused tests around pure helpers in `custom-resume-service.ts`:

- Manual mode allows JD skills in generated resume skills without changing profile skills.
- Unknown employers are removed.
- Role titles can be rewritten while company names and periods stay fixed.
- Client/product names are only included from the user's stored preferences.
- Auto-apply or `source: "none"` remains stricter than manual mode.
- Manual mode always includes available pinned companies: `MTN Irancell`, `CCTV Line`, and `CodeNest`.
- Searched external company names appear only in prompt context or metadata, never as experience entries.
- Two-page compaction keeps JD coverage terms and removes lower-value prose first.

Add or adjust prompt tests if current prompt fixtures assert exact restrictive language about not adding unmentioned skills.

## Out Of Scope

This change does not add a UI for editing all broad expertise domains. It uses existing `preferences.declaredDomains`, `resumeEmphasis`, and manual job selection first.

This change does not automatically write JD skills back into the permanent profile. A later approval UI can show "skills used in this resume" and let the user save selected ones.

This change does not add fake client logos, fake partnerships, or fake references from searched external companies.
