import { describe, expect, it } from "vitest";
import { CONTACT_TOPICS, countLinks, looksAutomated, MIN_FILL_TIME_MS, topicFromQuery, validateContact } from "../../src/scripts/contact-form.ts";

const complete = { name: "Aoife", email: "aoife@example.ie", message: "Could we do a potluck in Fitzgerald's Park?", link: "", privacy: true };

describe("contact form validation", () => {
    it("accepts a complete message, with or without a link", () => {
        expect(validateContact(complete)).toEqual({});
        expect(validateContact({ ...complete, link: "mygoodness.ie" })).toEqual({});
        expect(validateContact({ ...complete, link: "https://www.instagram.com/corkvegans/" })).toEqual({});
    });

    it("requires name, email, a message and the privacy acknowledgement", () => {
        expect(validateContact({ name: " ", email: "", message: "", link: "", privacy: false })).toEqual({
            name: "Enter your name.",
            email: "Enter your email address.",
            message: "Enter your message.",
            privacy: "Tick the box to confirm you've read how we use your details.",
        });
    });

    it("asks for more than a word or two, and limits length and links", () => {
        expect(validateContact({ ...complete, message: "Hi" }).message).toMatch(/a little more/);
        expect(validateContact({ ...complete, message: "x".repeat(3001) }).message).toMatch(/3000/);
        const links = "see https://a.ie https://b.ie https://c.ie https://d.ie";
        expect(validateContact({ ...complete, message: links }).message).toMatch(/no more than 3 links/);
    });

    it("checks the optional link looks like a web address", () => {
        expect(validateContact({ ...complete, link: "not a link" }).link).toMatch(/web address/);
    });

    it("rejects malformed email addresses", () => {
        expect(validateContact({ ...complete, email: "aoife@example" }).email).toMatch(/format/);
    });
});

describe("topics", () => {
    it("has unique ids that are safe to use in links", () => {
        const ids = CONTACT_TOPICS.map((t) => t.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const id of ids) expect(id).toMatch(/^[a-z]+$/);
    });

    it("chooses the topic from a link, falling back to the first", () => {
        expect(topicFromQuery("?topic=event").label).toBe("Suggest an event");
        expect(topicFromQuery("?topic=RECOMMEND").id).toBe("recommend");
        expect(topicFromQuery("?topic=nonsense")).toBe(CONTACT_TOPICS[0]);
        expect(topicFromQuery("")).toBe(CONTACT_TOPICS[0]);
    });
});

describe("spam detection", () => {
    it("counts links", () => {
        expect(countLinks("http://a.ie and www.b.ie")).toBe(2);
    });

    it("drops bot-like submissions", () => {
        expect(looksAutomated({ gotcha: "spam", elapsedMs: 60_000 })).toBe(true);
        expect(looksAutomated({ gotcha: "", elapsedMs: MIN_FILL_TIME_MS - 1 })).toBe(true);
        expect(looksAutomated({ gotcha: "", elapsedMs: MIN_FILL_TIME_MS })).toBe(false);
    });
});
