/**
 * Post-build checks on the generated site. Runs automatically after
 * `astro build`; any failure stops the deploy so a broken site never goes live.
 *
 *   node scripts/check-dist.ts [outDir]
 *
 * Checks: expected routes exist, every page has a title, description,
 * canonical URL and Open Graph tags with absolute URLs, canonical URLs are
 * unique, internal links and assets resolve, drafts are not published,
 * the custom domain file is intact, and no credentials leaked into the output.
 */

import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { donations, site, volunteerForm } from "../src/config/site.ts";
import { collectStories, parseStoryFile, slugify } from "../src/lib/stories.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = join(root, process.argv[2] ?? "dist");
const useFixtures = process.env.CV_FIXTURES === "1";
const hideSamples = process.env.CV_HIDE_SAMPLES === "1";
const storyDirs = useFixtures ? ["tests/fixtures/stories"] : ["src/content/stories", ...(hideSamples ? [] : ["src/content/sample-stories"])];
const hiddenSampleDir = !useFixtures && hideSamples ? join(root, "src/content/sample-stories") : null;

const errors: string[] = [];
const fail = (msg: string) => errors.push(msg);

function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const p = join(dir, name);
        return statSync(p).isDirectory() ? walk(p) : [p];
    });
}

function attr(tag: string, name: string): string | null {
    return new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
}

function meta(html: string, key: string): string | null {
    const tag = new RegExp(`<meta[^>]+(?:property|name)="${key}"[^>]*>`).exec(html)?.[0];
    return tag ? attr(tag, "content") : null;
}

/** Maps a site path ("/events/", "/images/x.png") to a file in outDir, or null. */
function resolvePath(path: string): string | null {
    const clean = decodeURIComponent(path.split(/[?#]/)[0]);
    const candidates = clean.endsWith("/") ? [join(outDir, clean, "index.html")] : [join(outDir, clean), join(outDir, clean, "index.html")];
    return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

if (!existsSync(outDir)) {
    console.error(`Output directory not found: ${outDir}`);
    process.exit(1);
}

// ── 1. Expected routes ───────────────────────────────────────────────────
for (const route of ["index.html", "events/index.html", "stories/index.html", "resources/index.html", "support/index.html", "about/index.html", "404.html", "sitemap.xml", "robots.txt", "events.json", "CNAME"]) {
    if (!existsSync(join(outDir, route))) fail(`Missing expected file: ${route}`);
}

// ── 2. Custom domain unchanged ───────────────────────────────────────────
if (existsSync(join(outDir, "CNAME"))) {
    const cname = readFileSync(join(outDir, "CNAME"), "utf8").trim();
    if (cname !== new URL(site.url).host) fail(`CNAME is "${cname}", expected "${new URL(site.url).host}"`);
}

// ── 3. Per-page metadata and links ───────────────────────────────────────
const files = walk(outDir);
const htmlFiles = files.filter((f) => f.endsWith(".html"));
const canonicals = new Map<string, string>();
const idsByFile = new Map<string, Set<string>>();
const linkChecks: { from: string; href: string }[] = [];

for (const file of htmlFiles) {
    const rel = relative(outDir, file);
    const html = readFileSync(file, "utf8");
    idsByFile.set(file, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));

    const is404 = rel === "404.html";
    if (!/<title>[^<]+<\/title>/.test(html)) fail(`${rel}: missing <title>`);
    if (!meta(html, "description")) fail(`${rel}: missing meta description`);
    if ((html.match(/<h1[\s>]/g) ?? []).length !== 1) fail(`${rel}: expected exactly one <h1>`);
    if (!/<html[^>]+lang="/.test(html)) fail(`${rel}: missing lang attribute`);

    if (!is404) {
        const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];
        const expected = new URL("/" + rel.replace(/index\.html$/, ""), site.url).href;
        if (!canonical) fail(`${rel}: missing canonical link`);
        else {
            if (canonical !== expected) fail(`${rel}: canonical ${canonical} should be ${expected}`);
            if (canonicals.has(canonical)) fail(`${rel}: duplicate canonical (also ${canonicals.get(canonical)})`);
            canonicals.set(canonical, rel);
        }
        for (const key of ["og:title", "og:description", "og:image", "og:url", "og:type", "twitter:card"]) {
            if (!meta(html, key)) fail(`${rel}: missing ${key}`);
        }
        const ogImage = meta(html, "og:image");
        if (ogImage) {
            if (!ogImage.startsWith(`${site.url}/`)) fail(`${rel}: og:image must be an absolute ${site.url} URL (got ${ogImage})`);
            else if (!resolvePath(new URL(ogImage).pathname)) fail(`${rel}: og:image file not found in build: ${ogImage}`);
        }
        if (meta(html, "og:url") !== canonical) fail(`${rel}: og:url does not match canonical`);
        if (rel.startsWith("stories/") && rel.split("/").length === 3 && rel !== "stories/index.html" && !rel.startsWith("stories/page/")) {
            if (meta(html, "og:type") !== "article") fail(`${rel}: story page should have og:type article`);
            if (!html.includes('"@type":"BlogPosting"')) fail(`${rel}: missing Article structured data`);
        }
    } else if (!/<meta name="robots" content="noindex"/.test(html)) {
        fail("404.html should be noindex");
    }

    for (const m of html.matchAll(/<(a|link|img|script|source)\b[^>]*>/g)) {
        const tag = m[0];
        for (const name of ["href", "src"]) {
            const value = attr(tag, name);
            if (value && value.startsWith("/") && !value.startsWith("//")) linkChecks.push({ from: file, href: value });
        }
        const srcset = attr(tag, "srcset");
        if (srcset) for (const part of srcset.split(",")) linkChecks.push({ from: file, href: part.trim().split(/\s+/)[0] });
    }
}

for (const { from, href } of linkChecks) {
    if (!href.startsWith("/")) continue;
    const target = resolvePath(href);
    if (!target) {
        fail(`${relative(outDir, from)}: broken internal link or asset ${href}`);
        continue;
    }
    const hash = href.split("#")[1];
    if (hash && target.endsWith(".html") && !idsByFile.get(target)?.has(hash)) {
        fail(`${relative(outDir, from)}: link ${href} points to a missing section #${hash}`);
    }
}

// ── 4. Stories: published ones built, drafts absent ──────────────────────
const listStories = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md") : []);
const raw: Record<string, string> = Object.fromEntries(
    storyDirs.flatMap((d) => listStories(join(root, d)).map((f) => [f, readFileSync(join(root, d, f), "utf8")])),
);
const storyFiles = Object.keys(raw);
const { stories, problems, drafts } = collectStories(raw);
const sitemap = existsSync(join(outDir, "sitemap.xml")) ? readFileSync(join(outDir, "sitemap.xml"), "utf8") : "";

for (const story of stories) {
    if (!existsSync(join(outDir, "stories", story.slug, "index.html"))) fail(`Published story not built: ${story.file}`);
    if (!sitemap.includes(`/stories/${story.slug}/`)) fail(`Published story missing from sitemap: ${story.file}`);
}
for (const file of storyFiles) {
    if (parseStoryFile(file, raw[file]).kind === "published") continue;
    const slug = slugify(file.replace(/\.md$/, ""));
    if (existsSync(join(outDir, "stories", slug))) fail(`Unpublished story was built: ${file}`);
    if (sitemap.includes(`/stories/${slug}/`)) fail(`Unpublished story is in the sitemap: ${file}`);
}

// Sample stories must never reach the live site.
if (hiddenSampleDir) {
    for (const file of listStories(hiddenSampleDir)) {
        const slug = slugify(file.replace(/\.md$/, ""));
        if (!(file in raw) && existsSync(join(outDir, "stories", slug))) fail(`Sample story was built although samples are hidden: ${file}`);
    }
}

// ── 5. Support page reflects the real donation / form configuration ──────
const supportFile = join(outDir, "support/index.html");
if (existsSync(supportFile)) {
    const html = readFileSync(supportFile, "utf8");
    const formTag = /<form[^>]*data-volunteer-form[^>]*>/.exec(html)?.[0] ?? "";
    if (!html.includes('id="donate"') || !html.includes('id="volunteer"')) fail("support page: missing #donate or #volunteer section");
    if (volunteerForm.endpoint) {
        if (attr(formTag, "action") !== volunteerForm.endpoint) fail("support page: form does not post to the configured endpoint");
    } else {
        // Never let an unconnected form look like it works.
        if (attr(formTag, "action")) fail("support page: form has an action but no endpoint is configured");
        if (!/<fieldset[^>]*\sdisabled/.test(html)) fail("support page: unconfigured form should be disabled");
    }
    for (const [id, url] of [["once", donations.oneOffUrl], ["monthly", donations.monthlyUrl]] as const) {
        const link = new RegExp(`<a[^>]*data-donate="${id}"[^>]*>`).exec(html)?.[0];
        if (url) {
            if (!link || attr(link, "href") !== url) fail(`support page: ${id} donation link should point to ${url}`);
        } else if (link || !html.includes(`data-donate-unavailable="${id}"`)) {
            fail(`support page: ${id} donation should show "Coming soon" when no link is configured`);
        }
    }
}

// ── 6. No credentials in the output ──────────────────────────────────────
const secretPatterns: [string, RegExp][] = [
    ["Bearer token", /Bearer\s+[A-Za-z0-9._-]{12,}/],
    ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}/],
    ["Stripe secret key", /\b[sr]k_(live|test)_[A-Za-z0-9]{10,}/],
    ["AWS key", /\bAKIA[0-9A-Z]{16}\b/],
    ["Private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];
const literalSecrets = [process.env.EVENTBRITE_TOKEN].filter((s): s is string => !!s && s.length >= 8);
for (const file of files.filter((f) => /\.(html|js|json|xml|txt|css)$/.test(f))) {
    const text = readFileSync(file, "utf8");
    for (const [label, re] of secretPatterns) if (re.test(text)) fail(`${relative(outDir, file)}: looks like it contains a ${label}`);
    for (const s of literalSecrets) if (text.includes(s)) fail(`${relative(outDir, file)}: contains the Eventbrite token`);
}

// ── Report ───────────────────────────────────────────────────────────────
const summary =
    `### Site checks\n\n- ${htmlFiles.length} HTML pages checked, ${linkChecks.length} internal links/assets verified\n` +
    `- Stories: ${stories.length} published, ${drafts} draft(s), ${problems.length} skipped because of problems\n` +
    problems.map((p) => `  - ⚠️ \`${p.file}\`: ${p.message}`).join("\n") +
    (errors.length ? `\n\n**${errors.length} error(s):**\n${errors.map((e) => `- ❌ ${e}`).join("\n")}\n` : "\n\n✅ All checks passed.\n");

if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
console.log(summary);
if (errors.length) process.exit(1);
