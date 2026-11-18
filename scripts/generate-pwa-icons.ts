// Generates the PWA / home screen icons in public/icons from public/images/logo.png (run again
// after changing the logo): npx tsx scripts/generate-pwa-icons.ts
// sharp comes with Next (image optimization), so it isn't a dependency of its own.
import sharp, { type Color } from "sharp";

const LOGO = "public/images/logo.png";
const OUT = "public/icons";
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

// the logo centered on a square of `size`, taking `scale` of it, on `background`
const padded = async (size: number, scale: number, background: Color, file: string) => {
  const inner = Math.round(size * scale);
  const logo = await sharp(LOGO).resize(inner, inner).toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: logo, gravity: "center" }])
    .png()
    .toFile(`${OUT}/${file}`);
};

const main = async () => {
  // "any": the logo itself, transparent around it
  await sharp(LOGO).resize(192, 192).png().toFile(`${OUT}/icon-192.png`);
  await sharp(LOGO).resize(512, 512).png().toFile(`${OUT}/icon-512.png`);
  // "maskable": launchers crop to a circle / squircle, so the logo stays inside the middle 80%
  await padded(512, 0.6, WHITE, "icon-maskable-512.png");
  // iOS fills transparency with black, so a white background
  await padded(180, 0.75, WHITE, "apple-touch-icon.png");
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
