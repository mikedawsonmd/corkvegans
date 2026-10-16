/** Build-time access to the event snapshot written by scripts/sync-events.ts. */
import snapshotJson from "../../data/events.json";
import { dataAsOf, isSnapshot, sortByStart, upcomingOnly } from "./merge";
import type { CvEvent, EventsSnapshot } from "./types";

const EMPTY: EventsSnapshot = {
    generatedAt: new Date(0).toISOString(),
    sources: {
        meetup: { enabled: true, ok: false, attemptedAt: null, lastSuccessAt: null, count: 0 },
        eventbrite: { enabled: false, ok: true, attemptedAt: null, lastSuccessAt: null, count: 0 },
    },
    events: [],
};

export function getSnapshot(): EventsSnapshot {
    return isSnapshot(snapshotJson) ? (snapshotJson as EventsSnapshot) : EMPTY;
}

/** Upcoming events as of build time, earliest first. */
export function getUpcomingEvents(now = new Date()): CvEvent[] {
    return sortByStart(upcomingOnly(getSnapshot().events, now));
}

export function getEventsAsOf(): string | null {
    return dataAsOf(getSnapshot());
}
