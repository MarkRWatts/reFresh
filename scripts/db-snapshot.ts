import "dotenv/config";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

const OUT_FILE = path.join(process.cwd(), "db-backups", "refresh.dump");

function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL not set (check .env)");

  mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  const pgUrl = toPgUrl(databaseUrl);
  console.log(`Dumping ${redact(pgUrl)} -> ${OUT_FILE}`);
  // Custom format: compressed, and restorable with pg_restore --clean
  // without needing to hand-write DROP statements first.
  execFileSync("pg_dump", ["-d", pgUrl, "-Fc", "-f", OUT_FILE], { stdio: "inherit" });
  console.log("Snapshot written. Restore it on any machine with `npm run db:restore`.");
}

// Prisma's DATABASE_URL carries a `schema` query param that plain libpq
// tools (pg_dump/pg_restore) don't understand and reject outright.
function toPgUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.delete("schema");
  return url.toString();
}

function redact(url: string): string {
  return url.replace(/:[^:@]+@/, ":***@");
}

main();
