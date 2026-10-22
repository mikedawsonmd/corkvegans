/**
 * Checks that the Meta token used for social posting still works, so a
 * broken token shows up as a failed weekly run (and an email from GitHub)
 * rather than as a story that didn't get posted. Run by
 * .github/workflows/social-token-check.yml. It only reads; nothing is posted.
 *
 *   node scripts/check-social-token.ts
 *
 * Environment:
 *   META_PAGE_ID, META_IG_USER_ID, META_PAGE_ACCESS_TOKEN  (GitHub secrets)
 * See docs/social-publishing.md, section 1.5.
 */

import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { graph, scrub, type Credentials, type FetchLike } from "./post-social.ts";

/** Permissions posting needs (pages_show_list is only used to find the Page when making a token). */
export const REQUIRED_SCOPES = ["pages_read_engagement", "pages_manage_posts", "instagram_basic", "instagram_content_publish"];
/** Fail this many days before the token, or its data access, expires. */
export const WARN_DAYS = 30;

export interface CheckResult {
    problems: string[];
    notes: string[];
}

/** What Meta's /debug_token returns about a token (times are Unix seconds; 0 means never). */
interface TokenInfo {
    is_valid?: boolean;
    type?: string;
    profile_id?: string;
    scopes?: string[];
    expires_at?: number;
    data_access_expires_at?: number;
}

export async function checkToken(fetchImpl: FetchLike, creds: Partial<Credentials>, now = new Date()): Promise<CheckResult> {
    const result: CheckResult = { problems: [], notes: [] };
    const secretNames = { pageId: "META_PAGE_ID", igUserId: "META_IG_USER_ID", token: "META_PAGE_ACCESS_TOKEN" };
    const missing = (["pageId", "igUserId", "token"] as const).filter((k) => !creds[k]);
    if (missing.length > 0) {
        result.problems.push(`Missing GitHub secrets: ${missing.map((k) => secretNames[k]).join(", ")}.`);
        return result;
    }
    const { pageId, igUserId, token } = creds as Credentials;
    const message = (err: unknown) => scrub(err instanceof Error ? err.message : String(err), token);

    // 1. Can it read the Page, and is it linked to the Instagram account we post to?
    try {
        const page = await graph(fetchImpl, token, "GET", `/${pageId}`, { fields: "name,instagram_business_account" });
        result.notes.push(`Facebook Page: ${String(page.name)}`);
        const linked = (page.instagram_business_account as { id?: string } | undefined)?.id;
        if (!linked) result.problems.push("The token can't see an Instagram account linked to the Page. Check the link (section 1.1) and that the token has instagram_basic.");
        else if (linked !== igUserId) result.problems.push(`META_IG_USER_ID (${igUserId}) isn't the Instagram account linked to the Page (${linked}).`);
    } catch (err) {
        // Nothing else will work either, so stop here.
        result.problems.push(`Can't read the Facebook Page: ${message(err)}`);
        return result;
    }

    // 2. Can it read the Instagram account?
    try {
        const ig = await graph(fetchImpl, token, "GET", `/${igUserId}`, { fields: "username" });
        result.notes.push(`Instagram: @${String(ig.username)}`);
    } catch (err) {
        result.problems.push(`Can't read the Instagram account: ${message(err)}`);
    }

    // 3. Its type, permissions and expiry. Meta doesn't always let a token
    // inspect itself, so if this call fails it's noted rather than failed.
    let info: TokenInfo | undefined;
    try {
        info = ((await graph(fetchImpl, token, "GET", "/debug_token", { input_token: token })) as { data?: TokenInfo }).data;
    } catch (err) {
        result.notes.push(`Couldn't read the token's details, so its type, permissions and expiry weren't checked (${message(err)}).`);
    }
    if (!info) return result;

    if (info.is_valid === false) result.problems.push("Meta says the token is no longer valid.");
    if (info.type && info.type !== "PAGE") {
        result.problems.push(`It's a ${info.type.toLowerCase()} token, not a Page token, so Facebook posts will fail. Use the Page token from me/accounts (section 1.4, step 4).`);
    } else if (info.profile_id && info.profile_id !== pageId) {
        result.problems.push(`The token is for a different Page (${info.profile_id}), not META_PAGE_ID (${pageId}).`);
    }
    const missingScopes = REQUIRED_SCOPES.filter((s) => info.scopes && !info.scopes.includes(s));
    if (missingScopes.length > 0) result.problems.push(`The token is missing permissions: ${missingScopes.join(", ")}.`);

    for (const [seconds, what] of [
        [info.expires_at, "The token"],
        [info.data_access_expires_at, "The token's data access"],
    ] as const) {
        if (!seconds) continue;
        const date = new Date(seconds * 1000);
        const day = date.toISOString().slice(0, 10);
        const daysLeft = (date.getTime() - now.getTime()) / 86_400_000;
        if (daysLeft < 0) result.problems.push(`${what} expired on ${day}.`);
        else if (daysLeft < WARN_DAYS) result.problems.push(`${what} expires on ${day}, in ${Math.ceil(daysLeft)} days.`);
        else result.notes.push(`${what} expires on ${day}.`);
    }
    if (!info.expires_at && !info.data_access_expires_at) result.notes.push("The token never expires.");
    return result;
}

// ── Command line ──────────────────────────────────────────────────────────

async function main() {
    const token = process.env.META_PAGE_ACCESS_TOKEN?.trim();
    const result = await checkToken(fetch, { pageId: process.env.META_PAGE_ID?.trim(), igUserId: process.env.META_IG_USER_ID?.trim(), token });
    const fix = "To fix it, see docs/social-publishing.md, section 1.5.";

    console.log([...result.notes, ...result.problems.map((p) => `::error title=Social media token problem::${p} ${fix}`)].join("\n"));
    console.log(result.problems.length === 0 ? "The token works." : `Problems: ${result.problems.length}`);

    if (process.env.GITHUB_STEP_SUMMARY) {
        const lines = [...result.problems.map((p) => `- ❌ ${p}`), ...result.notes.map((n) => `- ${n}`)];
        appendFileSync(
            process.env.GITHUB_STEP_SUMMARY,
            `### Social media token: ${result.problems.length === 0 ? "✅ working" : "❌ needs attention"}\n\n${lines.join("\n")}\n${result.problems.length ? `\n${fix}\n` : ""}`,
        );
    }
    if (result.problems.length > 0) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main().catch((err) => {
        console.error(`::error title=Social media token check crashed::${scrub(err instanceof Error ? err.message : String(err), process.env.META_PAGE_ACCESS_TOKEN)}`);
        process.exitCode = 1;
    });
}
