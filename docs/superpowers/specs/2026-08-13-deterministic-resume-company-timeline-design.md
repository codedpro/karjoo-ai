# Deterministic Resume Company Timeline

## Objective

Every generated resume that uses the fixed and domain-variable company set must show the same six chronological employment slots. The AI may rewrite titles, responsibilities, and achievements for the target job description, but it must never choose company dates, reorder employers, create overlaps, or mark multiple roles as current.

## Canonical Timeline

The timeline is oldest to newest:

1. Iranian variable company: 2018–2019
2. Code Nest: 2019–2021
3. UK Trade Line: 2021–2022
4. CCTVline: 2022–2024
5. International variable company: 2024–2025
6. MTN Irancell: 2025–Present

The Iranian and international names come from the existing domain-specific pair selected for the job. Their regions determine their slots; their names do not affect dates.

## Enforcement

A single deterministic timeline resolver will own slot order, dates, ranking, and current status. Existing aliases such as `CodeNest`, `Code Nest`, `CCTV Line`, and company names with suffixes such as `(UK)` or `(International)` must resolve to their canonical slot.

The resolver will be applied to the selected roles before prompt construction. The generated timeline instruction will contain the same exact schedule. After AI generation, the existing normalization and repair path will reapply the schedule and sort rendered experience by canonical rank, making code rather than the model authoritative.

MTN Irancell is the only role with `current: true` and a `Present` end. Every other role has `current: false` and its fixed end year.

## Scope

This change affects generated fixed/variable experience timelines only. It does not alter domain inference, which variable pair is selected, role titles, job-description positioning, technology-placement restrictions, or user-entered employment history outside this generated flow.

## Validation

Tests will verify:

- The exact six-slot order and approved dates.
- No date overlap and no gap introduced by model output.
- MTN Irancell is the only current role.
- Every variable-company domain pair uses the Iranian name in the oldest slot and international name immediately before MTN Irancell.
- Fixed-company aliases resolve to the same slots.
- Prompt instructions and post-generation normalized output agree.
