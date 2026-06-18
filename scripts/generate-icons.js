// Generates the PWA icons (public/icons/*.png) from an inline SVG via sharp.
// Run with: node scripts/generate-icons.js
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(process.cwd(), 'public', 'icons');
mkdirSync(OUT, { recursive: true });

// Near-black tile with a white serif "R" centred. padRatio insets the glyph so maskable
// icons keep it inside the safe zone (10% padding → content within the central 80%).
function svg(size, padRatio) {
  const box = size * (1 - padRatio * 2);
  const fontSize = Math.round(box * 0.72);
  const c = size / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#0f0f11"/>
  <text x="${c}" y="${c}" font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="${fontSize}" fill="#ffffff" text-anchor="middle" dominant-baseline="central">R</text>
</svg>`;
}

async function render(name, size, padRatio) {
  await sharp(Buffer.from(svg(size, padRatio))).png().toFile(join(OUT, name));
  const { channels } = await sharp(join(OUT, name)).stats();
  console.log(`${name} — max luma ${channels[0].max} (255 = white glyph rendered)`);
}

await render('icon-192.png', 192, 0);
await render('icon-512.png', 512, 0);
await render('icon-maskable-512.png', 512, 0.1);
