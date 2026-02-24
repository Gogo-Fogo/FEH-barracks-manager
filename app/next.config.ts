import type { NextConfig } from "next";
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";

let versionLabel = "";
try {
  versionLabel = execSync("git describe --tags --always", { cwd: __dirname })
    .toString()
    .trim();
} catch {
  // fallback: package.json version + short SHA
  const { version } = JSON.parse(
    readFileSync(join(__dirname, "package.json"), "utf8")
  ) as { version: string };
  let sha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "";
  if (!sha) {
    try {
      sha = execSync("git rev-parse --short HEAD", { cwd: __dirname })
        .toString()
        .trim();
    } catch { /* ignore */ }
  }
  versionLabel = sha ? `v${version} · ${sha}` : `v${version}`;
}

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  env: {
    NEXT_PUBLIC_VERSION_LABEL: versionLabel,
  },
};

export default nextConfig;
