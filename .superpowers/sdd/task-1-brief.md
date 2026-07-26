### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.mjs`, `vitest.config.ts`, `.gitignore`, `.env.local.example`
- Create: `app/globals.css`, `app/layout.tsx`, `app/page.tsx`
- Create: `storage/audio/.gitkeep`, `data/.gitkeep`
- Create: `instrumentation.ts`

**Interfaces:**
- Produces: a runnable Next.js skeleton (`pnpm dev` starts server, `http://localhost:3000` shows placeholder), `pnpm typecheck` passes, `pnpm test:run` runs 0 tests successfully, `pnpm lint` passes.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "tuneamatic",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest",
    "test:run": "vitest run"
  },
  "dependencies": {
    "better-sqlite3": "^11.3.0",
    "nanoid": "^5.0.7",
    "next": "^14.2.5",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^20.14.0",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "eslint": "^8.57.0",
    "eslint-config-next": "^14.2.5",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create `next.config.mjs`**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["better-sqlite3"],
  },
};
export default nextConfig;
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 5: Create `.gitignore`**

```
node_modules/
.next/
.env.local
data/tuneamatic.db
data/tuneamatic.db-journal
storage/audio/*
!storage/audio/.gitkeep
*.log
```

- [ ] **Step 6: Create `.env.local.example`**

```
ACESTEP_API_URL=http://localhost:8001
ACESTEP_API_KEY=
```

- [ ] **Step 7: Create `app/globals.css`**

```css
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: system-ui, -apple-system, sans-serif;
  background: #fafafa;
  color: #1a1a1a;
  line-height: 1.5;
  padding-bottom: 80px; /* space for sticky player bar */
}

a {
  color: inherit;
  text-decoration: none;
}

button {
  font: inherit;
  cursor: pointer;
}
```

- [ ] **Step 8: Create `app/layout.tsx`**

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tuneamatic",
  description: "Generate songs with ACE-Step",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "1rem 2rem",
            borderBottom: "1px solid #e5e5e5",
            background: "white",
          }}
        >
          <strong>Tuneamatic</strong>
          <nav style={{ display: "flex", gap: "1rem" }}>
            <a href="/">Generate</a>
            <a href="/history">Library</a>
          </nav>
        </header>
        <main style={{ maxWidth: "800px", margin: "0 auto", padding: "2rem 1rem" }}>
          {children}
        </main>
      </body>
    </html>
  );
}
```

- [ ] **Step 9: Create `app/page.tsx`**

```tsx
export default function Home() {
  return (
    <div>
      <h1>Generate a song</h1>
      <p>Coming soon.</p>
    </div>
  );
}
```

- [ ] **Step 10: Create `instrumentation.ts`**

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startPoller } = await import("@/lib/poller");
    startPoller();
  }
}
```

- [ ] **Step 11: Create `.gitkeep` files**

```bash
mkdir -p storage/audio data
touch storage/audio/.gitkeep data/.gitkeep
```

- [ ] **Step 12: Install dependencies**

Run: `pnpm install`
Expected: dependencies install, no errors. (Ignore peer dependency warnings from `better-sqlite3` if any.)

- [ ] **Step 13: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: exit 0, no errors. (May warn about `next-env.d.ts` not existing yet — that's auto-generated on first `pnpm dev`/`pnpm build`; if typecheck fails solely due to missing `next-env.d.ts`, run `pnpm dev` once to generate it then `Ctrl-C` and retry.)

- [ ] **Step 14: Verify lint passes**

Run: `pnpm lint`
Expected: exit 0, no errors. (Next.js may prompt to configure ESLint on first run — answer yes, defaults are fine.)

- [ ] **Step 15: Verify test runner works**

Run: `pnpm test:run`
Expected: "No test files found", exit 0.

- [ ] **Step 16: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js project"
```