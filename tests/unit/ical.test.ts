import { describe, expect, it } from "vitest";
import { parseIcalDate, parseVEvents, unescapeText, unfoldLines } from "../../src/lib/events/ical.ts";

describe("iCal parsing", () => {
    it("unfolds continuation lines", () => {
        expect(unfoldLines("DESCRIPTION:Hello\r\n  world\r\nSUMMARY:x")).toEqual(["DESCRIPTION:Hello world", "SUMMARY:x"]);
    });

    it("unescapes text values", () => {
        expect(unescapeText("a\\, b\; c\\nd\\\\e")).toBe("a, b; c\nd\\e");
    });

    it("reads VEVENT properties and ignores nested components", () => {
        const ics = [
            "BEGIN:VCALENDAR",
            "BEGIN:VEVENT",
            "SUMMARY:Outer",
            "BEGIN:VALARM",
            "SUMMARY:Alarm",
            "END:VALARM",
            'X-THING;FOO="a:b":value',
            "END:VEVENT",
            "END:VCALENDAR",
        ].join("\r\n");
        const [ev] = parseVEvents(ics);
        expect(ev.SUMMARY.value).toBe("Outer");
        expect(ev["X-THING"]).toEqual({ params: { FOO: "a:b" }, value: "value" });
    });

    it("converts Europe/Dublin wall time to UTC in winter (GMT)", () => {
        const d = parseIcalDate({ params: { TZID: "Europe/Dublin" }, value: "20261107T110000" }, "Europe/Dublin");
        expect(new Date(d!.utc).toISOString()).toBe("2026-11-07T11:00:00.000Z");
    });

    it("converts Europe/Dublin wall time to UTC in summer (IST, UTC+1)", () => {
        const d = parseIcalDate({ params: { TZID: "Europe/Dublin" }, value: "20270710T110000" }, "Europe/Dublin");
        expect(new Date(d!.utc).toISOString()).toBe("2027-07-10T10:00:00.000Z");
    });

    it("handles the day the clocks change", () => {
        // 28 March 2027: clocks go forward at 01:00 GMT. 12:00 local is 11:00 UTC.
        const d = parseIcalDate({ params: { TZID: "Europe/Dublin" }, value: "20270328T120000" }, "Europe/Dublin");
        expect(new Date(d!.utc).toISOString()).toBe("2027-03-28T11:00:00.000Z");
    });

    it("keeps explicit UTC times", () => {
        const d = parseIcalDate({ params: {}, value: "20270710T110000Z" }, "Europe/Dublin");
        expect(new Date(d!.utc).toISOString()).toBe("2027-07-10T11:00:00.000Z");
    });

    it("treats floating times and unknown TZIDs as Irish time", () => {
        const floating = parseIcalDate({ params: {}, value: "20270710T110000" }, "Europe/Dublin");
        const unknown = parseIcalDate({ params: { TZID: "Not/AZone" }, value: "20270710T110000" }, "Europe/Dublin");
        expect(new Date(floating!.utc).toISOString()).toBe("2027-07-10T10:00:00.000Z");
        expect(unknown!.utc).toBe(floating!.utc);
    });

    it("parses all-day dates", () => {
        const d = parseIcalDate({ params: { VALUE: "DATE" }, value: "20270710" }, "Europe/Dublin");
        expect(d!.allDay).toBe(true);
        expect(new Date(d!.utc).toISOString()).toBe("2027-07-09T23:00:00.000Z");
    });

    it("returns null for malformed dates", () => {
        expect(parseIcalDate({ params: {}, value: "tomorrow" }, "Europe/Dublin")).toBeNull();
        expect(parseIcalDate(undefined, "Europe/Dublin")).toBeNull();
    });
});
