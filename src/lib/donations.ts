/**
 * Donation amounts and limits shared by the Support page form and its tests.
 * The Worker (worker/donate.js) enforces the same limits on the server; a
 * unit test keeps the two in step.
 */

export type Frequency = "monthly" | "once";

/** Whole euros. */
export const DONATION_MIN = 2;
export const DONATION_MAX = 500;

export const FREQUENCIES: { value: Frequency; label: string }[] = [
    { value: "monthly", label: "Monthly" },
    { value: "once", label: "Once" },
];

/** Preset amount buttons; the middle one is selected by default. */
export const PRESETS: Record<Frequency, number[]> = {
    monthly: [5, 10, 20],
    once: [10, 20, 50],
};

export const formatAmount = (amount: number, frequency: Frequency) => (frequency === "monthly" ? `€${amount} a month` : `€${amount}`);

/** Validates the "Other" amount box. Accepts "15", " 15 " or "€15". */
export function parseAmount(raw: string): { amount: number } | { error: string } {
    const value = raw.trim().replace(/^€\s*/, "");
    if (!value) return { error: "Enter an amount in euros." };
    if (!/^\d+$/.test(value)) return { error: "Enter a whole number of euros, like 15." };
    const amount = Number(value);
    if (amount < DONATION_MIN) return { error: `The smallest donation we can take is €${DONATION_MIN}.` };
    if (amount > DONATION_MAX) return { error: `The most you can give online is €${DONATION_MAX}. For a larger gift, please get in touch.` };
    return { amount };
}
