/**
 * Membership amounts, limits and member codes, shared by the Support page
 * form, the events list and their tests. The Worker (worker/membership.js)
 * enforces the same amounts on the server; a unit test keeps the two in step.
 */

export type Frequency = "monthly" | "yearly";

export const FREQUENCIES: { value: Frequency; label: string }[] = [
    { value: "monthly", label: "Monthly" },
    { value: "yearly", label: "Yearly" },
];

/** Preset amounts in whole euros; each has a catalogue price in Stripe (lookup key membership_<frequency>_<amount>). */
export const PRESETS: Record<Frequency, number[]> = {
    monthly: [5, 10, 15],
    yearly: [50, 100],
};

/** Selected when the form loads, or when switching frequency. */
export const DEFAULT_AMOUNT: Record<Frequency, number> = { monthly: 10, yearly: 50 };

/** "Other" amounts, in whole euros. */
export const LIMITS: Record<Frequency, { min: number; max: number }> = {
    monthly: { min: 2, max: 500 },
    yearly: { min: 50, max: 500 },
};

const PER: Record<Frequency, string> = { monthly: "a month", yearly: "a year" };

export const formatAmount = (amount: number, frequency: Frequency) => `€${amount} ${PER[frequency]}`;

export const amountHint = (frequency: Frequency) => `Whole euros, from €${LIMITS[frequency].min} to €${LIMITS[frequency].max} ${PER[frequency]}.`;

/** Validates the "Other" amount box. Accepts "15", " 15 " or "€15". */
export function parseAmount(raw: string, frequency: Frequency): { amount: number } | { error: string } {
    const { min, max } = LIMITS[frequency];
    const value = raw.trim().replace(/^€\s*/, "");
    if (!value) return { error: "Enter an amount in euros." };
    if (!/^\d+$/.test(value)) return { error: "Enter a whole number of euros, like 15." };
    const amount = Number(value);
    if (amount < min) return { error: `The smallest ${frequency} amount is €${min} ${PER[frequency]}.` };
    if (amount > max) return { error: `The most we can take online is €${max} ${PER[frequency]}. Get in touch if you'd like to do more.` };
    return { amount };
}

/** Member codes look like CV-7K3P9Q: no 0/O, 1/I/L or other look-alikes. */
export const MEMBER_CODE = /^CV-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;

const EVENTBRITE_HOST = /(^|\.)eventbrite\.(ie|com|co\.uk)$/;

/** Adds the member's code to an Eventbrite event link, so Eventbrite applies it at checkout. Other links are unchanged. */
export function withMemberCode(href: string, code: string, param: string): string {
    if (!MEMBER_CODE.test(code) || !param) return href;
    try {
        const url = new URL(href);
        if (url.protocol !== "https:" || !EVENTBRITE_HOST.test(url.hostname)) return href;
        url.searchParams.set(param, code);
        return url.href;
    } catch {
        return href;
    }
}
