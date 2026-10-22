/**
 * Posts newly published stories to the Cork Vegans Facebook Page and
 * Instagram account. Run by .github/workflows/social.yml after each
 * successful deploy (Instagram fetches the image from the live site).
 *
 *   node scripts/post-social.ts            post for real
 *   DRY_RUN=true node scripts/post-social.ts
 *   DRY_RUN=true FORCE=hello-world node scripts/post-social.ts
 *
 * Only stories with the "Post to Facebook and Instagram" section added in
 * Pages CMS (publishSocial) are posted, and each platform only once: successes are
 * recorded in data/social-posted.json, which the workflow commits. A story
 * whose post failed on one platform is retried for that platform only.
 *
 * Environment:
 *   META_PAGE_ID, META_IG_USER_ID, META_PAGE_ACCESS_TOKEN  (GitHub secrets)
 *   DRY_RUN=true   log what would be posted; call nothing, record nothing
 *   FORCE=<slug>   dry runs only: treat this story as ticked
 * See docs/social-publishing.md.
 */

import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { site } from "../src/config/site.ts";
import { collectStories, storyImageKey, trimToWords, type Story } from "../src/lib/stories.ts";

export const GRAPH_VERSION = "v26.0";
export const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
export const IG_SIGN_OFF = "Full story at the link in our bio.";
export const IG_CAPTION_LIMIT = 2200;

export type Platform = "facebook" | "instagram";
export const PLATFORMS: Platform[] = ["facebook", "instagram"];

export interface PlatformRecord {
    id: string;
    postedAt: string;
}
export type StoryRecord = Partial<Record<Platform, PlatformRecord>>;
export interface PostedLog {
    stories: Record<string, StoryRecord>;
}

export interface Credentials {
    pageId: string;
    igUserId: string;
    token: string;
}

// ── Pure helpers ──────────────────────────────────────────────────────────

export function storyUrl(slug: string, siteUrl = site.url): string {
    return new URL(`/stories/${slug}/`, siteUrl).href;
}

export function instagramImageUrl(slug: string, siteUrl = site.url): string {
    return new URL(`/stories/${slug}/instagram-1080x1350.jpg`, siteUrl).href;
}

export function facebookMessage(story: Story): string {
    return story.summary;
}

/** The caption override (or summary), a blank line, then the sign-off; within Instagram's limit. */
export function instagramCaption(story: Story): string {
    const suffix = `\n\n${IG_SIGN_OFF}`;
    const text = (story.igCaption || story.summary).trim();
    return `${trimToWords(text, IG_CAPTION_LIMIT - suffix.length)}${suffix}`;
}

/** Stories to post and the platforms each still needs, oldest first. */
export function storiesToPost(stories: Story[], log: PostedLog, force?: string): { story: Story; platforms: Platform[]; forced: boolean }[] {
    return stories
        .filter((s) => s.publishSocial || s.slug === force)
        .map((story) => ({
            story,
            platforms: PLATFORMS.filter((p) => !log.stories[story.slug]?.[p]),
            forced: !story.publishSocial,
        }))
        .filter((x) => x.platforms.length > 0)
        .reverse();
}

/** Removes the token (and anything shaped like one) from text before it's logged. */
export function scrub(text: string, token?: string): string {
    let out = token ? text.split(token).join("[token]") : text;
    out = out.replace(/access_token=[^&\s"]+/g, "access_token=[token]");
    return out;
}

// ── Meta Graph API ────────────────────────────────────────────────────────

export class GraphError extends Error {}

/** What to do about Meta's permission and token errors (codes 10, 200–299, 190). */
export function tokenHint(code: number | undefined): string {
    if (code === 190) return ". The Page access token has expired or been revoked: make a new one (docs/social-publishing.md, step 1.4) and update META_PAGE_ACCESS_TOKEN.";
    if (code === 10 || (code !== undefined && code >= 200 && code < 300)) {
        return ". The Page access token is missing a permission. Make a new Page token with pages_manage_posts, pages_read_engagement, instagram_basic and instagram_content_publish (docs/social-publishing.md, step 1.4) and update META_PAGE_ACCESS_TOKEN.";
    }
    return "";
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Calls the Graph API. The token goes in the request body or query, never in logs. */
export async function graph(
    fetchImpl: FetchLike,
    token: string,
    method: "GET" | "POST",
    path: string,
    params: Record<string, string> = {},
): Promise<Record<string, unknown>> {
    const query = new URLSearchParams({ ...params, access_token: token });
    const url = method === "GET" ? `${GRAPH_BASE}${path}?${query}` : `${GRAPH_BASE}${path}`;
    let res: Response;
    try {
        res = await fetchImpl(url, method === "POST" ? { method, body: query } : { method });
    } catch (err) {
        throw new GraphError(scrub(`could not reach Meta (${err instanceof Error ? err.message : String(err)})`, token));
    }
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number; error_subcode?: number; fbtrace_id?: string } };
    if (!res.ok || body.error) {
        const e = body.error ?? {};
        const code = [e.code && `code ${e.code}`, e.error_subcode && `subcode ${e.error_subcode}`, e.fbtrace_id && `trace ${e.fbtrace_id}`].filter(Boolean).join(", ");
        throw new GraphError(scrub(`${e.message ?? `HTTP ${res.status}`}${code ? ` (${code})` : ""}${tokenHint(e.code)}`, token));
    }
    return body as Record<string, unknown>;
}

export async function postToFacebook(fetchImpl: FetchLike, creds: Credentials, story: Story, siteUrl = site.url): Promise<string> {
    const out = await graph(fetchImpl, creds.token, "POST", `/${creds.pageId}/feed`, { message: facebookMessage(story), link: storyUrl(story.slug, siteUrl) });
    if (typeof out.id !== "string") throw new GraphError("Facebook didn't return a post ID.");
    return out.id;
}

export async function postToInstagram(
    fetchImpl: FetchLike,
    creds: Credentials,
    story: Story,
    options: { siteUrl?: string; sleep?: (ms: number) => Promise<void>; checks?: number; interval?: number } = {},
): Promise<string> {
    const { siteUrl = site.url, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), checks = 5, interval = 60_000 } = options;
    const container = await graph(fetchImpl, creds.token, "POST", `/${creds.igUserId}/media`, {
        image_url: instagramImageUrl(story.slug, siteUrl),
        caption: instagramCaption(story),
    });
    if (typeof container.id !== "string") throw new GraphError("Instagram didn't return a media container ID.");

    // Meta asks for status checks at most once a minute, for up to 5 minutes.
    // Single images are normally ready straight away, so check once first.
    for (let i = 0; i < checks; i++) {
        const { status_code: status } = await graph(fetchImpl, creds.token, "GET", `/${container.id}`, { fields: "status_code" });
        if (status === "FINISHED") break;
        if (status === "ERROR" || status === "EXPIRED") throw new GraphError(`Instagram couldn't process the image (status ${status}).`);
        if (i === checks - 1) throw new GraphError(`Instagram was still processing the image after ${checks} checks (status ${String(status)}).`);
        await sleep(interval);
    }

    const published = await graph(fetchImpl, creds.token, "POST", `/${creds.igUserId}/media_publish`, { creation_id: container.id });
    if (typeof published.id !== "string") throw new GraphError("Instagram didn't return a post ID.");
    return published.id;
}

/** True if the address is live on the site (Meta and Facebook previews fetch from it). */
async function isLive(fetchImpl: FetchLike, url: string): Promise<boolean> {
    try {
        return (await fetchImpl(url, { method: "HEAD" })).ok;
    } catch {
        return false;
    }
}

// ── The run ───────────────────────────────────────────────────────────────

export interface RunOptions {
    stories: Story[];
    log: PostedLog;
    creds: Partial<Credentials>;
    dryRun: boolean;
    force?: string;
    /** Does the story have a photo file to crop? (Instagram needs one.) */
    hasPhoto: (story: Story) => boolean;
    fetchImpl?: FetchLike;
    sleep?: (ms: number) => Promise<void>;
    now?: () => Date;
    siteUrl?: string;
    print?: (line: string) => void;
    /** Saves the record; called after every successful post (never in dry runs). */
    save?: (log: PostedLog) => void;
}

export interface RunResult {
    log: PostedLog;
    changed: boolean;
    posted: { slug: string; platform: Platform; id: string }[];
    failures: { slug: string; platform: Platform | "setup"; message: string }[];
    skipped: { slug: string; reason: string }[];
}

export async function run(opts: RunOptions): Promise<RunResult> {
    const { dryRun, force, hasPhoto, fetchImpl = fetch, now = () => new Date(), siteUrl = site.url, print = console.log } = opts;
    const log: PostedLog = structuredClone(opts.log);
    const result: RunResult = { log, changed: false, posted: [], failures: [], skipped: [] };

    if (force && !dryRun) {
        result.failures.push({ slug: force, platform: "setup", message: "FORCE only works in a dry run, so nothing is posted by accident." });
        return result;
    }

    const work = storiesToPost(opts.stories, log, force);
    if (force && !opts.stories.some((s) => s.slug === force)) {
        result.failures.push({ slug: force, platform: "setup", message: `No published story is called "${force}".` });
    }
    if (work.length === 0) {
        print("Nothing to post: no published stories are waiting for Facebook or Instagram.");
        return result;
    }

    const missing = (["pageId", "igUserId", "token"] as const).filter((k) => !opts.creds[k]);
    const secretNames = { pageId: "META_PAGE_ID", igUserId: "META_IG_USER_ID", token: "META_PAGE_ACCESS_TOKEN" };
    if (!dryRun && missing.length > 0) {
        result.failures.push({ slug: "-", platform: "setup", message: `Missing GitHub secrets: ${missing.map((k) => secretNames[k]).join(", ")}. See docs/social-publishing.md.` });
        return result;
    }
    const creds = opts.creds as Credentials;

    if (dryRun) print("DRY RUN: nothing will be posted to Meta and nothing will be recorded.\n");

    for (const { story, platforms, forced } of work) {
        const url = storyUrl(story.slug, siteUrl);
        const imageUrl = instagramImageUrl(story.slug, siteUrl);
        print(`Story: ${story.title} (${story.slug})${forced ? "  [forced for this dry run]" : ""}`);

        const pageLive = await isLive(fetchImpl, url);
        const imageLive = await isLive(fetchImpl, imageUrl);
        print(`  Live on the site: page ${pageLive ? "yes" : "NO"}, Instagram image ${imageLive ? "yes" : "NO"}`);

        if (!dryRun && !pageLive) {
            result.skipped.push({ slug: story.slug, reason: "not live on the site yet; will try after the next deploy" });
            print("  Skipped: not live yet. It will be posted after a later deploy.\n");
            continue;
        }

        for (const platform of platforms) {
            if (platform === "facebook") {
                print(`  Facebook: POST /${creds.pageId || "{META_PAGE_ID}"}/feed`);
                print(`    message: ${facebookMessage(story)}`);
                print(`    link:    ${url}`);
            } else {
                print(`  Instagram: POST /${creds.igUserId || "{META_IG_USER_ID}"}/media, then /media_publish`);
                print(`    image_url: ${imageUrl}`);
                print(`    caption:\n${instagramCaption(story).replace(/^/gm, "      ")}`);
            }
            if (dryRun) continue;

            try {
                if (platform === "instagram" && !hasPhoto(story)) throw new GraphError("this story has no photo, and Instagram posts need one. Add a featured image in Pages CMS.");
                if (platform === "instagram" && !imageLive) throw new GraphError(`the Instagram image isn't live yet (${imageUrl}).`);
                const id =
                    platform === "facebook"
                        ? await postToFacebook(fetchImpl, creds, story, siteUrl)
                        : await postToInstagram(fetchImpl, creds, story, { siteUrl, sleep: opts.sleep });
                log.stories[story.slug] = { ...log.stories[story.slug], [platform]: { id, postedAt: now().toISOString() } };
                result.changed = true;
                // Save straight away, so an interrupted run never forgets a post.
                opts.save?.(log);
                result.posted.push({ slug: story.slug, platform, id });
                print(`    ✓ posted (${id})`);
            } catch (err) {
                const message = scrub(err instanceof Error ? err.message : String(err), creds.token);
                result.failures.push({ slug: story.slug, platform, message });
                print(`    ✗ failed: ${message}`);
            }
        }
        print("");
    }
    return result;
}

// ── Command line ──────────────────────────────────────────────────────────

const root = fileURLToPath(new URL("..", import.meta.url));
export const LOG_FILE = join(root, "data/social-posted.json");

function readLog(): PostedLog {
    if (!existsSync(LOG_FILE)) return { stories: {} };
    const parsed = JSON.parse(readFileSync(LOG_FILE, "utf8")) as Partial<PostedLog>;
    return { stories: parsed.stories ?? {} };
}

function loadStories(): Story[] {
    const dir = join(root, "src/content/stories");
    const files = Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => [f, readFileSync(join(dir, f), "utf8")]));
    return collectStories(files).stories;
}

function hasPhotoFile(story: Story): boolean {
    const key = storyImageKey(story.socialImage);
    return !!key && existsSync(join(root, key));
}

async function main() {
    const dryRun = /^(1|true|yes)$/i.test(process.env.DRY_RUN ?? "");
    const force = process.env.FORCE?.trim() || undefined;
    const result = await run({
        stories: loadStories(),
        log: readLog(),
        creds: { pageId: process.env.META_PAGE_ID?.trim(), igUserId: process.env.META_IG_USER_ID?.trim(), token: process.env.META_PAGE_ACCESS_TOKEN?.trim() },
        dryRun,
        force,
        hasPhoto: hasPhotoFile,
        save: dryRun ? undefined : (log) => writeFileSync(LOG_FILE, `${JSON.stringify(log, null, 2)}\n`),
    });

    const lines = [
        `Posted: ${result.posted.length}, failed: ${result.failures.length}, skipped: ${result.skipped.length}`,
        ...result.failures.map((f) => `::error title=Social posting failed::${f.slug} → ${f.platform}: ${f.message}`),
    ];
    console.log(lines.join("\n"));

    if (process.env.GITHUB_STEP_SUMMARY) {
        const rows = [
            ...result.posted.map((p) => `| ${p.slug} | ${p.platform} | ✅ posted (${p.id}) |`),
            ...result.failures.map((f) => `| ${f.slug} | ${f.platform} | ❌ ${f.message.replace(/\|/g, "/")} |`),
            ...result.skipped.map((s) => `| ${s.slug} | - | ⏳ ${s.reason} |`),
        ];
        appendFileSync(
            process.env.GITHUB_STEP_SUMMARY,
            `### Social posting${dryRun ? " (dry run)" : ""}\n\n${rows.length ? `| Story | Platform | Result |\n| --- | --- | --- |\n${rows.join("\n")}` : "Nothing to post."}\n`,
        );
    }
    if (result.failures.length > 0) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main().catch((err) => {
        console.error(`::error title=Social posting crashed::${scrub(err instanceof Error ? err.message : String(err), process.env.META_PAGE_ACCESS_TOKEN)}`);
        process.exitCode = 1;
    });
}
