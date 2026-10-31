/**
 * Puts each upcoming event's member ticket into the Eventbrite "Members"
 * ticket group, so members' codes (worker/eventbrite.js) reveal it and take
 * the discount off. Eventbrite's editor doesn't show ticket groups, so
 * organisers only have to name the ticket and hide it.
 *
 * A member ticket is a hidden ticket whose name mentions "member" or
 * "members" (but not "non-member"), e.g. "Member ticket" or "Member discount".
 */

const API_BASE = "https://www.eventbriteapi.com/v3";
const MAX_PAGES = 5;

export interface TicketClass {
    id?: string;
    name?: string | null;
    hidden?: boolean | null;
}

const MEMBER = /\bmembers?\b/i;
const NON_MEMBER = /\bnon[\s-]?members?\b/i;

export function isMemberTicket(ticket: TicketClass): boolean {
    const name = ticket.name ?? "";
    return ticket.hidden === true && Boolean(ticket.id) && MEMBER.test(name) && !NON_MEMBER.test(name);
}

/** The group's tickets plus the new ones; null when nothing is missing. */
export function mergeTicketIds(current: Record<string, string[]>, found: Record<string, string[]>): Record<string, string[]> | null {
    const merged: Record<string, string[]> = {};
    for (const [eventId, ids] of Object.entries(current)) merged[eventId] = [...ids];
    let added = false;
    for (const [eventId, ids] of Object.entries(found)) {
        const list = (merged[eventId] ??= []);
        for (const id of ids) {
            if (!list.includes(id)) {
                list.push(id);
                added = true;
            }
        }
    }
    return added ? merged : null;
}

export async function syncMemberTickets(options: {
    token: string;
    organizationId: string;
    ticketGroupId: string;
    fetchImpl?: typeof fetch;
    log?: (line: string) => void;
}): Promise<{ added: { event: string; ticket: string }[] }> {
    const doFetch = options.fetchImpl ?? fetch;
    const log = options.log ?? console.log;

    async function call<T>(path: string, init: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<T> {
        const res = await doFetch(`${API_BASE}${path}`, {
            method: init.method ?? "GET",
            headers: {
                Authorization: `Bearer ${options.token}`,
                Accept: "application/json",
                ...(init.body ? { "Content-Type": "application/json" } : {}),
            },
            body: init.body ? JSON.stringify(init.body) : undefined,
            signal: AbortSignal.timeout(20_000),
        });
        // Never include the token or full response in errors.
        if (!res.ok) throw new Error(`Eventbrite API returned HTTP ${res.status} for ${path.split("?")[0]}`);
        return (await res.json()) as T;
    }

    async function pages<T>(path: string, key: string, params: Record<string, string> = {}): Promise<T[]> {
        const items: T[] = [];
        let continuation: string | undefined;
        for (let page = 0; page < MAX_PAGES; page++) {
            const query = new URLSearchParams(params);
            if (continuation) query.set("continuation", continuation);
            const body = await call<Record<string, unknown> & { pagination?: { has_more_items?: boolean; continuation?: string } }>(`${path}?${query}`);
            items.push(...((body[key] as T[] | undefined) ?? []));
            if (!body.pagination?.has_more_items || !body.pagination.continuation) break;
            continuation = body.pagination.continuation;
        }
        return items;
    }

    // Drafts too, so the ticket is ready by the time the event is published.
    const events = await pages<{ id?: string; name?: { text?: string | null } | null }>(
        `/organizations/${encodeURIComponent(options.organizationId)}/events/`,
        "events",
        { status: "draft,live,started", time_filter: "current_future", page_size: "50" },
    );
    const found: Record<string, string[]> = {};
    const names = new Map<string, { event: string; ticket: string }>();
    for (const event of events) {
        if (!event.id) continue;
        const tickets = await pages<TicketClass>(`/events/${encodeURIComponent(event.id)}/ticket_classes/`, "ticket_classes");
        for (const ticket of tickets.filter(isMemberTicket)) {
            (found[event.id] ??= []).push(ticket.id!);
            names.set(ticket.id!, { event: event.name?.text ?? event.id, ticket: ticket.name ?? ticket.id! });
        }
    }

    const group = await call<{ name?: string; event_ticket_ids?: Record<string, string[]> | null }>(`/ticket_groups/${encodeURIComponent(options.ticketGroupId)}/`);
    const current = group.event_ticket_ids ?? {};
    const merged = mergeTicketIds(current, found);
    if (!merged) {
        log(`Member tickets: ${Object.values(found).flat().length} found, all already in the ${group.name ?? "Members"} group`);
        return { added: [] };
    }
    await call(`/ticket_groups/${encodeURIComponent(options.ticketGroupId)}/`, { method: "POST", body: { ticket_group: { event_ticket_ids: merged } } });
    const added = Object.entries(found)
        .flatMap(([eventId, ids]) => ids.filter((id) => !current[eventId]?.includes(id)))
        .map((id) => names.get(id)!);
    for (const a of added) log(`Member tickets: added "${a.ticket}" (${a.event}) to the ${group.name ?? "Members"} group`);
    return { added };
}
