const SITEMAP_URL = "https://www.hellofresh.co.uk/sitemap_recipe_pages.xml";
const USER_AGENT =
  "reFresh-personal-recipe-planner/0.1 (personal use, low-volume, contact: markrwatts@gmail.com)";

export interface SitemapEntry {
  url: string;
  lastmod: string | null;
}

/**
 * Parses a sitemaps.org urlset XML document into {url, lastmod} pairs.
 * The HelloFresh sitemap has no namespaces/CDATA quirks, so a tolerant
 * regex scan is far simpler than pulling in a full XML parser dependency.
 */
export function parseSitemapXml(xml: string): SitemapEntry[] {
  const entries: SitemapEntry[] = [];
  const urlBlockRegex = /<url>([\s\S]*?)<\/url>/g;
  let match: RegExpExecArray | null;

  while ((match = urlBlockRegex.exec(xml)) !== null) {
    const block = match[1];
    const locMatch = /<loc>([\s\S]*?)<\/loc>/.exec(block);
    if (!locMatch) continue;
    const lastmodMatch = /<lastmod>([\s\S]*?)<\/lastmod>/.exec(block);
    entries.push({
      url: locMatch[1].trim(),
      lastmod: lastmodMatch ? lastmodMatch[1].trim() : null,
    });
  }

  return entries;
}

export async function fetchSitemapEntries(): Promise<SitemapEntry[]> {
  const res = await fetch(SITEMAP_URL, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch sitemap: ${res.status} ${res.statusText}`);
  }
  const xml = await res.text();
  return parseSitemapXml(xml);
}

export { USER_AGENT };
