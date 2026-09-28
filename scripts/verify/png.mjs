/**
 * Minimal PNG reader for the pixels the release checks measure.
 *
 * Only what Chrome's `Page.captureScreenshot` emits is supported: 8-bit,
 * non-interlaced, greyscale/RGB/RGBA. That is enough to measure composited
 * contrast without adding an image dependency to the workspace.
 */
import { inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error("Not a PNG");

  let offset = 8;
  let header = null;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const start = offset + 8;

    if (type === "IHDR") {
      header = {
        width: buffer.readUInt32BE(start),
        height: buffer.readUInt32BE(start + 4),
        bitDepth: buffer[start + 8],
        colorType: buffer[start + 9],
        interlace: buffer[start + 12],
      };
    } else if (type === "IDAT") {
      idat.push(buffer.subarray(start, start + length));
    } else if (type === "IEND") {
      break;
    }
    offset = start + length + 4; // skip the CRC
  }

  if (!header) throw new Error("PNG has no IHDR");
  if (header.bitDepth !== 8) throw new Error(`Unsupported PNG bit depth ${header.bitDepth}`);
  if (header.interlace !== 0) throw new Error("Interlaced PNG is not supported");
  const channels = CHANNELS[header.colorType];
  if (!channels) throw new Error(`Unsupported PNG colour type ${header.colorType}`);

  const { width, height } = header;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);

  // Reverse the per-scanline filters PNG applies before compression.
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const prior = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;

    for (let x = 0; x < stride; x += 1) {
      const rawByte = line[x];
      const left = x >= channels ? out[x - channels] : 0;
      const up = prior ? prior[x] : 0;
      const upLeft = prior && x >= channels ? prior[x - channels] : 0;

      let value;
      switch (filter) {
        case 0: value = rawByte; break;
        case 1: value = rawByte + left; break;
        case 2: value = rawByte + up; break;
        case 3: value = rawByte + ((left + up) >> 1); break;
        case 4: {
          const p = left + up - upLeft;
          const dl = Math.abs(p - left);
          const du = Math.abs(p - up);
          const dul = Math.abs(p - upLeft);
          const predictor = dl <= du && dl <= dul ? left : du <= dul ? up : upLeft;
          value = rawByte + predictor;
          break;
        }
        default: throw new Error(`Unknown PNG filter ${filter}`);
      }
      out[x] = value & 0xff;
    }
  }

  return { width, height, channels, pixels };
}

/** WCAG 2.x relative luminance from 8-bit sRGB. */
export function relativeLuminance([r, g, b]) {
  const channel = (value) => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.x contrast ratio between two relative luminances. */
export function contrastRatio(luminanceA, luminanceB) {
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);
  return (lighter + 0.05) / (darker + 0.05);
}

export const ratioAgainst = (rgb, background) =>
  contrastRatio(relativeLuminance(rgb), relativeLuminance(background));

/** Parses `#rgb`, `#rrggbb` or `rgb(a)` into 8-bit channels. */
export function parseColor(value) {
  const text = value.trim();
  if (text.startsWith("#")) {
    const hex = text.slice(1);
    const expand = hex.length === 3 ? hex.split("").map((c) => c + c) : hex.match(/../g);
    if (!expand || expand.length < 3) throw new Error(`Unparseable colour ${value}`);
    return expand.slice(0, 3).map((pair) => parseInt(pair, 16));
  }
  const match = text.match(/-?[\d.]+/g);
  if (!match) throw new Error(`Unparseable colour ${value}`);
  return match.slice(0, 3).map((n) => Math.max(0, Math.min(255, Math.round(Number(n)))));
}

/**
 * Contrast of `textRgb` against every composited pixel in `image`.
 * The headline is a solid colour over a moving background, so the strict test
 * is the darkest background pixel beneath it, not an average.
 */
export function contrastOverRegion(image, textRgb, region) {
  const ratios = [];
  for (let y = region.top; y < region.bottom; y += 1) {
    for (let x = region.left; x < region.right; x += 1) {
      if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue;
      const i = (y * image.width + x) * image.channels;
      ratios.push(ratioAgainst(textRgb, [image.pixels[i], image.pixels[i + 1], image.pixels[i + 2]]));
    }
  }
  if (ratios.length === 0) throw new Error("Contrast region was empty");
  const sorted = [...ratios].sort((a, b) => a - b);
  const at = (fraction) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
  return {
    min: sorted[0],
    p01: at(0.01),
    p05: at(0.05),
    median: at(0.5),
    samples: ratios.length,
  };
}
