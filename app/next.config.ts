import type { NextConfig } from "next";
import { execSync } from "child_process";

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

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  env: {
    NEXT_PUBLIC_COMMIT_SHA: commitSha,
  },
};

export default nextConfig;
