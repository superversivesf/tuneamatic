# Tuneamatic Dependency Security Upgrade — Design Spec

**Date:** 2026-09-05
**Status:** Approved
**Project:** Tuneamatic — clear all 38 Dependabot/npm audit findings (26 production, 12 dev-only) by moving to the Next 15.5 security line
**Prior specs:** `docs/superpowers/specs/2026-07-26-tuneamatic-design.md` (original app), `docs/superpowers/specs/2026-09-04-audit-fixes-design.md` (code audit remediation)

## Goal

Eliminate every vulnerability reported by `pnpm audit` (38: 2 low, 16 moderate, 19 high, 1 critical) without regressing the app's behavior or its 66-test suite. The dominant cause is `next@14.2.35` (21 advisories with no patched 14.x — Next 14 is EOL for security fixes); clearing them requires Next 15.5.x, which the user has approved as the upgrade posture ("Next 15.5 line") along with clearing the 12 dev-chain findings ("Full clear").

## Scope decisions (approved by user)

- **Next 15.5 line** — not Next 16, not overrides-only.
- **Full clear** — dev-only vulnerabilities included: vitest 2→5 bump and eslint 10 flat-config rewrite.
- The `--hostname 0.0.0.0` dev binding stays (deliberate, prior decision; origin guard from the audit pass mitigates).

## Approach

Single branch, 3 commits in dependency order: (1) dependency bumps + lockfile + all Next 15 code migrations in ONE green commit (neither half is independently green — deps bump alone breaks compilation until the async-params migration lands), (2) eslint flat-config rewrite, (3) docs. Existing 66-test suite is the regression net.

## 1. Dependency changes (`package.json`)

| Package | From | To | Rationale |
|---|---|---|---|
| `next` | `^14.2.5` | `15.5.21` (pinned exact) | Clears 21 advisories; pin the security line for tracking |
| `react` / `react-dom` | `^18.3.1` | `^19.2.8` | Next 15 requires React 19 |
| `eslint-config-next` | `^14.2.5` | `15.5.21` (pinned, matching next) | Lint rules matching framework version |
| `eslint` | `^8.57.0` | `^10.9.1` | Clears js-yaml/brace-expansion/glob transitives; flat-config era |
| `vitest` | `^2.0.5` | `^5.0.0` | Clears esbuild transitive; drop-in for this suite |
| `@types/better-sqlite3` | `^7.6.13` | `^9.6.0` | Match better-sqlite3 13 |
| `@types/node` | `^20.14.0` | `^22` | Node LTS floor for engines |
| `@types/react` / `@types/react-dom` | `^18` | `^19` | Match React 19 |
| `globals` | — | new dev dep | Required by flat config (browser/node globals) |
| `better-sqlite3` | `^13.0.1` | `^13.0.3` (same range, re-resolve) | Patch-level only |
| `nanoid` | `^5.0.7` | unchanged | 5.1.16 is clean; the vulnerable 3.3.16 is postcss's transitive, fixed by Next 15's postcss ≥8.5 |
| `typescript` | `5.9` | unchanged | TS 7 not required |

Add `"engines": { "node": ">=20.9 <23" }` — Next 15 floor + better-sqlite3 13 prebuild availability; also closes AUDIT.md #13's missing-engines note.

No `pnpm.overrides` needed once the direct bumps land: `next@15.5.21` brings `postcss@8.5.x` (fixing its 4 advisories + its `nanoid@3` transitive), and the dev bumps clear their own chains. **Verification requirement: `pnpm audit` must report 0 vulnerabilities at the end; if any transitive still resolves vulnerable (lockfile residue), a minimal `pnpm.overrides` entry is the fallback, not a goal.**

## 2. Next 15 code migrations

All confirmed against the actual code before this spec was written:

1. **Route `params` become Promises** (App Router async request APIs):
   - `app/api/songs/[id]/route.ts` — GET + DELETE: `{ params }: { params: { id: string } }` → `const { id } = await params;` with `params: Promise<{ id: string }>` typing.
   - `app/api/audio/[id]/route.ts` — GET: same transformation.
   - `app/api/generate/route.ts` — no params; untouched.
   - Tests passing `{ params: { id } }` objects change to `Promise.resolve({ id })`: `tests/api-songs.test.ts` (GET/DELETE helpers), plus any `api-generate.test.ts` call sites (none expected — generate takes no params).
2. **`next.config.mjs`**: `experimental.serverComponentsExternalPackages` → top-level `serverExternalPackages: ["better-sqlite3"]` (better-sqlite3 must stay external to the server bundle); remove `experimental.instrumentationHook` (stable in 15, flag gone).
3. **`RefObject` typing** (`app/components/PlayerProvider.tsx:7,15`): React 19's `useRef<HTMLAudioElement>(null)` returns `RefObject<HTMLAudioElement | null>`; widen the context interface to `React.RefObject<HTMLAudioElement | null>`. One-line change; `audioRef.current` null-checks already guard every use.
4. **`instrumentation.ts`** — unchanged (register() hook API stable in 15).

## 3. ESLint flat config (new `eslint.config.mjs`, delete `.eslintrc.json`)

- Export an array: `eslint-config-next`'s flat entry (`coreWebVitals` + `typescript` from `eslint-config-next`'s flat exports), plus `globals.browser` for `app/**` and `globals.node` for `lib/`, `tests/`, `scripts/` dirs via scoped `files` blocks.
- Lint script: `next lint` is deprecated in 15 (removed in 16) → change `"lint": "next lint"` to `"lint": "eslint ."`.
- Flat config is inherently root-scoped: the Task-0 worktree cascade issue disappears by construction (no `.eslintrc.json` left to cascade).
- `.gitignore`/`next-env.d.ts` untouched.

## 4. Docs

- README prerequisites: "Node.js 18+" → "Node.js 20.9+"; add "pnpm rebuild better-sqlite3" note if Node major changes (pre-existing audit recommendation, now cheap to include).
- AUDIT.md status note: append one line that the dependency-tier findings (raised by Dependabot post-merge) were cleared 2026-09-05 via the Next 15.5 upgrade.

## Testing strategy

- The existing 66 tests are the regression net: they cover db invariants, poller serialization, client behavior, all API routes (origin guard, validation, range parsing), janitor.
- Expected test edits: only the `params`-object → Promise change in route-call sites.
- Gates: `pnpm test:run && pnpm typecheck && pnpm lint` after every commit.
- Final verification: `pnpm audit` → 0; `pnpm build` → clean (first compile against Next 15; catches type/JSX issues the test suite doesn't, and validates `serverExternalPackages`).
- One `pnpm dev` smoke boot at the end: poller started + janitor log line present (verifies instrumentation hook in 15).

## Out of scope

- Next 16, eslint 11+, TypeScript 7, vitest beyond 5 — no findings require them (YAGNI).
- Any refactor of app behavior beyond the migration surface above.
- Upgrading the sibling ACE-Step Python server (out of repo).
- Renovate/Dependabot config changes beyond this one-time bump.

## Commit sequence (single branch)

1. `fix(deps): next 15.5 + react 19 + vitest 5 + eslint 10 — code migrations for async params, flat-config-ready` (deps + lockfile + all code/test/config migrations)
2. `chore: eslint 10 flat config, remove legacy .eslintrc.json, lint script to eslint .`
3. `docs: node 20.9 floor, better-sqlite3 rebuild note, audit status`

**Reference:** `pnpm audit` output snapshot and version research in the conversation record; AUDIT.md for the code-level context of what's already been hardened.