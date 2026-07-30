import "dotenv/config";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const IN_FILE = path.join(process.cwd(), "db-backups", "refresh.dump");

function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL not set (check .env)");
  if (!existsSync(IN_FILE)) {
    throw new Error(`No snapshot at ${IN_FILE} — run "npm run db:snapshot" first, or copy one there.`);
  }

  const pgUrl = toPgUrl(databaseUrl);
  console.log(`Restoring ${IN_FILE} -> ${redact(pgUrl)}`);
  console.log("(Target database must already exist, e.g. `createdb refresh_dev` — this restores objects/data into it.)");
  // --clean/--if-exists: drop existing objects first (no-op on an empty
  // db) so this is safe to run repeatedly. --no-owner: don't fight over
  // role ownership if restoring on a different machine/user.
  execFileSync(
    "pg_restore",
    ["-d", pgUrl, "--clean", "--if-exists", "--no-owner", IN_FILE],
    { stdio: "inherit" },
  );
  console.log("Restore complete.");
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
