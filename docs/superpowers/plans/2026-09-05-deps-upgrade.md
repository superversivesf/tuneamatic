# Dependency Security Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear all 38 `pnpm audit` vulnerabilities (26 prod, 12 dev) by upgrading to the Next 15.5 security line (Next 15.5.21, React 19, eslint 10 flat config, vitest 5) with zero behavioral regression.

**Architecture:** One green commit for deps + code migrations (neither half is green alone), then the eslint flat-config rewrite, then docs. The existing 66-test suite is the regression net; the only expected test edits are `params` object → `Promise` at route-call sites.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript 5.9, eslint 10 (flat), vitest 5, better-sqlite3 13.

## Global Constraints

- Every commit must pass: `pnpm test:run && pnpm typecheck && pnpm lint` (66/66 tests at time of writing)
- Final verification: `pnpm audit` reports **0 vulnerabilities**; `pnpm build` runs clean; `pnpm dev` smoke-boots with the poller-started log line
- Exact versions: `next@15.5.21`, `eslint-config-next@15.5.21`, `eslint@^10.9.1`, `react@^19.2.8`, `react-dom@^19.2.8`, `vitest@^5.0.0`, `@types/better-sqlite3@^9.6.0`, `@types/node@^22`, `@types/react@^19`, `@types/react-dom@^19`, `globals` (dev, latest)
- Add `"engines": { "node": ">=20.9 <23" }` to package.json
- No `pnpm.overrides` unless `pnpm audit` is nonzero after bumps (fallback, not goal)
- `--hostname 0.0.0.0` dev binding stays
- `nanoid` stays `^5.0.7`; `typescript` stays 5.9; `better-sqlite3` stays `^13.0.1`
- Spec: `docs/superpowers/specs/2026-09-05-deps-upgrade-design.md` (authoritative)

---

### Task 1: Deps bump + Next 15 code migrations (one green commit)

**Files:**
- Modify: `package.json`
- Modify: `next.config.mjs` (whole file)
- Modify: `app/api/songs/[id]/route.ts` (GET + DELETE signatures)
- Modify: `app/api/audio/[id]/route.ts` (GET signature)
- Modify: `app/components/PlayerProvider.tsx:7` (RefObject type)
- Modify: `tests/api-songs.test.ts` (params call sites)
- Modify: `tests/api-generate.test.ts` (only if it calls route handlers with params — verify; generate takes none, expect no change)
- Regenerate: `pnpm-lock.yaml` (via install)

**Interfaces:**
- Consumes: existing route handler bodies (unchanged logic); existing test assertions (unchanged expectations)
- Produces: route handlers whose second arg is `{ params }: { params: Promise<{ id: string }> }` — tests construct these with `Promise.resolve({ id })`

- [ ] **Step 1: Edit package.json dependencies**

```json
{
  "dependencies": {
    "better-sqlite3": "^13.0.1",
    "nanoid": "^5.0.7",
    "next": "15.5.21",
    "react": "^19.2.8",
    "react-dom": "^19.2.8"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^9.6.0",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "eslint": "^8.57.0",
    "eslint-config-next": "15.5.21",
    "globals": "^16.0.0",
    "typescript": "^5.5.4",
    "vitest": "^5.0.0"
  },
  "engines": { "node": ">=20.9 <23" }
}
```

(Keep the existing `"scripts"` and other fields exactly as they are. `globals` is added now so the eslint task only edits config. `eslint` stays at 8 in this commit — the flat-config task bumps it.)

- [ ] **Step 2: Install and regenerate the lockfile**

```bash
pnpm install
```

Expected: install succeeds (this also rebuilds better-sqlite3 against the current Node if needed). If install fails on `@types/node@^22` peer conflicts, try `pnpm install --no-strict-peer-dependencies` and report the conflict — do not force resolutions you don't understand.

- [ ] **Step 3: Migrate `next.config.mjs` (whole file replacement)**

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["better-sqlite3"],
};
export default nextConfig;
```

(`experimental.serverComponentsExternalPackages` moved to top-level `serverExternalPackages`; `experimental.instrumentationHook` is gone — instrumentation is stable in 15.)

- [ ] **Step 4: Migrate the two `[id]` route files to async params**

In `app/api/songs/[id]/route.ts`, change both handlers' signatures and first lines:

```typescript
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  const db = getDb();
  const song = getSong(db, id);
```

and:

```typescript
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const db = getDb();
  const song = getSong(db, id);
```

Replace every remaining `params.id` reference inside both bodies with the destructured `id` (GET has one more use; DELETE has `deleteSong(db, params.id)` → `deleteSong(db, id)`).

In `app/api/audio/[id]/route.ts`, same transformation for GET only:

```typescript
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  const db = getDb();
  const song = getSong(db, id);
```

and `params.id` → `id` where used (the only use is the `getSong` call).

- [ ] **Step 5: Widen RefObject in `app/components/PlayerProvider.tsx`**

Line 7 of the interface:

```typescript
  audioRef: React.RefObject<HTMLAudioElement | null>;
```

(The `useRef<HTMLAudioElement>(null)` on line 15 is unchanged; React 19 types make it return `RefObject<HTMLAudioElement | null>`.)

- [ ] **Step 6: Update test call sites to pass Promises**

In `tests/api-songs.test.ts`, every handler invocation passes a `params` object. Change each to `Promise.resolve(...)`:

```typescript
const res = await getSong(req, { params: Promise.resolve({ id }) });
```

Apply the same to: the 404 GET test (`{ params: Promise.resolve({ id: "nope" }) }`), both DELETE tests, all four range tests in the audio describe (they call `GET_AUDIO(req, { params: { id: testId } })` → `{ params: Promise.resolve({ id: testId }) }`), and the DELETE origin-guard tests. Search the file for `{ params: ` and convert every occurrence — there are roughly 9.

In `tests/api-generate.test.ts`: the POST handler takes no params; verify no `params` usage exists (grep) — no change expected.

- [ ] **Step 7: Run the gates**

```bash
pnpm test:run && pnpm typecheck && pnpm lint
```

Expected: 66/66 pass, tsc clean, `next lint` still works (eslint-config-next 15 supports the legacy `next lint` path with `.eslintrc.json` still present — the flat rewrite is the NEXT task).

If tests fail with type errors like "Property 'id' does not exist on type Promise", a params call site was missed — grep tests for `{ params: {` again. If `pnpm lint` fails because eslint-config-next 15 no longer supports eslint 8's eslintrc format, proceed to Task 2's config work but keep both in one commit per the spec's structure is NOT allowed — instead: if `next lint` is broken at this point, bump `eslint` to `^10.9.1` and do the Task 2 config as part of THIS commit (the spec's one-green-commit principle governs; a red intermediate gate is worse).

- [ ] **Step 8: Verify audit count is on track**

```bash
pnpm audit --prod 2>&1 | tail -2
```

Expected: 0 production vulnerabilities. If any remain, identify the package and add the minimal `pnpm.overrides` entry to package.json (spec's documented fallback), then re-run install + gates.

- [ ] **Step 9: Commit**

```bash
git add package.json pnpm-lock.yaml next.config.mjs "app/api/songs/[id]/route.ts" "app/api/audio/[id]/route.ts" app/components/PlayerProvider.tsx tests/api-songs.test.ts
git commit -m "fix(deps): next 15.5 + react 19 + vitest 5 — async params migration, clear 26 prod vulns"
```

(If the eslint bump + flat config had to fold in per Step 7's escape hatch, use message `fix(deps): next 15.5 + react 19 + eslint 10 flat config + vitest 5 — async params migration, clear all 38 vulns` and skip Task 2.)

---

### Task 2: ESLint 10 flat config

**Files:**
- Create: `eslint.config.mjs`
- Delete: `.eslintrc.json`
- Modify: `package.json` (scripts.lint, eslint version if not already bumped)

**Interfaces:**
- Consumes: `eslint-config-next@15.5.21` flat exports, `globals` package
- Produces: `"lint": "eslint ."` script; flat config scoping browser globals to `app/`, node globals to `lib/`, `tests/`, `scripts/`

- [ ] **Step 1: Write `eslint.config.mjs` (complete file)**

```javascript
import globals from "globals";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

export default [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    files: ["app/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["lib/**/*.{ts,mts}", "tests/**/*.ts", "scripts/**/*.{sh,py}", "instrumentation.ts", "*.mjs"],
    languageOptions: { globals: globals.node },
  },
  {
    ignores: [".next/**", "node_modules/**", ".worktrees/**", "data/**", "storage/**", "samples/**", "next-env.d.ts"],
  },
];
```

If `@eslint/eslintrc` or `globals` are not present in the dependency tree after Task 1's install, add them as dev dependencies (`pnpm add -D @eslint/eslintrc globals`). `FlatCompat` is the officially documented migration path for `eslint-config-next` under eslint 10.

- [ ] **Step 2: Delete legacy config, update package.json**

```bash
git rm .eslintrc.json
```

In `package.json`:
- `"lint": "next lint"` → `"lint": "eslint ."`
- If eslint was not bumped in Task 1: `"eslint": "^8.57.0"` → `"eslint": "^10.9.1"`

- [ ] **Step 3: Run lint and fix findings it surfaces**

```bash
pnpm lint
```

Expected: clean pass, possibly after addressing NEW rules that fire (flat config + eslint 10 enables stricter parsing). Two known-likely findings and their fixes:
- `require()` of ESLint config in `.eslintrc` — gone with the file
- `next-env.d.ts` or `vitest.config.ts` flagged under `next/typescript` — add `ignores` entries rather than disabling rules
Do NOT add `eslint-disable` comments; tune the config's `files`/`ignores` instead.

- [ ] **Step 4: Full gates**

```bash
pnpm test:run && pnpm typecheck && pnpm lint && pnpm audit 2>&1 | tail -2
```

Expected: 66/66, tsc clean, lint clean, `0 vulnerabilities` (all severities, dev included — vitest 5 cleared esbuild, eslint 10 cleared js-yaml/brace-expansion/glob).

- [ ] **Step 5: Commit**

```bash
git add eslint.config.mjs package.json pnpm-lock.yaml
git commit -m "chore: eslint 10 flat config, remove legacy .eslintrc.json, lint script to eslint ."
```

---

### Task 3: Docs + final verification

**Files:**
- Modify: `README.md` (prerequisites line)
- Modify: `AUDIT.md` (status append)

**Interfaces:**
- Consumes: nothing new
- Produces: docs matching the new stack

- [ ] **Step 1: Update README prerequisites**

Change:

```markdown
- Node.js 18+ and pnpm
```

to:

```markdown
- Node.js 20.9+ and pnpm
```

and append to the Setup section, after the `pnpm install` line's code block (the "Clone and install Tuneamatic" step), a note:

```markdown
> If you switch Node.js major versions, run `pnpm rebuild better-sqlite3`.
```

- [ ] **Step 2: Append AUDIT.md status line**

After the existing `**Status 2026-09-04:**` block, add:

```markdown
**Status 2026-09-05:** Dependency-tier findings reported by Dependabot post-merge (38 npm audit vulnerabilities, 26 production incl. 21 unpatchable-in-14 Next.js advisories) cleared via the Next 15.5.21 / React 19 / eslint 10 / vitest 5 upgrade — see `docs/superpowers/specs/2026-09-05-deps-upgrade-design.md`.
```

- [ ] **Step 3: Full final verification battery**

```bash
pnpm test:run && pnpm typecheck && pnpm lint && pnpm audit 2>&1 | tail -2 && pnpm build 2>&1 | tail -5
```

Expected, in order: 66/66 tests; clean tsc; clean lint; `0 vulnerabilities`; successful production build (the FIRST compile against Next 15 — this validates `serverExternalPackages` and the async-params types end-to-end).

- [ ] **Step 4: Dev-server smoke boot**

```bash
timeout 25 pnpm dev 2>&1 | head -30
```

Expected output includes: Next 15 banner on port 5433, `[instrumentation] register() called`, `[instrumentation] poller started, janitor removed N orphaned files` — then the timeout kills it (exit 124 is fine). If instrumentation doesn't run, check `instrumentation.ts` is still auto-detected (no config flag needed in 15) and that `NEXT_RUNTIME=nodejs` still reaches the startPoller branch.

- [ ] **Step 5: Commit and push**

```bash
git add README.md AUDIT.md
git commit -m "docs: node 20.9 floor, better-sqlite3 rebuild note, audit status"
git push
```

(Push is included in this task because the user explicitly requested "commit and push everything" for this dependency work.)