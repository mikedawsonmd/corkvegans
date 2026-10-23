import { describe, expect, it, vi } from "vitest";
import { fetchEventbriteEvents, normaliseEventbriteEvent, type EventbriteEvent } from "../../src/lib/events/eventbrite.ts";

const base: EventbriteEvent = {
    id: "123",
    name: { text: "Vegan Supper Club" },
    summary: "A three-course plant-based dinner.",
    url: "https://www.eventbrite.ie/e/vegan-supper-club-tickets-123",
    start: { utc: "2027-07-10T18:00:00Z", timezone: "Europe/Dublin" },
    end: { utc: "2027-07-10T21:00:00Z", timezone: "Europe/Dublin" },
    status: "live",
    online_event: false,
    is_free: false,
    logo: { url: "https://img.evbuc.com/small.jpg", original: { url: "https://img.evbuc.com/original.jpg" } },
    venue: { name: "Quay Co-op", address: { localized_address_display: "24 Sullivan's Quay, Cork" } },
};

describe("Eventbrite normalisation", () => {
    it("maps an Eventbrite event to the common shape", () => {
        expect(normaliseEventbriteEvent(base, "Cork Vegans")).toEqual({
            id: "eventbrite:123",
            source: "eventbrite",
            title: "Vegan Supper Club",
            summary: "A three-course plant-based dinner.",
            start: "2027-07-10T18:00:00.000Z",
            end: "2027-07-10T21:00:00.000Z",
            timeZone: "Europe/Dublin",
            allDay: false,
            location: { name: "Quay Co-op", address: "24 Sullivan's Quay, Cork", online: false },
            image: { url: "https://img.evbuc.com/original.jpg", alt: "" },
            url: "https://www.eventbrite.ie/e/vegan-supper-club-tickets-123",
            registrationUrl: "https://www.eventbrite.ie/e/vegan-supper-club-tickets-123",
            status: "scheduled",
            isFree: false,
            alsoListedOn: [],
        });
    });

    it("maps statuses and drops events that aren't upcoming", () => {
        expect(normaliseEventbriteEvent({ ...base, status: "canceled" }, "Cork Vegans")?.status).toBe("cancelled");
        expect(normaliseEventbriteEvent({ ...base, status: "started" }, "Cork Vegans")?.status).toBe("scheduled");
        for (const status of ["draft", "ended", "completed", null]) {
            expect(normaliseEventbriteEvent({ ...base, status }, "Cork Vegans")).toBeNull();
        }
    });

    it("leaves out private events", () => {
        expect(normaliseEventbriteEvent({ ...base, listed: false }, "Cork Vegans")).toBeNull();
        expect(normaliseEventbriteEvent({ ...base, listed: true }, "Cork Vegans")).not.toBeNull();
    });

    it("handles missing images and venues, and online events", () => {
        const ev = normaliseEventbriteEvent({ ...base, logo: null, venue: null, online_event: true, is_free: true }, "Cork Vegans")!;
        expect(ev.image).toBeNull();
        expect(ev.location).toEqual({ name: null, address: null, online: true });
        expect(ev.isFree).toBe(true);
    });

    it("rejects unsafe or unexpected URLs", () => {
        expect(normaliseEventbriteEvent({ ...base, url: "javascript:alert(1)" }, "Cork Vegans")).toBeNull();
        expect(normaliseEventbriteEvent({ ...base, url: "https://evil.example/e/1" }, "Cork Vegans")).toBeNull();
        const img = normaliseEventbriteEvent({ ...base, logo: { url: "https://evil.example/x.jpg" } }, "Cork Vegans")!;
        expect(img.image).toBeNull();
    });

    it("ignores an end time before the start", () => {
        expect(normaliseEventbriteEvent({ ...base, end: { utc: "2027-07-10T17:00:00Z" } }, "Cork Vegans")!.end).toBeNull();
    });
});

describe("Eventbrite fetching", () => {
    it("follows pagination and sends the token only in the Authorization header", async () => {
        const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
            expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer secret-token");
            expect(url).not.toContain("secret-token");
            const page2 = url.includes("continuation=abc");
            return Response.json({
                events: [{ ...base, id: page2 ? "2" : "1" }],
                pagination: page2 ? { has_more_items: false } : { has_more_items: true, continuation: "abc" },
            });
        });
        const events = await fetchEventbriteEvents({
            token: "secret-token",
            organizationId: "999",
            organizerId: "91797524863",
            groupName: "Cork Vegans",
            fetchImpl: fetchImpl as unknown as typeof fetch,
        });
        expect(events.map((e) => e.id)).toEqual(["eventbrite:1", "eventbrite:2"]);
        expect(fetchImpl.mock.calls[0][0]).toContain("/organizations/999/events/");
        expect(fetchImpl.mock.calls[0][0]).toContain("organizer_filter=91797524863");
    });

    it("throws a message that never includes the token", async () => {
        const fetchImpl = vi.fn(async () => new Response("unauthorised secret-token", { status: 401 }));
        const err = await fetchEventbriteEvents({ token: "secret-token", organizationId: "1", groupName: "x", fetchImpl: fetchImpl as unknown as typeof fetch }).catch((e: Error) => e);
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toBe("Eventbrite API returned HTTP 401");
    });
});
