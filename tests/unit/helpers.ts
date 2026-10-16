import type { CvEvent } from "../../src/lib/events/types.ts";

export function makeEvent(overrides: Partial<CvEvent> & Pick<CvEvent, "id">): CvEvent {
    const source = overrides.source ?? (overrides.id.startsWith("eventbrite") ? "eventbrite" : "meetup");
    return {
        source,
        title: "Monthly Social",
        summary: "",
        start: "2027-01-02T11:00:00.000Z",
        end: null,
        timeZone: "Europe/Dublin",
        allDay: false,
        location: { name: null, address: null, online: false },
        image: null,
        url: `https://${source === "meetup" ? "www.meetup.com/e/" : "www.eventbrite.ie/e/"}${overrides.id}`,
        registrationUrl: `https://${source === "meetup" ? "www.meetup.com/e/" : "www.eventbrite.ie/e/"}${overrides.id}`,
        status: "scheduled",
        isFree: null,
        alsoListedOn: [],
        ...overrides,
    };
}
