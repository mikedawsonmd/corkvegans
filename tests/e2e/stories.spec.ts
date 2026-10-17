import { expect, test } from "@playwright/test";

test("stories listing shows published stories only, newest first, 12 at a time", async ({ page }) => {
    await page.goto("/stories/");
    const cards = page.locator("main article:visible");
    await expect(cards).toHaveCount(12);
    await expect(cards.first()).toContainText("Example: Review without a featured image");
    await expect(page.getByText("This draft must never be published")).toHaveCount(0);
    await expect(page.getByText("Published but missing a date")).toHaveCount(0);
    await expect(cards.first()).toContainText("Reviews");
    await expect(cards.first().locator("time")).toHaveText("1 October 2026");
    await expect(page.getByRole("status")).toHaveText("13 stories");

    await page.getByRole("button", { name: "Show more stories" }).click();
    await expect(cards).toHaveCount(13);
    await expect(page.getByRole("button", { name: "Show more stories" })).toBeHidden();
});

test("filters stories by category, with a shareable address", async ({ page }) => {
    await page.goto("/stories/");
    const chips = page.getByRole("group", { name: "Filter by category" });
    await expect(chips.getByRole("button")).toHaveText(["All 13", "Community 1", "News 11", "Reviews 1"]);

    await chips.getByRole("button", { name: /Reviews/ }).click();
    await expect(page).toHaveURL("/stories/?category=reviews");
    await expect(chips.getByRole("button", { name: /Reviews/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("main article:visible")).toHaveCount(1);
    await expect(page.getByRole("status")).toHaveText("1 story in Reviews");

    await page.goBack();
    await expect(page).toHaveURL("/stories/");
    await expect(page.locator("main article:visible")).toHaveCount(12);

    // Opening a filtered address directly applies it.
    await page.goto("/stories/?category=community");
    await expect(page.locator("main article:visible")).toHaveCount(1);
    await expect(page.locator("main article:visible")).toContainText("A sunny community picnic");
});

test("searches titles, summaries and authors, and clears back to everything", async ({ page }) => {
    await page.goto("/stories/");
    await page.getByLabel("Search stories").fill("picnic");
    await expect(page.locator("main article:visible")).toHaveCount(1);
    await expect(page).toHaveURL("/stories/?q=picnic");
    await expect(page.getByRole("status")).toHaveText("1 story matching “picnic”");

    await page.getByLabel("Search stories").fill("Test Author");
    await expect(page.locator("main article:visible").first()).toBeVisible();

    await page.getByLabel("Search stories").fill("zzzz no such story");
    await expect(page.getByText("No stories match")).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page.locator("main article:visible")).toHaveCount(12);
    await expect(page.getByLabel("Search stories")).toHaveValue("");
    await expect(page).toHaveURL("/stories/");
});

test("sorts oldest first and by title", async ({ page }) => {
    await page.goto("/stories/");
    const titles = page.locator("main article:visible h2");

    await page.getByLabel("Sort by").selectOption("oldest");
    await expect(page).toHaveURL("/stories/?sort=oldest");
    const oldest = await titles.allTextContents();
    await page.getByLabel("Sort by").selectOption("newest");
    const newest = await titles.allTextContents();
    expect(oldest[0]).not.toBe(newest[0]);

    await page.getByLabel("Sort by").selectOption("title");
    const byTitle = (await titles.allTextContents()).map((t) => t.trim());
    expect(byTitle).toEqual([...byTitle].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })));
});

test("category labels link to the filtered list", async ({ page }) => {
    await page.goto("/stories/example-community-picnic/");
    await page.getByRole("link", { name: "More Community stories" }).click();
    await expect(page).toHaveURL("/stories/?category=community");
    await expect(page.locator("main article:visible")).toHaveCount(1);
});

test("without JavaScript every story is listed and the controls stay hidden", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/stories/");
    await expect(page.locator("main article")).toHaveCount(13);
    await expect(page.getByLabel("Search stories")).toBeHidden();
    await context.close();
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
