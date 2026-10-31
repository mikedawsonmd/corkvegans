/**
 * Member codes on Eventbrite. Each member's code is an access code on the
 * "Members" ticket group: it reveals the hidden member tickets (on sale before
 * the public ones) and takes MEMBER_DISCOUNT_EUR off them, on every event
 * whose member ticket is in that group. See docs/ADMIN-GUIDE.md, "Membership".
 *
 * Variables: EVENTBRITE_TOKEN (secret), EVENTBRITE_ORGANIZATION_ID,
 * EVENTBRITE_MEMBERS_TICKET_GROUP_ID, EVENTBRITE_TIME_ZONE (default Europe/Dublin).
 */

const API = "https://www.eventbriteapi.com/v3";
/** List filter for codes that span events (confirmed against the API, October 2026). */
export const CROSS_EVENT_SCOPE = "multi_events";

export class EventbriteError extends Error {
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}

async function eventbrite(env, method, path, body) {
    for (const name of ["EVENTBRITE_TOKEN", "EVENTBRITE_ORGANIZATION_ID", "EVENTBRITE_MEMBERS_TICKET_GROUP_ID"]) {
        if (!env[name]) throw new EventbriteError(`${name} is not set`, 0);
    }
    const res = await fetch(`${API}${path}`, {
        method,
        headers: { Authorization: `Bearer ${env.EVENTBRITE_TOKEN}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        // Only Eventbrite's error name: its description can include the code.
        throw new EventbriteError(`Eventbrite ${method} ${path.replace(/\/\d+\//g, "/…/").replace(/\?.*/, "")} responded ${res.status}${data?.error ? ` ${data.error}` : ""}`, res.status);
    }
    return data;
}

/** "YYYY-MM-DDTHH:MM:SS" in the organisation's time zone, as Eventbrite's discount dates expect. */
export function eventbriteDate(date, timeZone = "Europe/Dublin") {
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
            .formatToParts(date)
            .map((p) => [p.type, p.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

const zone = (env) => env.EVENTBRITE_TIME_ZONE || "Europe/Dublin";

export async function findMemberDiscount(env, code) {
    const query = new URLSearchParams({ scope: CROSS_EVENT_SCOPE, code, ticket_group_id: env.EVENTBRITE_MEMBERS_TICKET_GROUP_ID });
    const data = await eventbrite(env, "GET", `/organizations/${env.EVENTBRITE_ORGANIZATION_ID}/discounts/?${query}`);
    return data.discounts?.find((d) => d.code === code)?.id ?? null;
}

/**
 * Creates the member's code and returns its discount ID. If the code already
 * exists (a retried webhook after a crash), returns the existing one, so a
 * member never gets two.
 */
export async function createMemberDiscount(env, { code, amountOff, endDate }) {
    try {
        const data = await eventbrite(env, "POST", `/organizations/${env.EVENTBRITE_ORGANIZATION_ID}/discounts/`, {
            discount: {
                type: "access",
                code,
                amount_off: amountOff.toFixed(2),
                ticket_group_id: env.EVENTBRITE_MEMBERS_TICKET_GROUP_ID,
                end_date: eventbriteDate(endDate, zone(env)),
            },
        });
        if (!data.id) throw new EventbriteError("Eventbrite didn't return a discount ID", 200);
        return data.id;
    } catch (err) {
        if (!(err instanceof EventbriteError) || err.status !== 400) throw err;
        const existing = await findMemberDiscount(env, code);
        if (existing) return existing;
        throw err;
    }
}

export async function setMemberDiscountEnd(env, discountId, endDate) {
    await eventbrite(env, "POST", `/discounts/${discountId}/`, { discount: { end_date: eventbriteDate(endDate, zone(env)) } });
}

/** Deletes the code. Eventbrite only deletes unused codes, so a used one is ended now instead. */
export async function removeMemberDiscount(env, discountId, now = new Date()) {
    try {
        await eventbrite(env, "DELETE", `/discounts/${discountId}/`);
    } catch (err) {
        if (!(err instanceof EventbriteError)) throw err;
        if (err.status === 404) return "gone";
        if (err.status !== 400) throw err;
        await setMemberDiscountEnd(env, discountId, now);
        return "ended";
    }
    return "deleted";
}
