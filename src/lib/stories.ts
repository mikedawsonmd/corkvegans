/**
 * Stories: parsing, validation and ordering of the Markdown files that
 * Pages CMS writes to src/content/stories/.
 *
 * Parsing is deliberately tolerant: a broken or half-finished file is
 * reported as a problem and skipped, never allowed to break the build.
 * Drafts are excluded before any rendering happens.
 */

import { parse as parseYaml } from "yaml";

export interface Story {
    slug: string;
    file: string;
    title: string;
    description: string;
    author: string;
    category: string;
    publishedAt: Date;
    updatedAt: Date | null;
    featuredImage: string | null;
    featuredImageAlt: string;
    body: string;
    readingMinutes: number;
}

export interface StoryProblem {
    file: string;
    message: string;
    draft: boolean;
}

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const DEFAULT_AUTHOR = "Cork Vegans";
export const DEFAULT_CATEGORY = "Stories";
/** Stories shown at first on the Stories page; "Show more" reveals the next batch. */
export const STORIES_PER_PAGE = 12;

/** The category's value in Stories page addresses, e.g. /stories/?category=reviews. */
export function categorySlug(category: string): string {
    return slugify(category);
}

/** Link to the Stories page filtered to one category. */
export function categoryUrl(category: string): string {
    return `/stories/?category=${categorySlug(category)}`;
}

export function slugify(value: string): string {
    return value
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80)
        .replace(/-+$/g, "");
}

export function splitFrontmatter(raw: string): { data: string; body: string } | null {
    const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/.exec(raw);
    if (!match) return null;
    return { data: match[1], body: match[2] ?? "" };
}

/** Accepts "2026-10-16", "2026-10-16T09:30" or a YAML date. Returns null if invalid. */
export function parseDate(value: unknown): Date | null {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value !== "string" || !value.trim()) return null;
    const v = value.trim();
    if (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(v)) return null;
    // Date-only values are treated as midday UTC so they never shift to another day in Ireland.
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T12:00:00Z` : v.replace(" ", "T"));
    return Number.isNaN(d.getTime()) ? null : d;
}

function asString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function isDraft(value: unknown): boolean {
    // Missing = published (files added by hand); Pages CMS always writes the field.
    if (value === undefined || value === null) return false;
    return value === true || value === "true";
}

export function countWords(markdown: string): number {
    return markdown
        .replace(/<[^>]+>/g, " ")
        .replace(/[#*_>`[\]()!-]/g, " ")
        .split(/\s+/)
        .filter(Boolean).length;
}

export type ParseResult = { kind: "published"; story: Story } | { kind: "draft" } | { kind: "invalid"; problem: StoryProblem };

/** Parses one story file. `file` is the filename, e.g. "my-first-story.md". */
export function parseStoryFile(file: string, raw: string): ParseResult {
    const fail = (message: string, draft = false): ParseResult => ({ kind: "invalid", problem: { file, message, draft } });

    const parts = splitFrontmatter(raw);
    if (!parts) return fail("The file has no front matter block (--- … ---).");

    let data: Record<string, unknown>;
    try {
        const parsed: unknown = parseYaml(parts.data);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail("Front matter is empty or not a set of fields.");
        data = parsed as Record<string, unknown>;
    } catch (err) {
        return fail(`Front matter could not be read: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
    }

    // Drafts are never validated or rendered, so an unfinished draft can't break anything.
    if (isDraft(data.draft)) return { kind: "draft" };

    const slug = slugify(file.replace(/\.md$/i, ""));
    if (!slug || !SLUG_PATTERN.test(slug)) return fail("The filename does not produce a usable web address.");

    const title = asString(data.title);
    if (!title) return fail("Missing title.");

    const description = asString(data.description);
    if (!description) return fail("Missing description (the short summary).");

    const publishedAt = parseDate(data.publishedAt);
    if (!publishedAt) return fail("Missing or invalid publish date (expected YYYY-MM-DD).");

    const updatedRaw = data.updatedAt;
    const updatedAt = updatedRaw === undefined || updatedRaw === null || updatedRaw === "" ? null : parseDate(updatedRaw);
    if (updatedRaw && !updatedAt) return fail("Invalid 'last updated' date (expected YYYY-MM-DD).");

    const featuredImage = asString(data.featuredImage) || null;
    const body = parts.body.trim();

    return {
        kind: "published",
        story: {
            slug,
            file,
            title,
            description,
            author: asString(data.author) || DEFAULT_AUTHOR,
            category: asString(data.category) || DEFAULT_CATEGORY,
            publishedAt,
            updatedAt: updatedAt && updatedAt > publishedAt ? updatedAt : null,
            featuredImage,
            // Fall back to the title so the image is never announced as just a filename.
            featuredImageAlt: asString(data.featuredImageAlt) || (featuredImage ? title : ""),
            body,
            readingMinutes: Math.max(1, Math.round(countWords(body) / 200)),
        },
    };
}

/** Parses all files, returning published stories (newest first) and any problems. */
export function collectStories(files: Record<string, string>): { stories: Story[]; problems: StoryProblem[]; drafts: number } {
    const stories: Story[] = [];
    const problems: StoryProblem[] = [];
    let drafts = 0;
    const seen = new Set<string>();

    for (const [path, raw] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
        const file = path.split("/").pop() ?? path;
        if (/^readme\.md$/i.test(file)) continue; // folder notes for admins, not a story
        const result = parseStoryFile(file, raw);
        if (result.kind === "draft") drafts++;
        else if (result.kind === "invalid") problems.push(result.problem);
        else if (seen.has(result.story.slug)) {
            problems.push({ file, message: `Another story already uses the address /stories/${result.story.slug}/.`, draft: false });
        } else {
            seen.add(result.story.slug);
            stories.push(result.story);
        }
    }

    stories.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime() || a.title.localeCompare(b.title));
    return { stories, problems, drafts };
}

/** Up to `limit` other stories, same category first, then most recent. */
export function relatedStories(story: Story, all: Story[], limit = 3): Story[] {
    const others = all.filter((s) => s.slug !== story.slug);
    const same = others.filter((s) => s.category === story.category);
    const rest = others.filter((s) => s.category !== story.category);
    return [...same, ...rest].slice(0, limit);
}

/**
 * Maps a featured-image value written by Pages CMS (e.g. "/src/assets/stories/photo.jpg")
 * to a key in the image map. Rejects anything outside the stories media folder.
 */
export function storyImageKey(value: string | null): string | null {
    if (!value) return null;
    const match = /(?:^|\/)assets\/stories\/(.+)$/.exec(value.trim());
    if (!match) return null;
    const rel = decodeURIComponent(match[1]);
    if (rel.split("/").some((part) => part === ".." || part === "")) return null;
    return `/src/assets/stories/${rel}`;
}

export function formatStoryDate(date: Date): string {
    return new Intl.DateTimeFormat("en-IE", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Dublin" }).format(date);
}

export function isoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
}
