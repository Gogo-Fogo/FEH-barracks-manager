import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { join } from "path";

const { version } = JSON.parse(
  readFileSync(join(__dirname, "package.json"), "utf8")
) as { version: string };

const versionLabel = `v${String(version || "").trim() || "0.0.0"}`;

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  env: {
    NEXT_PUBLIC_VERSION_LABEL: versionLabel,
  },
};

export default nextConfig;
