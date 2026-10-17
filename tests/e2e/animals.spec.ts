import { expect, test } from "@playwright/test";

const visibleScene = (page: import("@playwright/test").Page) =>
    page.evaluate(() => [...document.querySelectorAll("[data-footer-scene]")].findIndex((el) => !(el as HTMLElement).hidden));

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

test("animal illustrations are decorative", async ({ page }) => {
    await page.goto("/");
    const animals = page.locator("img.cv-animal");
    expect(await animals.count()).toBeGreaterThan(0);
    for (const img of await animals.all()) {
        await expect(img).toHaveAttribute("alt", "");
    }
});
