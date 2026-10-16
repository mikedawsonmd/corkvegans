import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { fetchMeetupEvents, parseMeetupIcal } from "../../src/lib/events/meetup.ts";

const opts = { groupName: "Cork Vegans", timeZone: "Europe/Dublin" };
const realFeed = readFileSync(new URL("../fixtures/meetup-feed.ics", import.meta.url), "utf8");

function feed(...events: string[]) {
    return ["BEGIN:VCALENDAR", "VERSION:2.0", ...events, "END:VCALENDAR"].join("\r\n");
}
function vevent(fields: Record<string, string>) {
    return ["BEGIN:VEVENT", ...Object.entries(fields).map(([k, v]) => `${k}:${v}`), "END:VEVENT"].join("\r\n");
}

describe("Meetup iCal feed", () => {
    it("parses the real Cork Vegans feed snapshot", () => {
        const events = parseMeetupIcal(realFeed, opts);
        expect(events.length).toBeGreaterThan(0);
        const first = events.find((e) => e.id === "meetup:316851291")!;
        expect(first).toMatchObject({
            source: "meetup",
            title: "Monthly Social - My Goodness",
            start: "2026-11-07T11:00:00.000Z",
            end: "2026-11-07T12:00:00.000Z",
            timeZone: "Europe/Dublin",
            url: "https://www.meetup.com/corkvegans/events/316851291/",
            registrationUrl: "https://www.meetup.com/corkvegans/events/316851291/",
            status: "scheduled",
            image: null,
        });
    });

    it("produces clean summaries without the group name or social-links block", () => {
        const [first] = parseMeetupIcal(realFeed, opts);
        expect(first.summary.startsWith("Meeting new people")).toBe(true);
        expect(first.summary).not.toMatch(/Connect with us|Linktree|\*\*|\]\(/);
        expect(first.summary.length).toBeLessThanOrEqual(280);
    });

    it("converts summer events to UTC correctly", () => {
        const [ev] = parseMeetupIcal(
            feed(vevent({ UID: "event_1@meetup.com", SUMMARY: "Summer walk", "DTSTART;TZID=Europe/Dublin": "20270710T110000", URL: "https://www.meetup.com/corkvegans/events/1/" })),
            opts,
        );
        expect(ev.start).toBe("2027-07-10T10:00:00.000Z");
        expect(ev.end).toBeNull();
    });

    it("marks cancelled events", () => {
        const [ev] = parseMeetupIcal(
            feed(vevent({ SUMMARY: "Potluck", STATUS: "CANCELLED", DTSTART: "20270710T110000Z", URL: "https://www.meetup.com/corkvegans/events/2/" })),
            opts,
        );
        expect(ev.status).toBe("cancelled");
    });

    it("reads locations and online events", () => {
        const events = parseMeetupIcal(
            feed(
                vevent({ SUMMARY: "Dinner", LOCATION: "My Goodness (Cork\\, Ireland)", DTSTART: "20270710T110000Z", URL: "https://www.meetup.com/corkvegans/events/3/" }),
                vevent({ SUMMARY: "Talk", LOCATION: "Online event", DTSTART: "20270710T110000Z", URL: "https://www.meetup.com/corkvegans/events/4/" }),
            ),
            opts,
        );
        expect(events[0].location).toEqual({ name: "My Goodness (Cork, Ireland)", address: null, online: false });
        expect(events[1].location).toEqual({ name: null, address: null, online: true });
    });

    it("skips entries without a title, start or a valid meetup.com https URL", () => {
        const events = parseMeetupIcal(
            feed(
                vevent({ SUMMARY: "", DTSTART: "20270710T110000Z", URL: "https://www.meetup.com/corkvegans/events/5/" }),
                vevent({ SUMMARY: "No start", URL: "https://www.meetup.com/corkvegans/events/6/" }),
                vevent({ SUMMARY: "Bad URL", DTSTART: "20270710T110000Z", URL: "javascript:alert(1)" }),
                vevent({ SUMMARY: "Other host", DTSTART: "20270710T110000Z", URL: "https://evil.example/events/7/" }),
                vevent({ SUMMARY: "HTTP", DTSTART: "20270710T110000Z", URL: "http://www.meetup.com/corkvegans/events/8/" }),
            ),
            opts,
        );
        expect(events).toEqual([]);
    });

    it("throws on HTTP errors and non-calendar responses", async () => {
        const notFound = vi.fn(async () => new Response("nope", { status: 503 }));
        await expect(fetchMeetupEvents("https://x", { ...opts, fetchImpl: notFound as typeof fetch })).rejects.toThrow("HTTP 503");
        const html = vi.fn(async () => new Response("<html>login</html>", { status: 200 }));
        await expect(fetchMeetupEvents("https://x", { ...opts, fetchImpl: html as typeof fetch })).rejects.toThrow("not an iCalendar");
    });
});
