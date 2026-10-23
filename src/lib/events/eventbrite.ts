/**
 * Eventbrite source: Eventbrite API v3, "List Events by Organization".
 * Requires a private token from the Cork Vegans Eventbrite account, which is
 * only ever read from a GitHub Actions secret at build time.
 */

import { cleanText, safeHttpsUrl, summariseDescription } from "./text.ts";
import type { CvEvent, EventStatus } from "./types.ts";

const EVENTBRITE_HOSTS = /(^|\.)eventbrite\.[a-z.]+$/;
const IMAGE_HOSTS = /(^|\.)(evbuc\.com|eventbrite\.[a-z.]+|cloudfront\.net)$/;
const API_BASE = "https://www.eventbriteapi.com/v3";
const MAX_PAGES = 5;

/** Subset of the Eventbrite Event object that we use. */
export interface EventbriteEvent {
    id?: string;
    name?: { text?: string | null } | null;
    summary?: string | null;
    description?: { text?: string | null } | null;
    url?: string | null;
    start?: { utc?: string | null; timezone?: string | null } | null;
    end?: { utc?: string | null; timezone?: string | null } | null;
    status?: string | null;
    /** false for private events (Eventbrite's "Private" / unlisted setting). */
    listed?: boolean | null;
    online_event?: boolean | null;
    is_free?: boolean | null;
    logo?: { url?: string | null; original?: { url?: string | null } | null } | null;
    venue?: {
        name?: string | null;
        address?: { localized_address_display?: string | null } | null;
    } | null;
}

function mapStatus(status: string | null | undefined): EventStatus | null {
    switch (status) {
        case "live":
        case "started":
            return "scheduled";
        case "canceled":
            return "cancelled";
        default:
            return null; // draft, ended, completed — not shown
    }
}

function toIso(value: string | null | undefined): string | null {
    if (!value) return null;
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export function normaliseEventbriteEvent(ev: EventbriteEvent, groupName: string): CvEvent | null {
    const status = mapStatus(ev.status);
    const title = cleanText(ev.name?.text);
    const start = toIso(ev.start?.utc);
    const url = safeHttpsUrl(ev.url, EVENTBRITE_HOSTS);
    if (!status || !title || !start || !url || !ev.id) return null;
    // Private events (tests, invitation-only) stay off the site.
    if (ev.listed === false) return null;

    const end = toIso(ev.end?.utc);
    const imageUrl = safeHttpsUrl(ev.logo?.original?.url ?? ev.logo?.url, IMAGE_HOSTS);
    const summarySource = cleanText(ev.summary) || ev.description?.text || "";

    return {
        id: `eventbrite:${ev.id}`,
        source: "eventbrite",
        title,
        summary: summariseDescription(summarySource, groupName),
        start,
        end: end && end > start ? end : null,
        timeZone: ev.start?.timezone || "Europe/Dublin",
        allDay: false,
        location: {
            name: cleanText(ev.venue?.name) || null,
            address: cleanText(ev.venue?.address?.localized_address_display) || null,
            online: ev.online_event === true,
        },
        image: imageUrl ? { url: imageUrl, alt: "" } : null,
        url,
        registrationUrl: url,
        status,
        isFree: typeof ev.is_free === "boolean" ? ev.is_free : null,
        alsoListedOn: [],
    };
}

export async function fetchEventbriteEvents(options: {
    token: string;
    organizationId: string;
    organizerId?: string;
    groupName: string;
    fetchImpl?: typeof fetch;
}): Promise<CvEvent[]> {
    const doFetch = options.fetchImpl ?? fetch;
    const results: CvEvent[] = [];
    let continuation: string | undefined;

    for (let page = 0; page < MAX_PAGES; page++) {
        const params = new URLSearchParams({
            status: "live,started,canceled",
            order_by: "start_asc",
            time_filter: "current_future",
            page_size: "50",
            expand: "venue",
        });
        if (options.organizerId) params.set("organizer_filter", options.organizerId);
        if (continuation) params.set("continuation", continuation);

        const url = `${API_BASE}/organizations/${encodeURIComponent(options.organizationId)}/events/?${params}`;
        const res = await doFetch(url, {
            headers: { Authorization: `Bearer ${options.token}`, Accept: "application/json" },
            signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) {
            // Never include the token or full response in logs.
            throw new Error(`Eventbrite API returned HTTP ${res.status}`);
        }
        const body = (await res.json()) as {
            events?: EventbriteEvent[];
            pagination?: { has_more_items?: boolean; continuation?: string };
        };
        for (const ev of body.events ?? []) {
            const normalised = normaliseEventbriteEvent(ev, options.groupName);
            if (normalised) results.push(normalised);
        }
        if (!body.pagination?.has_more_items || !body.pagination.continuation) break;
        continuation = body.pagination.continuation;
    }
    return results;
}
