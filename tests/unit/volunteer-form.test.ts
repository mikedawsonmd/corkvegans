import { describe, expect, it } from "vitest";
import { validateVolunteer } from "../../src/scripts/volunteer-form.ts";

describe("volunteer form validation", () => {
    it("accepts a complete enquiry", () => {
        expect(validateVolunteer({ name: "Aoife", email: "aoife@example.ie", privacy: true })).toEqual({});
    });

    it("requires name, a valid email and the privacy acknowledgement", () => {
        expect(validateVolunteer({ name: " ", email: "", privacy: false })).toEqual({
            name: "Enter your name.",
            email: "Enter your email address.",
            privacy: "Tick the box to confirm you've read how we use your details.",
        });
    });

    it.each(["aoife", "aoife@", "aoife@example", "a b@example.ie"])("rejects the email %s", (email) => {
        expect(validateVolunteer({ name: "A", email, privacy: true }).email).toMatch(/format/);
    });

    it("limits name length", () => {
        expect(validateVolunteer({ name: "x".repeat(101), email: "a@b.ie", privacy: true }).name).toMatch(/100/);
    });
});
