import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { PlayerProvider } from "@/app/components/PlayerProvider";
import { PlayerBar } from "@/app/components/PlayerBar";

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
        <PlayerProvider>
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
              <Link href="/">Generate</Link>
              <Link href="/history">Library</Link>
            </nav>
          </header>
          <main style={{ maxWidth: "800px", margin: "0 auto", padding: "2rem 1rem" }}>
            {children}
          </main>
          <PlayerBar />
        </PlayerProvider>
      </body>
    </html>
  );
}