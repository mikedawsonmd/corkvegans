import { describe, expect, it } from "vitest";
import { checkToken, WARN_DAYS } from "../../scripts/check-social-token.ts";

const TOKEN = "EAAB-secret-page-token-123";
const creds = { pageId: "111", igUserId: "222", token: TOKEN };
const NOW = new Date("2026-10-22T08:00:00Z");
const inDays = (days: number) => Math.floor(NOW.getTime() / 1000) + days * 86_400;

const SCOPES = ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "instagram_basic", "instagram_content_publish"];

/** A fake Meta Graph API. `debug` replaces the /debug_token data; `fail` makes matching calls return an error. */
function fakeMeta(overrides: { page?: Record<string, unknown>; debug?: Record<string, unknown>; fail?: RegExp; errorCode?: number } = {}) {
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
        urls.push(url);
        const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
        const path = new URL(url).pathname;
        if (overrides.fail?.test(path)) return json({ error: { message: "Error validating access token", code: overrides.errorCode ?? 190 } }, 400);
        if (path.endsWith("/111")) return json({ name: "Cork Vegans", instagram_business_account: { id: "222" }, id: "111", ...overrides.page });
        if (path.endsWith("/222")) return json({ username: "corkvegans", id: "222" });
        if (path.endsWith("/debug_token")) {
            return json({ data: { is_valid: true, type: "PAGE", profile_id: "111", scopes: SCOPES, expires_at: 0, data_access_expires_at: 0, ...overrides.debug } });
        }
        return json({ error: { message: `unexpected ${url}` } }, 404);
    };
    return { urls, fetchImpl };
}

describe("checkToken", () => {
    it("passes a never-expiring Page token that can see the Page and Instagram", async () => {
        const { fetchImpl } = fakeMeta();
        const r = await checkToken(fetchImpl, creds, NOW);
        expect(r.problems).toEqual([]);
        expect(r.notes).toEqual(["Facebook Page: Cork Vegans", "Instagram: @corkvegans", "The token never expires."]);
    });

    it("only reads: every call is a GET", async () => {
        const urls: string[] = [];
        const methods: string[] = [];
        const { fetchImpl } = fakeMeta();
        await checkToken(async (url, init) => (urls.push(url), methods.push(init?.method ?? "GET"), fetchImpl(url)), creds, NOW);
        expect(urls).toHaveLength(3);
        expect(new Set(methods)).toEqual(new Set(["GET"]));
    });

    it("reports missing secrets without calling Meta", async () => {
        const { urls, fetchImpl } = fakeMeta();
        const r = await checkToken(fetchImpl, { pageId: "111" }, NOW);
        expect(r.problems).toEqual(["Missing GitHub secrets: META_IG_USER_ID, META_PAGE_ACCESS_TOKEN."]);
        expect(urls).toEqual([]);
    });

    it("stops at a dead token and says how to fix it", async () => {
        const { urls, fetchImpl } = fakeMeta({ fail: /./ });
        const r = await checkToken(fetchImpl, creds, NOW);
        expect(r.problems).toHaveLength(1);
        expect(r.problems[0]).toMatch(/^Can't read the Facebook Page: Error validating access token \(code 190\)\. The Page access token has expired or been revoked/);
        expect(urls).toHaveLength(1);
    });

    it("flags an Instagram account that isn't linked, or isn't the one in the secrets", async () => {
        const unlinked = await checkToken(fakeMeta({ page: { instagram_business_account: undefined } }).fetchImpl, creds, NOW);
        expect(unlinked.problems).toEqual([expect.stringMatching(/can't see an Instagram account linked/)]);
        const other = await checkToken(fakeMeta({ page: { instagram_business_account: { id: "333" } } }).fetchImpl, creds, NOW);
        expect(other.problems).toEqual(["META_IG_USER_ID (222) isn't the Instagram account linked to the Page (333)."]);
    });

    it("flags a user token, a different Page, and missing permissions", async () => {
        const user = await checkToken(fakeMeta({ debug: { type: "USER" } }).fetchImpl, creds, NOW);
        expect(user.problems).toEqual([expect.stringMatching(/^It's a user token, not a Page token/)]);
        const otherPage = await checkToken(fakeMeta({ debug: { profile_id: "999" } }).fetchImpl, creds, NOW);
        expect(otherPage.problems).toEqual(["The token is for a different Page (999), not META_PAGE_ID (111)."]);
        const scopes = await checkToken(fakeMeta({ debug: { scopes: ["pages_show_list", "instagram_basic"] } }).fetchImpl, creds, NOW);
        expect(scopes.problems).toEqual(["The token is missing permissions: pages_read_engagement, pages_manage_posts, instagram_content_publish."]);
    });

    it(`fails within ${WARN_DAYS} days of an expiry, and notes later ones`, async () => {
        const soon = await checkToken(fakeMeta({ debug: { data_access_expires_at: inDays(10) } }).fetchImpl, creds, NOW);
        expect(soon.problems).toEqual(["The token's data access expires on 2026-11-01, in 10 days."]);
        const past = await checkToken(fakeMeta({ debug: { expires_at: inDays(-1), is_valid: false } }).fetchImpl, creds, NOW);
        expect(past.problems).toEqual(["Meta says the token is no longer valid.", "The token expired on 2026-10-21."]);
        const later = await checkToken(fakeMeta({ debug: { data_access_expires_at: inDays(90) } }).fetchImpl, creds, NOW);
        expect(later.problems).toEqual([]);
        expect(later.notes).toContain("The token's data access expires on 2027-01-20.");
    });

    it("only notes it when Meta won't show the token's details", async () => {
        const r = await checkToken(fakeMeta({ fail: /debug_token/, errorCode: 100 }).fetchImpl, creds, NOW);
        expect(r.problems).toEqual([]);
        expect(r.notes.at(-1)).toMatch(/^Couldn't read the token's details/);
    });

    it("never includes the token in its messages", async () => {
        const r = await checkToken(fakeMeta({ fail: /./ }).fetchImpl, creds, NOW);
        expect(JSON.stringify(r)).not.toContain(TOKEN);
    });
});
