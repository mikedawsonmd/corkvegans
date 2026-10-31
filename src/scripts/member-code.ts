/**
 * Remembers a member's code in this browser, so Eventbrite links on our events
 * list apply it automatically. The code arrives from the thank-you screen
 * after joining, or from the "?member=CODE" link in the welcome email.
 * Storage can be unavailable (private windows, blocked site data), so every
 * access is wrapped and the page works the same without it.
 */

import { MEMBER_CODE, withMemberCode } from "../lib/membership.ts";

const KEY = "cv-member-code";

export function savedMemberCode(): string | null {
    try {
        const code = localStorage.getItem(KEY);
        return code && MEMBER_CODE.test(code) ? code : null;
    } catch {
        return null;
    }
}

export function saveMemberCode(code: string) {
    if (!MEMBER_CODE.test(code)) return;
    try {
        localStorage.setItem(KEY, code);
    } catch {
        // Not saved; the member can still type it in on Eventbrite.
    }
}

/** Saves the code from "?member=CODE" and takes it out of the address bar. */
export function rememberCodeFromUrl() {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("member")?.trim().toUpperCase();
    if (!url.searchParams.has("member")) return;
    if (code) saveMemberCode(code);
    url.searchParams.delete("member");
    history.replaceState(history.state, "", url.pathname + url.search + url.hash);
}

/** Adds the saved code to Eventbrite links inside each [data-member-code-param] element. */
export function applyMemberCode(root: ParentNode = document, code = savedMemberCode()) {
    if (!code) return;
    root.querySelectorAll<HTMLElement>("[data-member-code-param]").forEach((list) => {
        const param = list.dataset.memberCodeParam ?? "";
        list.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((a) => {
            a.href = withMemberCode(a.href, code, param);
        });
    });
}
