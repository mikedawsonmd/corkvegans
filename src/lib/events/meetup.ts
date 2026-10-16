/**
 * Meetup source: the group's public iCalendar feed
 * (https://www.meetup.com/<group>/events/ical/). No credentials needed.
 */

import { parseIcalDate, parseVEvents, unescapeText } from "./ical.ts";
import { cleanText, safeHttpsUrl, summariseDescription } from "./text.ts";
import type { CvEvent, EventStatus } from "./types.ts";

const MEETUP_HOSTS = /(^|\.)meetup\.com$/;

function mapStatus(value: string | undefined, title: string): EventStatus {
    const status = (value ?? "").toUpperCase();
    if (status === "CANCELLED" || /^\s*\[?cancel+ed\]?\b/i.test(title)) return "cancelled";
    return "scheduled";
}

export function parseMeetupIcal(ics: string, options: { groupName: string; timeZone: string }): CvEvent[] {
    const events: CvEvent[] = [];

    for (const ve of parseVEvents(ics)) {
        const title = cleanText(unescapeText(ve.SUMMARY?.value ?? ""));
        const start = parseIcalDate(ve.DTSTART, options.timeZone);
        const url = safeHttpsUrl(unescapeText(ve.URL?.value ?? ""), MEETUP_HOSTS);
        if (!title || !start || !url) continue; // unusable entry

        const end = parseIcalDate(ve.DTEND, options.timeZone);
        const urlId = /\/events\/([^/?#]+)/.exec(url)?.[1];
        const uid = ve.UID?.value ?? "";
        const sourceId = urlId ?? uid.replace(/@.*$/, "").replace(/^event_/, "");

        const locationText = cleanText(unescapeText(ve.LOCATION?.value ?? ""));
        const online = /\bonline\b/i.test(locationText);

        events.push({
            id: `meetup:${sourceId}`,
            source: "meetup",
            title,
            summary: summariseDescription(unescapeText(ve.DESCRIPTION?.value ?? ""), options.groupName),
            start: new Date(start.utc).toISOString(),
            end: end && end.utc > start.utc ? new Date(end.utc).toISOString() : null,
            timeZone: ve.DTSTART?.params.TZID ?? options.timeZone,
            allDay: start.allDay,
            location: {
                name: locationText && !online ? locationText : null,
                address: null,
                online,
            },
            image: null,
            url,
            registrationUrl: url,
            status: mapStatus(ve.STATUS?.value, title),
            isFree: null,
            alsoListedOn: [],
        });
    }
    return events;
}

export async function fetchMeetupEvents(
    icalUrl: string,
    options: { groupName: string; timeZone: string; fetchImpl?: typeof fetch },
): Promise<CvEvent[]> {
    const doFetch = options.fetchImpl ?? fetch;
    const res = await doFetch(icalUrl, {
        headers: { Accept: "text/calendar", "User-Agent": "corkvegans.ie event sync" },
        signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Meetup iCal returned HTTP ${res.status}`);
    const text = await res.text();
    if (!text.includes("BEGIN:VCALENDAR")) throw new Error("Meetup response was not an iCalendar feed");
    return parseMeetupIcal(text, options);
}
