import { describe, expect, it } from "vitest";
import { parseStoryFile, type Story } from "../../src/lib/stories.ts";
import { IG_CAPTION_LIMIT, IG_SIGN_OFF, instagramCaption, run, scrub, storiesToPost, type PostedLog } from "../../scripts/post-social.ts";

const TOKEN = "EAAB-secret-page-token-123";
const creds = { pageId: "111", igUserId: "222", token: TOKEN };

function makeStory(slug: string, fields: string[] = [], date = "2026-10-01"): Story {
    const raw = `---\n${[`title: Story ${slug}`, `description: "Summary of ${slug}."`, `publishedAt: ${date}`, "featuredImage: /src/assets/stories/a.jpg", "draft: false", ...fields].join("\n")}\n---\nBody.\n`;
    const r = parseStoryFile(`${slug}.md`, raw);
    if (r.kind !== "published") throw new Error("bad fixture");
    return r.story;
}

const ticked = (slug: string, extra: string[] = [], date?: string) => makeStory(slug, ["publishSocial: true", ...extra], date);

interface Call {
    method: string;
    url: string;
    body: Record<string, string>;
}

/** A fake Meta Graph API (and live site) that records every call. */
function fakeMeta(overrides: { live?: boolean; igStatus?: string[]; failOn?: RegExp; errorMessage?: string } = {}) {
    const calls: Call[] = [];
    const statuses = [...(overrides.igStatus ?? ["FINISHED"])];
    const fetchImpl = async (url: string, init: RequestInit = {}) => {
        const method = init.method ?? "GET";
        const body = Object.fromEntries(init.body instanceof URLSearchParams ? init.body : new URL(url).searchParams);
        calls.push({ method, url, body });
        const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
        if (method === "HEAD") return new Response(null, { status: overrides.live === false ? 404 : 200 });
        if (overrides.failOn?.test(url)) return json({ error: { message: overrides.errorMessage ?? "Something broke", code: 100, fbtrace_id: "abc" } }, 400);
        if (url.endsWith("/111/feed")) return json({ id: "111_999" });
        if (url.endsWith("/222/media")) return json({ id: "container-1" });
        if (url.includes("/container-1?")) return json({ status_code: statuses.shift() ?? "FINISHED" });
        if (url.endsWith("/222/media_publish")) return json({ id: "ig-777" });
        return json({ error: { message: `unexpected ${url}` } }, 404);
    };
    return { calls, fetchImpl };
}

const base = (stories: Story[], log: PostedLog = { stories: {} }) => ({
    stories,
    log,
    creds,
    dryRun: false,
    hasPhoto: () => true,
    sleep: async () => {},
    now: () => new Date("2026-10-20T09:00:00Z"),
    siteUrl: "https://corkvegans.ie",
    print: () => {},
});

describe("captions", () => {
    it("uses the summary, then a blank line and the sign-off", () => {
        expect(instagramCaption(ticked("a"))).toBe(`Summary of a.\n\n${IG_SIGN_OFF}`);
    });

    it("prefers the Instagram caption override", () => {
        expect(instagramCaption(ticked("a", ['igCaption: "Custom words 🌱"']))).toBe(`Custom words 🌱\n\n${IG_SIGN_OFF}`);
    });

    it("stays within Instagram's limit", () => {
        const long = ticked("a", [`igCaption: "${"word ".repeat(600)}"`]);
        const caption = instagramCaption(long);
        expect(caption.length).toBeLessThanOrEqual(IG_CAPTION_LIMIT);
        expect(caption.endsWith(IG_SIGN_OFF)).toBe(true);
    });
});

describe("choosing what to post", () => {
    it("only posts ticked stories, oldest first, and only the platforms still missing", () => {
        const stories = [ticked("newer", [], "2026-10-05"), makeStory("unticked"), ticked("older", [], "2026-10-01"), ticked("done")];
        const log: PostedLog = { stories: { done: { facebook: { id: "1", postedAt: "x" }, instagram: { id: "2", postedAt: "x" } }, newer: { facebook: { id: "3", postedAt: "x" } } } };
        expect(storiesToPost(stories, log).map((w) => [w.story.slug, w.platforms])).toEqual([
            ["older", ["facebook", "instagram"]],
            ["newer", ["instagram"]],
        ]);
    });
});

describe("posting", () => {
    it("posts to Facebook and Instagram and records both", async () => {
        const meta = fakeMeta();
        const result = await run({ ...base([ticked("potluck")]), fetchImpl: meta.fetchImpl });

        expect(result.failures).toEqual([]);
        expect(result.changed).toBe(true);
        expect(result.log.stories.potluck).toEqual({
            facebook: { id: "111_999", postedAt: "2026-10-20T09:00:00.000Z" },
            instagram: { id: "ig-777", postedAt: "2026-10-20T09:00:00.000Z" },
        });

        const fb = meta.calls.find((c) => c.url.endsWith("/111/feed"))!;
        expect(fb.url).toBe("https://graph.facebook.com/v26.0/111/feed");
        expect(fb.body).toMatchObject({ message: "Summary of potluck.", link: "https://corkvegans.ie/stories/potluck/", access_token: TOKEN });

        const container = meta.calls.find((c) => c.url.endsWith("/222/media"))!;
        expect(container.body).toMatchObject({
            image_url: "https://corkvegans.ie/stories/potluck/instagram-1080x1350.jpg",
            caption: `Summary of potluck.\n\n${IG_SIGN_OFF}`,
        });
        expect(meta.calls.find((c) => c.url.endsWith("/222/media_publish"))!.body.creation_id).toBe("container-1");
    });

    it("never posts the same thing twice", async () => {
        const meta = fakeMeta();
        const first = await run({ ...base([ticked("potluck")]), fetchImpl: meta.fetchImpl });
        const before = meta.calls.length;
        const second = await run({ ...base([ticked("potluck")], first.log), fetchImpl: meta.fetchImpl });
        expect(second.posted).toEqual([]);
        expect(second.changed).toBe(false);
        expect(meta.calls.length).toBe(before);
    });

    it("records each platform separately: a failed Instagram post is retried alone next time", async () => {
        const failing = fakeMeta({ failOn: /\/222\/media$/, errorMessage: "Invalid image" });
        const first = await run({ ...base([ticked("potluck")]), fetchImpl: failing.fetchImpl });
        expect(first.log.stories.potluck.facebook?.id).toBe("111_999");
        expect(first.log.stories.potluck.instagram).toBeUndefined();
        expect(first.failures).toEqual([{ slug: "potluck", platform: "instagram", message: "Invalid image (code 100, trace abc)" }]);

        const working = fakeMeta();
        const second = await run({ ...base([ticked("potluck")], first.log), fetchImpl: working.fetchImpl });
        expect(working.calls.some((c) => c.url.endsWith("/111/feed"))).toBe(false);
        expect(second.log.stories.potluck.instagram?.id).toBe("ig-777");
    });

    it("waits for Instagram to finish processing, and fails clearly on errors", async () => {
        const slow = fakeMeta({ igStatus: ["IN_PROGRESS", "IN_PROGRESS", "FINISHED"] });
        const waits: number[] = [];
        const ok = await run({ ...base([ticked("a")]), fetchImpl: slow.fetchImpl, sleep: async (ms) => void waits.push(ms) });
        expect(ok.log.stories.a.instagram?.id).toBe("ig-777");
        expect(waits).toEqual([60_000, 60_000]);

        const broken = fakeMeta({ igStatus: ["ERROR"] });
        const bad = await run({ ...base([ticked("b")]), fetchImpl: broken.fetchImpl });
        expect(bad.failures[0]).toMatchObject({ platform: "instagram", message: expect.stringContaining("couldn't process the image") });
        expect(bad.log.stories.b.instagram).toBeUndefined();
    });

    it("skips stories that aren't live yet, without failing", async () => {
        const meta = fakeMeta({ live: false });
        const result = await run({ ...base([ticked("a")]), fetchImpl: meta.fetchImpl });
        expect(result.skipped).toEqual([{ slug: "a", reason: expect.stringContaining("not live") }]);
        expect(result.failures).toEqual([]);
        expect(meta.calls.every((c) => c.method === "HEAD")).toBe(true);
    });

    it("won't post a story without a photo to Instagram", async () => {
        const meta = fakeMeta();
        const result = await run({ ...base([ticked("a")]), fetchImpl: meta.fetchImpl, hasPhoto: () => false });
        expect(result.log.stories.a.facebook).toBeDefined();
        expect(result.failures[0]).toMatchObject({ platform: "instagram", message: expect.stringContaining("no photo") });
    });

    it("fails clearly when secrets are missing, but only if there's something to post", async () => {
        const meta = fakeMeta();
        const nothing = await run({ ...base([makeStory("a")]), creds: {}, fetchImpl: meta.fetchImpl });
        expect(nothing.failures).toEqual([]);

        const missing = await run({ ...base([ticked("a")]), creds: { pageId: "111" }, fetchImpl: meta.fetchImpl });
        expect(missing.failures[0].message).toBe("Missing GitHub secrets: META_IG_USER_ID, META_PAGE_ACCESS_TOKEN. See docs/social-publishing.md.");
    });
});

describe("dry runs", () => {
    it("shows what would be posted without calling Meta or recording anything", async () => {
        const meta = fakeMeta();
        const lines: string[] = [];
        const result = await run({ ...base([ticked("a")]), dryRun: true, fetchImpl: meta.fetchImpl, print: (l) => lines.push(l) });
        expect(meta.calls.every((c) => c.method === "HEAD")).toBe(true);
        expect(result.changed).toBe(false);
        expect(result.log).toEqual({ stories: {} });
        const out = lines.join("\n");
        expect(out).toContain("DRY RUN");
        expect(out).toContain("message: Summary of a.");
        expect(out).toContain("image_url: https://corkvegans.ie/stories/a/instagram-1080x1350.jpg");
    });

    it("can preview an unticked story with FORCE, but only in a dry run", async () => {
        const meta = fakeMeta();
        const lines: string[] = [];
        const preview = await run({ ...base([makeStory("hello")]), dryRun: true, force: "hello", fetchImpl: meta.fetchImpl, print: (l) => lines.push(l) });
        expect(preview.failures).toEqual([]);
        expect(lines.join("\n")).toContain("[forced for this dry run]");

        const real = await run({ ...base([makeStory("hello")]), force: "hello", fetchImpl: meta.fetchImpl });
        expect(real.failures[0].message).toMatch(/only works in a dry run/);
        expect(meta.calls.some((c) => c.method === "POST")).toBe(false);
    });
});

describe("keeping the token secret", () => {
    it("removes the token from error messages and printed output", async () => {
        const meta = fakeMeta({ failOn: /\/111\/feed/, errorMessage: `Bad request with access_token=${TOKEN}` });
        const lines: string[] = [];
        const result = await run({ ...base([ticked("a")]), fetchImpl: meta.fetchImpl, print: (l) => lines.push(l) });
        const everything = JSON.stringify(result) + lines.join("\n");
        expect(everything).not.toContain(TOKEN);
        expect(everything).toContain("access_token=[token]");
    });

    it("scrubs the raw token wherever it appears", () => {
        expect(scrub(`token ${TOKEN} here`, TOKEN)).toBe("token [token] here");
    });
});
