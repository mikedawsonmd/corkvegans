/**
 * Astro-side access to stories: loads the Markdown files and the media
 * folder through Vite, and logs content problems once per build.
 */

import type { ImageMetadata } from "astro";
import { collectStories, storyImageKey, type Story } from "./stories.ts";

// Set CV_FIXTURES=1 to build with the test fixtures instead of real content
// (used by the automated tests only; never in production).
const useFixtures = process.env.CV_FIXTURES === "1";

const rawFiles = useFixtures
    ? import.meta.glob<string>("/tests/fixtures/stories/*.md", { query: "?raw", import: "default", eager: true })
    : import.meta.glob<string>("/src/content/stories/*.md", { query: "?raw", import: "default", eager: true });

const images: Record<string, ImageMetadata> = useFixtures
    ? Object.fromEntries(
          Object.entries(
              import.meta.glob<ImageMetadata>("/tests/fixtures/assets/stories/**/*.{jpg,jpeg,png,webp}", { import: "default", eager: true }),
          ).map(([key, image]) => [key.replace("/tests/fixtures/assets/stories/", "/src/assets/stories/"), image]),
      )
    : import.meta.glob<ImageMetadata>("/src/assets/stories/**/*.{jpg,jpeg,png,webp,avif,gif,JPG,JPEG,PNG,WEBP}", {
          import: "default",
          eager: true,
      });

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
