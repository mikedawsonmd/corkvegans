/**
 * Makes the PNG images the membership emails use (Gmail and Outlook don't
 * show SVG): the official "Add to Google Wallet" badge and a pig and chicken
 * that stand on the member-code box. Run again after changing the SVGs:
 *
 *   node scripts/build-email-images.ts
 *
 * Writes public/images/email/*.png at twice their display size, so they stay
 * sharp on phones. The emails load them from https://corkvegans.ie, so a
 * change only shows up in emails once the site is deployed.
 */

import { mkdir } from "node:fs/promises";
import sharp from "sharp";
import { animals } from "../src/lib/animals.ts";

const OUT = "public/images/email";
const PUBLIC = (src: string) => `public${src}`;

await mkdir(OUT, { recursive: true });

// The badge is 283 × 50; shown at 226 × 40 in the email.
await sharp("public/images/add-to-google-wallet.svg", { density: 144 }).resize({ height: 80 }).png().toFile(`${OUT}/add-to-google-wallet.png`);

// Pig and chicken in proportion (the site's `scale`), feet on one line, 64px tall in the email.
const HEIGHT = 128;
const ANIMAL_GREEN = { r: 0x41, g: 0x76, b: 0x60 }; // #417660, as .cv-animal-tone-soft
const GAP = 12;
const group = [animals.pig, animals.chicken];
const tallest = Math.max(...group.map((a) => a.scale));
const drawn = await Promise.all(
    group.map(async (animal) => {
        const height = Math.round((HEIGHT * animal.scale) / tallest);
        // The site paints the drawings in one soft green (.cv-animal-tone-soft); keep only their shape.
        const alpha = await sharp(PUBLIC(animal.src), { density: 300 }).resize({ height }).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
        const data = await sharp({ create: { width: alpha.info.width, height: alpha.info.height, channels: 3, background: ANIMAL_GREEN } })
            .joinChannel(alpha.data, { raw: { width: alpha.info.width, height: alpha.info.height, channels: 1 } })
            .png()
            .toBuffer();
        return { data, width: alpha.info.width, height: alpha.info.height };
    }),
);
const width = drawn.reduce((sum, a) => sum + a.width, 0) + GAP * (drawn.length - 1);
let left = 0;
const layers = drawn.map((a) => {
    const layer = { input: a.data, left, top: HEIGHT - a.height };
    left += a.width + GAP;
    return layer;
});
await sharp({ create: { width, height: HEIGHT, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(layers)
    .png()
    .toFile(`${OUT}/animals-pig-chicken.png`);

console.log(`Wrote ${OUT}/add-to-google-wallet.png and ${OUT}/animals-pig-chicken.png (${width} × ${HEIGHT}, shown at half size).`);
