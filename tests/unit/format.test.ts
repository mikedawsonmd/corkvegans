import { describe, expect, it } from "vitest";
import { dateBadge, formatEventDate, formatEventTimeRange } from "../../src/lib/events/format.ts";
import { makeEvent } from "./helpers.ts";

describe("Irish local date and time display", () => {
    it("shows winter (GMT) times unchanged", () => {
        const ev = makeEvent({ id: "meetup:1", start: "2026-11-07T11:00:00.000Z", end: "2026-11-07T12:00:00.000Z" });
        expect(formatEventDate(ev.start)).toBe("Sat 7 November 2026");
        expect(formatEventTimeRange(ev)).toBe("11:00–12:00");
    });

    it("adds an hour during Irish Summer Time", () => {
        const ev = makeEvent({ id: "meetup:2", start: "2027-07-10T10:00:00.000Z" });
        expect(formatEventTimeRange(ev)).toBe("11:00");
    });

    it("uses the Irish date when UTC is still the previous day", () => {
        // 23:30 UTC on 9 July = 00:30 on 10 July in Ireland.
        expect(formatEventDate("2027-07-09T23:30:00.000Z")).toBe("Sat 10 July 2027");
        expect(dateBadge("2027-07-09T23:30:00.000Z")).toEqual({ month: "JUL", day: "10" });
    });

    it("omits the end time when it is on another day, and labels all-day events", () => {
        expect(formatEventTimeRange(makeEvent({ id: "m:3", start: "2027-01-02T20:00:00.000Z", end: "2027-01-03T02:00:00.000Z" }))).toBe("20:00");
        expect(formatEventTimeRange(makeEvent({ id: "m:4", allDay: true }))).toBe("All day");
    });
});
