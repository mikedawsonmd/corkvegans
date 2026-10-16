/**
 * Combining events from several sources: de-duplication, sorting, filtering
 * of past events, and keeping the last good data when a source fails.
 */

import { normaliseTitle } from "./text.ts";
import type { CvEvent, EventSource, EventsSnapshot, SourceStatus } from "./types.ts";

const HOUR = 60 * 60 * 1000;
/** Assumed duration when a source gives no end time. */
export const DEFAULT_DURATION_MS = 3 * HOUR;
/** Two listings starting within this window may be the same event. */
const DUPLICATE_WINDOW_MS = 90 * 60 * 1000;

/** The moment an event should drop off the upcoming list. */
export function eventEndsAt(event: CvEvent): number {
    if (event.end) return Date.parse(event.end);
    return Date.parse(event.start) + (event.allDay ? 24 * HOUR : DEFAULT_DURATION_MS);
}

/** Keeps events that have not finished yet (in-progress events stay listed). */
export function upcomingOnly(events: CvEvent[], now: Date): CvEvent[] {
    const t = now.getTime();
    return events.filter((e) => eventEndsAt(e) > t);
}

export function sortByStart(events: CvEvent[]): CvEvent[] {
    return [...events].sort(
        (a, b) => Date.parse(a.start) - Date.parse(b.start) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
    );
}

function wordSet(title: string): Set<string> {
    return new Set(normaliseTitle(title).split(" ").filter(Boolean));
}

/** Heuristic: are two listings (from different platforms) the same real-world event? */
export function isLikelySameEvent(a: CvEvent, b: CvEvent): boolean {
    if (a.source === b.source) return a.id === b.id;
    if (Math.abs(Date.parse(a.start) - Date.parse(b.start)) > DUPLICATE_WINDOW_MS) return false;

    const ta = normaliseTitle(a.title);
    const tb = normaliseTitle(b.title);
    if (!ta || !tb) return false;
    if (ta === tb) return true;
    if (Math.min(ta.length, tb.length) >= 6 && (ta.includes(tb) || tb.includes(ta))) return true;

    const wa = wordSet(a.title);
    const wb = wordSet(b.title);
    const shared = [...wa].filter((w) => wb.has(w)).length;
    const union = new Set([...wa, ...wb]).size;
    return union > 0 && shared / union >= 0.6;
}

/** Merges two listings of the same event, keeping `primary` and filling gaps from `other`. */
function mergePair(primary: CvEvent, other: CvEvent): CvEvent {
    const alsoListedOn = [...primary.alsoListedOn];
    if (!alsoListedOn.some((l) => l.url === other.url)) alsoListedOn.push({ source: other.source, url: other.url });
    return {
        ...primary,
        summary: primary.summary || other.summary,
        end: primary.end ?? other.end,
        location: {
            name: primary.location.name ?? other.location.name,
            address: primary.location.address ?? other.location.address,
            online: primary.location.online || other.location.online,
        },
        image: primary.image ?? other.image,
        isFree: primary.isFree ?? other.isFree,
        // If either platform says it's cancelled, show it as cancelled.
        status: primary.status === "cancelled" || other.status === "cancelled" ? "cancelled" : primary.status,
        alsoListedOn,
    };
}

/**
 * Removes exact duplicates (same ID) and merges cross-platform duplicates.
 * The listing from `preferred` is kept as the main one.
 */
export function dedupeEvents(events: CvEvent[], preferred: EventSource): CvEvent[] {
    const byId = new Map<string, CvEvent>();
    for (const e of events) if (!byId.has(e.id)) byId.set(e.id, e);

    // Preferred-source events first, so they become the primary listing.
    const ordered = sortByStart([...byId.values()]).sort(
        (a, b) => Number(b.source === preferred) - Number(a.source === preferred),
    );

    const result: CvEvent[] = [];
    for (const event of ordered) {
        const index = result.findIndex(
            (existing) =>
                existing.source !== event.source &&
                !existing.alsoListedOn.some((l) => l.source === event.source) &&
                isLikelySameEvent(existing, event),
        );
        if (index === -1) result.push(event);
        else result[index] = mergePair(result[index], event);
    }
    return sortByStart(result);
}

export interface SourceResult {
    source: EventSource;
    enabled: boolean;
    events?: CvEvent[];
    error?: string;
}

/**
 * Builds a new snapshot. A source that fails keeps its events from the
 * previous snapshot, so a temporary outage never empties the listings.
 */
export function buildSnapshot(
    results: SourceResult[],
    previous: EventsSnapshot | null,
    now: Date,
    preferred: EventSource,
): EventsSnapshot {
    const nowIso = now.toISOString();
    const sources = {} as Record<EventSource, SourceStatus>;
    const all: CvEvent[] = [];

    for (const r of results) {
        const prevStatus = previous?.sources?.[r.source];
        if (!r.enabled) {
            sources[r.source] = { enabled: false, ok: true, attemptedAt: null, lastSuccessAt: null, count: 0 };
            continue;
        }
        if (r.events) {
            all.push(...r.events);
            sources[r.source] = { enabled: true, ok: true, attemptedAt: nowIso, lastSuccessAt: nowIso, count: r.events.length };
        } else {
            const kept = (previous?.events ?? []).filter((e) => e.source === r.source);
            all.push(...kept);
            sources[r.source] = {
                enabled: true,
                ok: false,
                attemptedAt: nowIso,
                lastSuccessAt: prevStatus?.lastSuccessAt ?? null,
                count: kept.length,
                error: r.error ?? "Unknown error",
            };
        }
    }

    // Drop events that have already finished so the snapshot stays small.
    const events = dedupeEvents(upcomingOnly(all, now), preferred);
    return { generatedAt: nowIso, sources, events };
}

/** Oldest "last successful update" across enabled sources (null if never). */
export function dataAsOf(snapshot: EventsSnapshot): string | null {
    const times = Object.values(snapshot.sources ?? {})
        .filter((s) => s.enabled)
        .map((s) => s.lastSuccessAt);
    if (times.length === 0) return snapshot.generatedAt ?? null;
    if (times.some((t) => !t)) return null;
    return (times as string[]).sort()[0];
}

/** Basic structural validation of a snapshot read from disk or network. */
export function isSnapshot(value: unknown): value is EventsSnapshot {
    if (!value || typeof value !== "object") return false;
    const v = value as Partial<EventsSnapshot>;
    return typeof v.generatedAt === "string" && Array.isArray(v.events) && typeof v.sources === "object";
}
