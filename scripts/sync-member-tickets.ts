/**
 * Adds each upcoming event's hidden member ticket to the Eventbrite "Members"
 * ticket group (see src/lib/events/member-tickets.ts).
 *
 * Run by the deploy workflow before every build: `node scripts/sync-member-tickets.ts`
 *
 * Environment variables:
 *   EVENTBRITE_TOKEN                    Eventbrite private token (GitHub secret)
 *   EVENTBRITE_ORGANIZATION_ID          Eventbrite organisation ID (GitHub variable)
 *   EVENTBRITE_MEMBERS_TICKET_GROUP_ID  The Members ticket group (GitHub variable)
 *
 * Skipped when any is missing. Never fails the build: a failure is a warning.
 */

import { syncMemberTickets } from "../src/lib/events/member-tickets.ts";

const inCi = process.env.GITHUB_ACTIONS === "true";

const token = process.env.EVENTBRITE_TOKEN?.trim();
const organizationId = process.env.EVENTBRITE_ORGANIZATION_ID?.trim();
const ticketGroupId = process.env.EVENTBRITE_MEMBERS_TICKET_GROUP_ID?.trim();

if (!token || !organizationId || !ticketGroupId) {
    console.log("Member tickets: not configured (EVENTBRITE_TOKEN / EVENTBRITE_ORGANIZATION_ID / EVENTBRITE_MEMBERS_TICKET_GROUP_ID not set) — skipped");
} else {
    syncMemberTickets({ token, organizationId, ticketGroupId }).catch((err) => {
        const message = `Could not update the Members ticket group: ${err instanceof Error ? err.message : String(err)}`;
        console.warn(inCi ? `::warning title=Member tickets::${message}` : `WARNING: ${message}`);
    });
}
