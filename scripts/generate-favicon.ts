import { writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { LOGO_SVG_BODY, LOGO_VIEW_BOX } from "../src/lib/brand/logo";

const APP_DIR = path.join(process.cwd(), "src", "app");
const ICON_SIZES = [16, 32, 48];

function standaloneSvg(): string {
  return `<svg viewBox="${LOGO_VIEW_BOX}" xmlns="http://www.w3.org/2000/svg">\n${LOGO_SVG_BODY}\n</svg>\n`;
}

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
  const svg = standaloneSvg();

  writeFileSync(path.join(APP_DIR, "icon.svg"), svg);
  console.log("Wrote src/app/icon.svg (modern SVG favicon).");

  const pngs = await Promise.all(
    ICON_SIZES.map(async (size) => ({
      size,
      data: await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer(),
    })),
  );

  const ico = packIco(pngs);
  writeFileSync(path.join(APP_DIR, "favicon.ico"), ico);
  console.log(`Wrote src/app/favicon.ico (${ICON_SIZES.join("/")}px).`);
}

main();
