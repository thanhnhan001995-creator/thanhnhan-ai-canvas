import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const svgPath = path.join(root, "public", "tesseract-icon.svg");
const iconPath = path.join(root, "public", "tesseract.ico");
const sizes = [16, 32, 48, 64, 128, 256];

function icoFromPngFrames(frames) {
  const headerSize = 6 + frames.length * 16;
  const output = Buffer.alloc(headerSize + frames.reduce((total, frame) => total + frame.buffer.length, 0));
  output.writeUInt16LE(0, 0);
  output.writeUInt16LE(1, 2);
  output.writeUInt16LE(frames.length, 4);
  let offset = headerSize;
  frames.forEach((frame, index) => {
    const entry = 6 + index * 16;
    output[entry] = frame.size === 256 ? 0 : frame.size;
    output[entry + 1] = frame.size === 256 ? 0 : frame.size;
    output[entry + 2] = 0;
    output[entry + 3] = 0;
    output.writeUInt16LE(1, entry + 4);
    output.writeUInt16LE(32, entry + 6);
    output.writeUInt32LE(frame.buffer.length, entry + 8);
    output.writeUInt32LE(offset, entry + 12);
    frame.buffer.copy(output, offset);
    offset += frame.buffer.length;
  });
  return output;
}

const svg = await readFile(svgPath);
const frames = await Promise.all(sizes.map(async (size) => ({
  size,
  buffer: await sharp(svg).resize(size, size).png().toBuffer(),
})));
await writeFile(iconPath, icoFromPngFrames(frames));
console.log(`Đã tạo ${iconPath}`);
