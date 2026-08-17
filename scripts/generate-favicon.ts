import { writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const APP_DIR = path.join(process.cwd(), "src", "app");
const BRAND_DIR = path.join(process.cwd(), "src", "lib", "brand");
const MASTER = path.join(process.cwd(), "public", "brand", "refresh-icon.png");

// Pre-cut 16/32/48px renditions of the icon, kept as separate source files
// (rather than resized from the master here) because they carry their own
// hand-tuned transparency around the rounded-square mark — resizing the
// opaque master would fill their corners in solid instead of cutting them
// out.
const ICO_SOURCES = [
  { size: 16, file: "icon-16.png" },
  { size: 32, file: "icon-32.png" },
  { size: 48, file: "icon-48.png" },
];

/**
 * Packs PNG buffers into a multi-resolution .ico container (ICONDIR +
 * ICONDIRENTRY[] + raw PNG data per entry — the modern "PNG-in-ICO" format
 * every browser/OS built since Vista accepts). Hand-rolled instead of
 * pulling in a library: the only npm option (`to-ico`) drags in a long
 * unmaintained `jimp`/`request` dependency chain just for this ~30-line
 * binary format.
 */
function packIco(pngs: { size: number; data: Buffer }[]): Buffer {
  const headerSize = 6;
  const entrySize = 16;
  const dirSize = headerSize + entrySize * pngs.length;

  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: 1 = icon
  header.writeUInt16LE(pngs.length, 4);

  const entries: Buffer[] = [];
  const images: Buffer[] = [];
  let offset = dirSize;

  for (const { size, data } of pngs) {
    const entry = Buffer.alloc(entrySize);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height (0 = 256)
    entry.writeUInt8(0, 2); // color count (0 = no palette)
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8); // image data size
    entry.writeUInt32LE(offset, 12); // offset from file start
    entries.push(entry);
    images.push(data);
    offset += data.length;
  }

  return Buffer.concat([header, ...entries, ...images]);
}

async function main() {
  const pngs = ICO_SOURCES.map(({ size, file }) => ({
    size,
    data: readFileSync(path.join(BRAND_DIR, file)),
  }));
  writeFileSync(path.join(APP_DIR, "favicon.ico"), packIco(pngs));
  console.log(`Wrote src/app/favicon.ico (${ICO_SOURCES.map((s) => s.size).join("/")}px).`);

  // Apple's touch-icon convention wants an opaque square (iOS applies its
  // own corner rounding/shadow) — the master has no alpha channel, so it's
  // used directly here rather than one of the transparent small cuts.
  const appleIcon = await sharp(MASTER).resize(180, 180).png().toBuffer();
  writeFileSync(path.join(APP_DIR, "apple-icon.png"), appleIcon);
  console.log("Wrote src/app/apple-icon.png (180px, from the master).");
}

main();
