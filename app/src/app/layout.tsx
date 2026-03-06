import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import appPackage from "../../package.json";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FEH Barracks Manager",
  description: "Shared FEH barracks app",
};

function resolveVersionLabel() {
  const raw = String(process.env.NEXT_PUBLIC_VERSION_LABEL || "").trim();
  if (/^v?\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/i.test(raw)) {
    return raw.startsWith("v") ? raw : `v${raw}`;
  }

  const pkgVersion = String(appPackage.version || "").trim();
  if (/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/i.test(pkgVersion)) {
    return `v${pkgVersion}`;
  }

  return "dev";
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const versionLabel = resolveVersionLabel();
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <div className="flex min-h-screen flex-col">
          <div className="flex-1">{children}</div>
          <footer className="border-t border-zinc-800/80 bg-zinc-950/96 px-3 py-3 text-[11px] text-zinc-400 sm:px-5">
            <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1 leading-relaxed">
                <p>
                  Sources:{" "}
                  <a
                    href="https://game8.co/games/fire-emblem-heroes"
                    target="_blank"
                    rel="noreferrer"
                    className="text-sky-300 transition hover:text-sky-200"
                  >
                    Game8
                  </a>{" "}
                  for hero/unit data,{" "}
                  <a
                    href="https://feheroes.fandom.com/wiki/List_of_Heroes"
                    target="_blank"
                    rel="noreferrer"
                    className="text-sky-300 transition hover:text-sky-200"
                  >
                    FE Heroes Wiki / Fandom
                  </a>{" "}
                  for art and quotes,{" "}
                  <a
                    href="https://fire-emblem-heroes.com/en/topics/"
                    target="_blank"
                    rel="noreferrer"
                    className="text-sky-300 transition hover:text-sky-200"
                  >
                    official FEH news
                  </a>
                  , and YouTube for the recent FEH video feed. Fire Emblem Heroes and related assets belong to Nintendo / Intelligent Systems.
                </p>
                <p className="text-zinc-500">
                  Created by{" "}
                  <a
                    href="https://tsvetanski.com"
                    target="_blank"
                    rel="noreferrer"
                    className="text-zinc-300 transition hover:text-white"
                  >
                    Georgi Tsvetanski
                  </a>
                  {" "}•{" "}
                  <a
                    href="https://tsvetanski.com"
                    target="_blank"
                    rel="noreferrer"
                    className="text-zinc-300 transition hover:text-white"
                  >
                    tsvetanski.com
                  </a>
                </p>
              </div>
              <div className="shrink-0 font-mono text-[10px] text-zinc-500">{versionLabel}</div>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
