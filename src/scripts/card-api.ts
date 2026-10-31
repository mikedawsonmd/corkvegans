/**
 * Asks the membership Worker whether a card is valid (POST /membership/card),
 * for the card page and the check page a business opens from the QR code.
 */

import { CARD_TOKEN } from "./member-card.ts";

export type CardAnswer =
    | { kind: "valid"; firstName?: string; endsOn?: string }
    | { kind: "ended" }
    /** Not a genuine card: a typo in the link, or someone else's site. */
    | { kind: "not_found" }
    /** No connection, rate limited or the Worker's down: try again. */
    | { kind: "error" };

const NAME = /^[^\u0000-\u001f<>]{1,60}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function checkCard(endpoint: string, token: string): Promise<CardAnswer> {
    if (!CARD_TOKEN.test(token)) return { kind: "not_found" };
    try {
        const res = await fetch(`${endpoint}/membership/card`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
        });
        if (res.status === 404) return { kind: "not_found" };
        if (!res.ok) return { kind: "error" };
        const data = (await res.json()) as { status?: string; firstName?: unknown; endsOn?: unknown };
        if (data.status === "ended") return { kind: "ended" };
        if (data.status !== "valid") return { kind: "error" };
        return {
            kind: "valid",
            ...(typeof data.firstName === "string" && NAME.test(data.firstName) ? { firstName: data.firstName } : {}),
            ...(typeof data.endsOn === "string" && DATE.test(data.endsOn) ? { endsOn: data.endsOn } : {}),
        };
    } catch {
        return { kind: "error" };
    }
}

/** The token after # in the address, if it looks like one. */
export function tokenFromHash(hash = window.location.hash): string | null {
    const token = hash.replace(/^#/, "").trim();
    return CARD_TOKEN.test(token) ? token : null;
}

/** "15 January 2027" from "2027-01-15". */
export const formatEndsOn = (iso: string) =>
    new Intl.DateTimeFormat("en-IE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
