import { expect, test, type Page } from "@playwright/test";

const visibleScene = (page: Page) =>
    page.evaluate(() => [...document.querySelectorAll("[data-footer-scene]")].findIndex((el) => !(el as HTMLElement).hidden));

/** Animal names in each group placed around the page (not the footer). */
const placedGroups = (page: Page) =>
    page.locator(".cv-animal-group").evaluateAll((groups) =>
        groups.map((g) => [...g.children].map((c) => (c as HTMLElement).style.getPropertyValue("--cv-animal-src").match(/(\w+)\.svg/)?.[1])),
    );

test("footer shows one animal scene, different on each reload", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-footer-scene]:not([hidden])")).toHaveCount(1);

    let previous = await visibleScene(page);
    expect(previous).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < 5; i++) {
        await page.reload();
        const current = await visibleScene(page);
        expect(current).toBeGreaterThanOrEqual(0);
        expect(current).not.toBe(previous);
        previous = current;
    }
});

test("two animal groups appear around the page, in different places, never repeating an animal", async ({ page }) => {
    for (let i = 0; i < 5; i++) {
        await page.goto("/");
        const groups = await placedGroups(page);
        expect(groups).toHaveLength(2);
        const names = groups.flat();
        expect(new Set(names).size).toBe(names.length);
        const zones = await page.locator(".cv-animal-group").evaluateAll((gs) => gs.map((g) => g.parentElement!.dataset.animalZone));
        expect(new Set(zones).size).toBe(2);
    }
});

test("animal illustrations are decorative and can't be dragged or saved", async ({ page }) => {
    await page.goto("/support/");
    expect(await page.locator("img[src*='/illustrations/']").count()).toBe(0);
    const animals = page.locator(".cv-animal");
    expect(await animals.count()).toBeGreaterThan(0);
    for (const el of await animals.all()) {
        expect(await el.evaluate((e) => e.closest("[aria-hidden='true']") !== null)).toBe(true);
    }
    const group = page.locator(".cv-animal-group").first();
    expect(await group.evaluate((e) => getComputedStyle(e).pointerEvents)).toBe("none");
});
