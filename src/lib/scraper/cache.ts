import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const CACHE_DIR = path.join(process.cwd(), ".cache", "hellofresh");
const HTML_DIR = path.join(CACHE_DIR, "html");
const MANIFEST_PATH = path.join(CACHE_DIR, "manifest.json");

export interface ManifestEntry {
  lastmod: string | null;
  scrapedAt: string;
  status: "ok" | "error";
  error?: string;
}

type Manifest = Record<string, ManifestEntry>;

let manifestCache: Manifest | null = null;

async function ensureDirs() {
  await mkdir(HTML_DIR, { recursive: true });
}

export async function loadManifest(): Promise<Manifest> {
  if (manifestCache) return manifestCache;
  await ensureDirs();
  if (!existsSync(MANIFEST_PATH)) {
    manifestCache = {};
    return manifestCache;
  }
  const raw = await readFile(MANIFEST_PATH, "utf-8");
  manifestCache = JSON.parse(raw) as Manifest;
  return manifestCache;
}

export async function saveManifestEntry(url: string, entry: ManifestEntry) {
  const manifest = await loadManifest();
  manifest[url] = entry;
  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf-8");
}

/** Slugify a sitemap URL into a filesystem-safe cache key. */
function cacheKeyForUrl(url: string): string {
  const { pathname } = new URL(url);
  return pathname.replace(/^\/+|\/+$/g, "").replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function htmlCachePath(url: string): string {
  return path.join(HTML_DIR, `${cacheKeyForUrl(url)}.html`);
}

export async function readCachedHtml(url: string): Promise<string | null> {
  const filePath = htmlCachePath(url);
  if (!existsSync(filePath)) return null;
  return readFile(filePath, "utf-8");
}

export async function writeCachedHtml(url: string, html: string): Promise<void> {
  await ensureDirs();
  await writeFile(htmlCachePath(url), html, "utf-8");
}

/**
 * Whether a sitemap URL can be skipped this run: we've already scraped it
 * successfully before and its lastmod hasn't changed since.
 */
export async function isUpToDate(url: string, lastmod: string | null): Promise<boolean> {
  const manifest = await loadManifest();
  const entry = manifest[url];
  if (!entry || entry.status !== "ok") return false;
  if (entry.lastmod === null || lastmod === null) return false;
  return entry.lastmod === lastmod && existsSync(htmlCachePath(url));
}
