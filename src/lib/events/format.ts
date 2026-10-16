/** Display formatting for events, always in Irish local time. */

import type { CvEvent } from "./types.ts";

const TZ = "Europe/Dublin";

function fmt(iso: string, options: Intl.DateTimeFormatOptions): string {
    return new Intl.DateTimeFormat("en-IE", { timeZone: TZ, ...options }).format(new Date(iso));
}

/** "Sat 7 November 2026" */
export function formatEventDate(iso: string): string {
    return fmt(iso, { weekday: "short", day: "numeric", month: "long", year: "numeric" });
}

/** "11:00" (24-hour, as used on the existing site) */
export function formatEventTime(iso: string): string {
    return fmt(iso, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

/** "11:00–12:00", or "11:00" when no end time (or the end is on another day). */
export function formatEventTimeRange(event: CvEvent): string {
    if (event.allDay) return "All day";
    const start = formatEventTime(event.start);
    if (!event.end) return start;
    const sameDay = fmt(event.start, { dateStyle: "short" }) === fmt(event.end, { dateStyle: "short" });
    return sameDay ? `${start}–${formatEventTime(event.end)}` : start;
}

/** Date badge: { month: "NOV", day: "07" } */
export function dateBadge(iso: string): { month: string; day: string } {
    return {
        month: fmt(iso, { month: "short" }).replace(".", "").toUpperCase(),
        day: fmt(iso, { day: "2-digit" }),
    };
}

/** "16 October 2026 at 17:45" */
export function formatTimestamp(iso: string): string {
    return `${fmt(iso, { day: "numeric", month: "long", year: "numeric" })} at ${formatEventTime(iso)}`;
}
