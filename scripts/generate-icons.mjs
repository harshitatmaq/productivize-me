// Generates the PWA / favicon PNGs from an inline SVG. Run: node scripts/generate-icons.mjs
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";

const mark = (size, { pad = 0.2, bg = "#08090a", radius = 0.22 } = {}) => {
  const r = size * radius;
  const inner = size * (1 - pad * 2);
  const c = size / 2;
  const R = inner / 2 - size * 0.035;
  const stroke = size * 0.07;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b93f5"/><stop offset="1" stop-color="#5e6ad2"/></linearGradient>
    <radialGradient id="glow" cx="50%" cy="0%" r="80%"><stop offset="0" stop-color="#5e6ad2" stop-opacity=".35"/><stop offset="1" stop-color="#5e6ad2" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${r}" fill="${bg}"/>
  <rect width="${size}" height="${size}" rx="${r}" fill="url(#glow)"/>
  <circle cx="${c}" cy="${c}" r="${R}" fill="none" stroke="url(#g)" stroke-width="${stroke}"/>
  <path d="M ${c} ${c - R} A ${R} ${R} 0 0 1 ${c} ${c + R} Z" fill="url(#g)"/>
</svg>`;
};

const out = [
  ["public/icons/icon-192.png", 192, {}],
  ["public/icons/icon-512.png", 512, {}],
  ["public/icons/maskable-512.png", 512, { pad: 0.28, radius: 0 }],
  ["public/icons/badge-96.png", 96, { pad: 0.1, bg: "transparent", radius: 0 }],
  ["src/app/apple-icon.png", 180, { radius: 0 }],
  ["src/app/icon.png", 64, {}],
];

mkdirSync("public/icons", { recursive: true });
for (const [file, size, opts] of out) {
  const png = await sharp(Buffer.from(mark(size, opts))).png().toBuffer();
  writeFileSync(file, png);
  console.log("wrote", file);
}
writeFileSync("public/icons/icon.svg", mark(512));
