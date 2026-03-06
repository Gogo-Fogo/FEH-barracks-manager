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
        {children}
        <div className="fixed bottom-2 right-3 font-mono text-[10px] text-zinc-600 select-none pointer-events-none">
          {versionLabel}
        </div>
      </body>
    </html>
  );
}
