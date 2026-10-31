import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests run against the fixtures build (`npm run build:fixtures`),
 * which contains example stories and test form and membership endpoints.
 */
// The tests read src/config/site.ts too, so they see the same test-build
// settings as the site they run against (e.g. features.payments on).
process.env.CV_FIXTURES = "1";

export default defineConfig({
    testDir: "tests/e2e",
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
    use: {
        baseURL: "http://localhost:4322",
        trace: "retain-on-failure",
    },
    projects: [
        { name: "desktop", use: { ...devices["Desktop Chrome"] } },
        { name: "mobile", use: { ...devices["Pixel 7"] } },
    ],
    webServer: {
        command: "node_modules/.bin/astro preview --outDir dist-fixtures --port 4322 --ignore-lock",
        url: "http://localhost:4322/",
        reuseExistingServer: !process.env.CI,
        env: { CV_FIXTURES: "1" },
    },
});
