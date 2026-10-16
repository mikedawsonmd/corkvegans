import { expect, test } from "@playwright/test";
import snapshot from "../../src/data/events.json" with { type: "json" };

const upcoming = snapshot.events.filter((e) => Date.parse(e.end ?? e.start) > Date.now());

test("homepage shows at most three upcoming events and links to the events page", async ({ page }) => {
    await page.goto("/");
    const cards = page.locator("#events [data-event-card]:visible");
    await expect(cards).toHaveCount(Math.min(3, upcoming.length));
    await page.getByRole("link", { name: "View all events" }).click();
    await expect(page).toHaveURL("/events/");
});

test("events page lists every upcoming event in date order with external links", async ({ page }) => {
    test.skip(upcoming.length === 0, "no upcoming events in the snapshot");
    await page.goto("/events/");
    const cards = page.locator("[data-event-card]:visible");
    await expect(cards).toHaveCount(upcoming.length);
    const ends = await cards.evaluateAll((els) => els.map((e) => Number((e as HTMLElement).dataset.eventEnd)));
    expect([...ends].sort((a, b) => a - b)).toEqual(ends);

    const link = cards.first().getByRole("link").first();
    await expect(link).toHaveAttribute("href", upcoming[0].registrationUrl);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
    await expect(cards.first()).toContainText(/via (Meetup|Eventbrite)/);
});

test("events that finish after the build are hidden in the browser", async ({ page }) => {
    test.skip(upcoming.length === 0, "no upcoming events in the snapshot");
    const firstEnd = Date.parse(upcoming[0].end ?? upcoming[0].start) + 60_000;
    await page.clock.setFixedTime(new Date(firstEnd));
    await page.goto("/events/");
    await expect(page.locator("[data-event-card]:visible")).toHaveCount(upcoming.length - 1);
});

test("an empty state and a 'last updated' notice show when everything is in the past", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2099-01-01T00:00:00Z"));
    await page.goto("/");
    await expect(page.locator("#events [data-event-card]:visible")).toHaveCount(0);
    await expect(page.getByText("No upcoming events right now")).toBeVisible();
    await expect(page.locator("#events [data-stale-notice]")).toBeVisible();
});

test("without JavaScript the build-time list still shows", async ({ browser }) => {
    test.skip(upcoming.length === 0, "no upcoming events in the snapshot");
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/events/");
    await expect(page.locator("[data-event-card]").first()).toBeVisible();
    await context.close();
});
