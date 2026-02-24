import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const sha = process.env.NEXT_PUBLIC_COMMIT_SHA ?? "dev";
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <div className="fixed bottom-2 right-3 font-mono text-[10px] text-zinc-600 select-none pointer-events-none">
          {sha}
        </div>
      </body>
    </html>
  );
}
