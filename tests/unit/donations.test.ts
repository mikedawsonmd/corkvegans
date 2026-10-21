import { describe, expect, it } from "vitest";
import { DONATION_MAX, DONATION_MIN, PRESETS, formatAmount, parseAmount } from "../../src/lib/donations.ts";
import * as worker from "../../worker/donate.js";

describe("donation amounts", () => {
    it.each([
        ["15", 15],
        [" 15 ", 15],
        ["€15", 15],
        ["€ 2", 2],
        ["500", 500],
    ])("accepts %j", (raw, amount) => {
        expect(parseAmount(raw)).toEqual({ amount });
    });

    it.each([
        ["", /Enter an amount/],
        ["15.50", /whole number/],
        ["15,5", /whole number/],
        ["-5", /whole number/],
        ["ten", /whole number/],
        ["1", /smallest donation we can take is €2/],
        ["0", /smallest/],
        ["501", /most you can give online is €500/],
    ])("rejects %j", (raw, message) => {
        const result = parseAmount(raw);
        expect("error" in result && result.error).toMatch(message);
    });

    it("keeps presets within the limits and matches the Worker's limits", () => {
        expect([worker.DONATION_MIN, worker.DONATION_MAX]).toEqual([DONATION_MIN, DONATION_MAX]);
        for (const amount of [...PRESETS.monthly, ...PRESETS.once]) {
            expect(amount).toBeGreaterThanOrEqual(DONATION_MIN);
            expect(amount).toBeLessThanOrEqual(DONATION_MAX);
        }
    });

    it("formats amounts for people", () => {
        expect(formatAmount(10, "monthly")).toBe("€10 a month");
        expect(formatAmount(50, "once")).toBe("€50");
    });
});
