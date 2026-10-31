/**
 * The membership card's token in this browser: saved when the member opens
 * the card link from their welcome email (/membership/card/#<token>) or the
 * thank-you screen, so the card opens again from the Membership page or the
 * home screen. The last answer from the Worker is kept too, so the card still
 * shows without a signal, but only within the same calendar month.
 * Storage can be unavailable, so every access is wrapped.
 */

export const CARD_TOKEN = /^sub_[A-Za-z0-9]{8,64}\.[A-Za-z0-9_-]{22}$/;

const TOKEN_KEY = "cv-card-token";
const STATUS_KEY = "cv-card-status";

export interface CardStatus {
    status: "valid" | "ended";
    firstName?: string;
    endsOn?: string;
    /** ISO time of the check. */
    checkedAt: string;
}

function read(key: string): string | null {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function write(key: string, value: string | null) {
    try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
    } catch {
        // Not saved; the card link in the email still works.
    }
}

export function savedCardToken(): string | null {
    const token = read(TOKEN_KEY);
    return token && CARD_TOKEN.test(token) ? token : null;
}

export function saveCardToken(token: string) {
    if (!CARD_TOKEN.test(token)) return;
    if (savedCardToken() !== token) write(STATUS_KEY, null);
    write(TOKEN_KEY, token);
}

/** YYYY-MM in Irish time. */
export const irishMonth = (date: Date) => date.toLocaleDateString("en-CA", { timeZone: "Europe/Dublin" }).slice(0, 7);

/** The last answer, if it was this month (Irish time). */
export function cachedCardStatus(now = new Date()): CardStatus | null {
    try {
        const cached = JSON.parse(read(STATUS_KEY) ?? "null") as CardStatus | null;
        if (!cached || (cached.status !== "valid" && cached.status !== "ended")) return null;
        return irishMonth(new Date(cached.checkedAt)) === irishMonth(now) ? cached : null;
    } catch {
        return null;
    }
}

export function saveCardStatus(status: CardStatus) {
    write(STATUS_KEY, JSON.stringify(status));
}
