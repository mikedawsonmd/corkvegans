/**
 * Astro-side access to stories and partners: loads the content files and media
 * folders through Vite, and logs content problems once per build.
 */

import { resolve } from "node:path";
import type { ImageMetadata } from "astro";
import { collectStories, storyImageKey, type Story } from "./stories.ts";
import { collectPartners, partnerLogoKey, type Partner } from "./partners.ts";

type Files = Record<string, string>;
type Images = Record<string, ImageMetadata>;

// CV_FIXTURES=1: build with the automated-test fixtures instead of real content.
const useFixtures = process.env.CV_FIXTURES === "1";

const realFiles: Files = import.meta.glob<string>("/src/content/stories/*.md", { query: "?raw", import: "default", eager: true });
const fixtureFiles: Files = import.meta.glob<string>("/tests/fixtures/stories/*.md", { query: "?raw", import: "default", eager: true });

const realImages: Images = import.meta.glob<ImageMetadata>("/src/assets/stories/**/*.{jpg,jpeg,png,webp,avif,gif,JPG,JPEG,PNG,WEBP}", {
    import: "default",
    eager: true,
});
const fixtureImages: Images = Object.fromEntries(
    Object.entries(import.meta.glob<ImageMetadata>("/tests/fixtures/assets/stories/**/*.{jpg,jpeg,png,webp}", { import: "default", eager: true })).map(
        ([key, image]) => [key.replace("/tests/fixtures/assets/stories/", "/src/assets/stories/"), image],
    ),
);

const rawFiles: Files = useFixtures ? fixtureFiles : realFiles;
const images: Images = useFixtures ? fixtureImages : realImages;

let cache: Story[] | null = null;

export function getStories(): Story[] {
    if (cache) return cache;
    const { stories, problems } = collectStories(rawFiles);
    const inCi = process.env.GITHUB_ACTIONS === "true";
    for (const p of problems) {
        const msg = `Story "${p.file}" was skipped: ${p.message}`;
        console.warn(inCi ? `::warning title=Story skipped::${msg}` : `WARNING: ${msg}`);
    }
    cache = stories;
    return stories;
}

/** The file on disk behind a CMS image path (for sharp), or null if missing/invalid. */
export function getStoryImageFile(path: string | null): string | null {
    const key = storyImageKey(path);
    if (!key || !images[key]) return null;
    const rel = useFixtures ? key.replace("/src/assets/stories/", "tests/fixtures/assets/stories/") : key.slice(1);
    return resolve(process.cwd(), rel);
}

/** Resolves a CMS image path to an optimisable image, or null if missing/invalid. */
export function getStoryImage(path: string | null): ImageMetadata | null {
    const key = storyImageKey(path);
    if (!key) return null;
    const image = images[key];
    if (!image) {
        console.warn(`WARNING: Story image not found: ${path}`);
        return null;
    }
    return image;
}

// ── Partner businesses ───────────────────────────────────────────────────

const realPartnerFiles: Files = import.meta.glob<string>("/src/content/partners/*.{yml,yaml}", { query: "?raw", import: "default", eager: true });
const fixturePartnerFiles: Files = import.meta.glob<string>("/tests/fixtures/partners/*.{yml,yaml}", { query: "?raw", import: "default", eager: true });
const realPartnerLogos: Images = import.meta.glob<ImageMetadata>("/src/assets/partners/**/*.{jpg,jpeg,png,webp,avif,JPG,JPEG,PNG,WEBP}", { import: "default", eager: true });
const fixturePartnerLogos: Images = Object.fromEntries(
    Object.entries(import.meta.glob<ImageMetadata>("/tests/fixtures/assets/partners/**/*.{jpg,jpeg,png,webp}", { import: "default", eager: true })).map(
        ([key, image]) => [key.replace("/tests/fixtures/assets/partners/", "/src/assets/partners/"), image],
    ),
);

let partnerCache: Partner[] | null = null;

export function getPartners(): Partner[] {
    if (partnerCache) return partnerCache;
    const { partners, problems } = collectPartners(useFixtures ? fixturePartnerFiles : realPartnerFiles);
    const inCi = process.env.GITHUB_ACTIONS === "true";
    for (const p of problems) {
        const msg = `Partner "${p.file}" was skipped: ${p.message}`;
        console.warn(inCi ? `::warning title=Partner skipped::${msg}` : `WARNING: ${msg}`);
    }
    partnerCache = partners;
    return partners;
}

/** A partner's logo as an optimisable image, or null (no logo, or not found). */
export function getPartnerLogo(path: string | null): ImageMetadata | null {
    const key = partnerLogoKey(path);
    if (!key) return null;
    const image = (useFixtures ? fixturePartnerLogos : realPartnerLogos)[key];
    if (!image) console.warn(`WARNING: Partner logo not found: ${path}`);
    return image ?? null;
}
