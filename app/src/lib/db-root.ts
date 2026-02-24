/**
 * Finds the `db/` folder regardless of what directory the Next.js process
 * was launched from. Walks up from process.cwd() until it finds a sibling
 * `db/` directory, so it works whether the server is started from:
 *   - inside app/          →  ../db/
 *   - the project root     →  db/
 *   - the Electron launcher with an arbitrary cwd
 *
 * Override with DB_ROOT env var if you need an explicit path.
 */
import fsSync from "node:fs";
import path from "node:path";

let _dbRoot: string | null = null;

export function dbRoot(): string {
  if (_dbRoot) return _dbRoot;

  // 1. Explicit env override (set in .env.local or passed by launcher)
  if (process.env.DB_ROOT) {
    const envPath = path.resolve(process.env.DB_ROOT);
    if (fsSync.existsSync(envPath)) {
      _dbRoot = envPath;
      return _dbRoot;
    }
  }

  // 2. Walk up from cwd until we find a db/ that contains unit_assets/
  //    (a plain db/ with only JSON files, e.g. a git worktree checkout, is skipped)
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, "db");
    if (fsSync.existsSync(path.join(candidate, "unit_assets"))) {
      _dbRoot = candidate;
      return _dbRoot;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }

  // 3. Fallback — callers handle missing files gracefully via try/catch
  _dbRoot = path.join(process.cwd(), "..", "db");
  return _dbRoot;
}
