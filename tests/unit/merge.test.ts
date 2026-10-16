import { describe, expect, it } from "vitest";
import { buildSnapshot, dataAsOf, dedupeEvents, eventEndsAt, isLikelySameEvent, isSnapshot, sortByStart, upcomingOnly } from "../../src/lib/events/merge.ts";
import type { EventsSnapshot } from "../../src/lib/events/types.ts";
import { makeEvent } from "./helpers.ts";

const now = new Date("2027-01-02T12:00:00.000Z");

describe("sorting and filtering", () => {
    it("sorts by start time, earliest first", () => {
        const events = [
            makeEvent({ id: "meetup:c", start: "2027-03-01T10:00:00.000Z" }),
            makeEvent({ id: "meetup:a", start: "2027-01-05T10:00:00.000Z" }),
            makeEvent({ id: "eventbrite:b", start: "2027-02-01T10:00:00.000Z" }),
        ];
        expect(sortByStart(events).map((e) => e.id)).toEqual(["meetup:a", "eventbrite:b", "meetup:c"]);
    });

    it("excludes finished events but keeps ones in progress", () => {
        const events = [
            makeEvent({ id: "meetup:past", start: "2027-01-01T10:00:00.000Z", end: "2027-01-01T12:00:00.000Z" }),
            makeEvent({ id: "meetup:now", start: "2027-01-02T11:00:00.000Z", end: "2027-01-02T13:00:00.000Z" }),
            makeEvent({ id: "meetup:soon", start: "2027-01-03T11:00:00.000Z" }),
            makeEvent({ id: "meetup:ended-just-now", start: "2027-01-02T10:00:00.000Z", end: "2027-01-02T12:00:00.000Z" }),
        ];
        expect(upcomingOnly(events, now).map((e) => e.id)).toEqual(["meetup:now", "meetup:soon"]);
    });

    it("assumes three hours when there is no end time, a full day for all-day events", () => {
        const start = "2027-01-02T10:00:00.000Z";
        expect(eventEndsAt(makeEvent({ id: "meetup:x", start }))).toBe(Date.parse("2027-01-02T13:00:00.000Z"));
        expect(eventEndsAt(makeEvent({ id: "meetup:y", start, allDay: true }))).toBe(Date.parse("2027-01-03T10:00:00.000Z"));
    });
});

describe("duplicate detection", () => {
    it("merges the same event listed on Meetup and Eventbrite, keeping the preferred listing", () => {
        const meetup = makeEvent({ id: "meetup:1", title: "Cork Vegans Monthly Social - My Goodness", start: "2027-01-05T11:00:00.000Z" });
        const eventbrite = makeEvent({
            id: "eventbrite:1",
            title: "Monthly Social – My Goodness",
            start: "2027-01-05T11:30:00.000Z",
            image: { url: "https://img.evbuc.com/a.jpg", alt: "" },
            location: { name: "My Goodness", address: "Cork", online: false },
            isFree: true,
        });
        const [merged, ...rest] = dedupeEvents([eventbrite, meetup], "meetup");
        expect(rest).toEqual([]);
        expect(merged.id).toBe("meetup:1");
        expect(merged.alsoListedOn).toEqual([{ source: "eventbrite", url: eventbrite.url }]);
        expect(merged.image).toEqual(eventbrite.image);
        expect(merged.location.name).toBe("My Goodness");
        expect(merged.isFree).toBe(true);
    });

    it("can prefer Eventbrite instead", () => {
        const meetup = makeEvent({ id: "meetup:1", title: "Vegan Potluck" });
        const eventbrite = makeEvent({ id: "eventbrite:1", title: "Vegan Potluck" });
        const [merged] = dedupeEvents([meetup, eventbrite], "eventbrite");
        expect(merged.id).toBe("eventbrite:1");
        expect(merged.alsoListedOn[0].source).toBe("meetup");
    });

    it("does not merge different events at the same time, or the same title on different days", () => {
        const a = makeEvent({ id: "meetup:1", title: "Indoor Climbing" });
        const b = makeEvent({ id: "eventbrite:1", title: "Vegan Supper Club" });
        const c = makeEvent({ id: "eventbrite:2", title: "Indoor Climbing", start: "2027-02-02T11:00:00.000Z" });
        expect(isLikelySameEvent(a, b)).toBe(false);
        expect(isLikelySameEvent(a, c)).toBe(false);
        expect(dedupeEvents([a, b, c], "meetup")).toHaveLength(3);
    });

    it("never merges two events from the same platform, but drops repeated IDs", () => {
        const a = makeEvent({ id: "meetup:1", title: "Walk" });
        const b = makeEvent({ id: "meetup:2", title: "Walk" });
        expect(dedupeEvents([a, b, { ...a }], "meetup").map((e) => e.id)).toEqual(["meetup:1", "meetup:2"]);
    });

    it("shows an event as cancelled if either platform says so", () => {
        const meetup = makeEvent({ id: "meetup:1", title: "Picnic" });
        const eventbrite = makeEvent({ id: "eventbrite:1", title: "Picnic", status: "cancelled" });
        expect(dedupeEvents([meetup, eventbrite], "meetup")[0].status).toBe("cancelled");
    });
});

describe("snapshots and failure handling", () => {
    const previous: EventsSnapshot = {
        generatedAt: "2027-01-01T00:00:00.000Z",
        sources: {
            meetup: { enabled: true, ok: true, attemptedAt: "2027-01-01T00:00:00.000Z", lastSuccessAt: "2027-01-01T00:00:00.000Z", count: 2 },
            eventbrite: { enabled: true, ok: true, attemptedAt: "2027-01-01T00:00:00.000Z", lastSuccessAt: "2027-01-01T00:00:00.000Z", count: 1 },
        },
        events: [
            makeEvent({ id: "meetup:old", start: "2027-01-01T10:00:00.000Z", end: "2027-01-01T11:00:00.000Z" }),
            makeEvent({ id: "meetup:kept", title: "Coffee", start: "2027-01-10T10:00:00.000Z" }),
            makeEvent({ id: "eventbrite:kept", title: "Supper", start: "2027-01-11T10:00:00.000Z" }),
        ],
    };

    it("keeps the previous events for a source that fails", () => {
        const snap = buildSnapshot(
            [
                { source: "meetup", enabled: true, error: "HTTP 503" },
                { source: "eventbrite", enabled: true, events: [makeEvent({ id: "eventbrite:new", title: "Brunch", start: "2027-01-20T10:00:00.000Z" })] },
            ],
            previous,
            now,
            "meetup",
        );
        expect(snap.events.map((e) => e.id)).toEqual(["meetup:kept", "eventbrite:new"]);
        expect(snap.sources.meetup).toMatchObject({ ok: false, error: "HTTP 503", lastSuccessAt: "2027-01-01T00:00:00.000Z" });
        expect(snap.sources.eventbrite).toMatchObject({ ok: true, lastSuccessAt: now.toISOString() });
    });

    it("does not erase everything when all sources fail", () => {
        const snap = buildSnapshot(
            [
                { source: "meetup", enabled: true, error: "timeout" },
                { source: "eventbrite", enabled: true, error: "timeout" },
            ],
            previous,
            now,
            "meetup",
        );
        expect(snap.events.map((e) => e.id)).toEqual(["meetup:kept", "eventbrite:kept"]);
    });

    it("drops a disabled source's events and records it as not configured", () => {
        const snap = buildSnapshot([{ source: "meetup", enabled: true, events: [] }, { source: "eventbrite", enabled: false }], previous, now, "meetup");
        expect(snap.events).toEqual([]);
        expect(snap.sources.eventbrite.enabled).toBe(false);
    });

    it("works with no previous snapshot", () => {
        const snap = buildSnapshot([{ source: "meetup", enabled: true, error: "down" }, { source: "eventbrite", enabled: false }], null, now, "meetup");
        expect(snap.events).toEqual([]);
        expect(snap.sources.meetup.lastSuccessAt).toBeNull();
        expect(dataAsOf(snap)).toBeNull();
    });

    it("reports the oldest successful update across enabled sources", () => {
        const snap: EventsSnapshot = {
            ...previous,
            sources: { ...previous.sources, eventbrite: { ...previous.sources.eventbrite, lastSuccessAt: "2026-12-25T00:00:00.000Z" } },
        };
        expect(dataAsOf(snap)).toBe("2026-12-25T00:00:00.000Z");
    });

    it("validates snapshot shape", () => {
        expect(isSnapshot(previous)).toBe(true);
        expect(isSnapshot({ events: "nope" })).toBe(false);
        expect(isSnapshot(null)).toBe(false);
    });
});
