import type { NextConfig } from "next";
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";

let commitSha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "";
if (!commitSha) {
  try {
    commitSha = execSync("git rev-parse --short HEAD", { cwd: __dirname })
      .toString()
      .trim();
  } catch {
    commitSha = "unknown";
  }
}

const { version } = JSON.parse(
  readFileSync(join(__dirname, "package.json"), "utf8")
) as { version: string };

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  env: {
    NEXT_PUBLIC_COMMIT_SHA: commitSha,
    NEXT_PUBLIC_APP_VERSION: version,
  },
};

export default nextConfig;
