/**
 * Common event representation shared by every event source.
 * Source-specific data is normalised into this shape before it reaches any UI.
 */

export type EventSource = "meetup" | "eventbrite";

export type EventStatus = "scheduled" | "cancelled" | "postponed";

export interface CvEvent {
    /** Stable unique ID, e.g. "meetup:316851291". */
    id: string;
    source: EventSource;
    title: string;
    /** Plain-text summary (no markup), at most ~280 characters. */
    summary: string;
    /** Start instant, ISO 8601 in UTC. */
    start: string;
    /** End instant, ISO 8601 in UTC, when known. */
    end: string | null;
    /** IANA time zone the event is held in. */
    timeZone: string;
    allDay: boolean;
    location: {
        name: string | null;
        address: string | null;
        online: boolean;
    };
    image: { url: string; alt: string } | null;
    /** The event's listing on the source platform. */
    url: string;
    /** Where people register / RSVP. */
    registrationUrl: string;
    status: EventStatus;
    /** true / false only when the source states it reliably; otherwise null. */
    isFree: boolean | null;
    /** The same event on other platforms (filled in by de-duplication). */
    alsoListedOn: { source: EventSource; url: string }[];
}

export interface SourceStatus {
    /** false when the source is not configured (e.g. no Eventbrite token). */
    enabled: boolean;
    /** Whether the most recent fetch attempt succeeded. */
    ok: boolean;
    /** When the most recent fetch attempt happened. */
    attemptedAt: string | null;
    /** When this source last returned data successfully. */
    lastSuccessAt: string | null;
    count: number;
    error?: string;
}

export interface EventsSnapshot {
    generatedAt: string;
    sources: Record<EventSource, SourceStatus>;
    events: CvEvent[];
}

export const SOURCE_LABELS: Record<EventSource, string> = {
    meetup: "Meetup",
    eventbrite: "Eventbrite",
};
