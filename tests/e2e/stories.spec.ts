import { expect, test } from "@playwright/test";

test("stories listing shows published stories only, newest first, with pagination", async ({ page }) => {
    await page.goto("/stories/");
    const cards = page.locator("main article");
    await expect(cards).toHaveCount(12);
    await expect(cards.first()).toContainText("Example: Review without a featured image");
    await expect(page.getByText("This draft must never be published")).toHaveCount(0);
    await expect(page.getByText("Published but missing a date")).toHaveCount(0);
    await expect(cards.first()).toContainText("Reviews");
    await expect(cards.first().locator("time")).toHaveText("1 October 2026");

    await page.getByRole("link", { name: "Older stories" }).click();
    await expect(page).toHaveURL("/stories/page/2/");
    await expect(page.locator("main article")).toHaveCount(1);
});

test("drafts and invalid stories are not built", async ({ request }) => {
    expect((await request.get("/stories/example-secret-draft/")).status()).toBe(404);
    expect((await request.get("/stories/example-missing-date/")).status()).toBe(404);
    const sitemap = await (await request.get("/sitemap.xml")).text();
    expect(sitemap).not.toContain("example-secret-draft");
    expect(sitemap).toContain("https://corkvegans.ie/stories/example-community-picnic/");
});

test("homepage previews the three latest stories", async ({ page }) => {
    await page.goto("/");
    const section = page.locator("section", { has: page.getByRole("heading", { name: "Latest stories" }) });
    await expect(section.locator("article")).toHaveCount(3);
    await section.getByRole("link", { name: "View all stories" }).click();
    await expect(page).toHaveURL("/stories/");
});

test("article page has content, metadata and working navigation", async ({ page }) => {
    await page.goto("/stories/example-community-picnic/");
    await expect(page).toHaveTitle("Example: A sunny community picnic | Cork Vegans");
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute("content", "article");
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", "https://corkvegans.ie/stories/example-community-picnic/");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://corkvegans.ie/stories/example-community-picnic/");
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /^https:\/\/corkvegans\.ie\/_astro\/.+\.jpg$/);

    await expect(page.getByText("By Test Author")).toBeVisible();
    await expect(page.locator("main time").first()).toHaveText("20 September 2026");
    await expect(page.getByText(/Updated/)).toBeVisible();
    await expect(page.locator(".cv-prose h2").first()).toHaveText("A heading the editor typed as H1");
    await expect(page.locator(".cv-prose blockquote")).toBeVisible();
    await expect(page.locator(".cv-prose script, .cv-prose iframe")).toHaveCount(0);

    const featured = page.locator("figure img");
    await expect(featured).toHaveAttribute("alt", "A group of people standing in a field with a sheep");
    expect(await featured.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

    await page.getByRole("link", { name: "All stories", exact: true }).click();
    await expect(page).toHaveURL("/stories/");
});

test("story without an image uses the fallback and the default share image", async ({ page }) => {
    await page.goto("/stories/example-no-image-review/");
    await expect(page.locator("figure")).toHaveCount(0);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", "https://corkvegans.ie/images/share-default.jpg");
    const res = await page.request.get("/images/share-default.jpg");
    expect(res.status()).toBe(200);
    await page.goto("/stories/");
    const card = page.locator("article", { hasText: "Review without a featured image" });
    await expect(card.locator('[aria-hidden="true"] img')).toBeAttached();
});

test("share actions use the article's canonical URL", async ({ page, context, browserName }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/stories/example-community-picnic/");
    const share = page.locator("[data-share]");
    const url = "https://corkvegans.ie/stories/example-community-picnic/";
    await expect(share.getByRole("link", { name: /WhatsApp/ })).toHaveAttribute("href", `https://wa.me/?text=${encodeURIComponent(`Example: A sunny community picnic ${url}`)}`);
    await expect(share.getByRole("link", { name: /Facebook/ })).toHaveAttribute("href", `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`);

    test.skip(browserName !== "chromium", "clipboard permissions");
    await share.getByRole("button", { name: "Copy link" }).click();
    await expect(share.locator("[data-share-status]")).toHaveText("Link copied to clipboard.");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
});
