/**
 * Fetches upcoming events from Meetup (public iCal) and Eventbrite (API, when
 * configured), normalises and merges them, and writes src/data/events.json.
 *
 * Run by the deploy workflow before every build: `node scripts/sync-events.ts`
 *
 * Environment variables (all optional):
 *   EVENTBRITE_TOKEN            Eventbrite private token (GitHub secret)
 *   EVENTBRITE_ORGANIZATION_ID  Eventbrite organisation ID (GitHub variable)
 *   EVENTBRITE_ORGANIZER_ID     Overrides the organiser ID in src/config/site.ts
 *   EVENTS_PREVIOUS_URL         Where to read the last published snapshot,
 *                               e.g. https://corkvegans.ie/events.json
 *
 * This script never fails the build: if a source is down, the previous data
 * for that source is kept and a warning is logged.
 */

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { eventSources, site } from "../src/config/site.ts";
import { fetchEventbriteEvents } from "../src/lib/events/eventbrite.ts";
import { buildSnapshot, isSnapshot, type SourceResult } from "../src/lib/events/merge.ts";
import { fetchMeetupEvents } from "../src/lib/events/meetup.ts";
import type { EventsSnapshot } from "../src/lib/events/types.ts";

const OUTPUT = fileURLToPath(new URL("../src/data/events.json", import.meta.url));
const inCi = process.env.GITHUB_ACTIONS === "true";

function warn(message: string) {
    console.warn(inCi ? `::warning title=Event sync::${message}` : `WARNING: ${message}`);
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

async function loadPrevious(): Promise<EventsSnapshot | null> {
    const remote = process.env.EVENTS_PREVIOUS_URL;
    if (remote) {
        try {
            const res = await fetch(remote, { signal: AbortSignal.timeout(15_000) });
            if (res.ok) {
                const json: unknown = await res.json();
                if (isSnapshot(json)) {
                    console.log(`Previous snapshot: ${remote} (generated ${json.generatedAt})`);
                    return json;
                }
            }
            warn(`Could not use previous snapshot from ${remote} (HTTP ${res.status}); falling back to the repository copy.`);
        } catch (err) {
            warn(`Could not fetch previous snapshot from ${remote}: ${errorMessage(err)}`);
        }
    }
    try {
        const json: unknown = JSON.parse(readFileSync(OUTPUT, "utf8"));
        if (isSnapshot(json)) {
            console.log(`Previous snapshot: repository copy (generated ${json.generatedAt})`);
            return json;
        }
    } catch {
        /* no previous data */
    }
    return null;
}

async function main() {
    const previous = await loadPrevious();
    const results: SourceResult[] = [];

    try {
        const events = await fetchMeetupEvents(eventSources.meetupIcalUrl, {
            groupName: site.name,
            timeZone: site.timeZone,
        });
        results.push({ source: "meetup", enabled: true, events });
        console.log(`Meetup: ${events.length} event(s)`);
    } catch (err) {
        results.push({ source: "meetup", enabled: true, error: errorMessage(err) });
        warn(`Meetup fetch failed, keeping previous Meetup events: ${errorMessage(err)}`);
    }

    const token = process.env.EVENTBRITE_TOKEN?.trim();
    const organizationId = process.env.EVENTBRITE_ORGANIZATION_ID?.trim();
    if (token && organizationId) {
        try {
            const events = await fetchEventbriteEvents({
                token,
                organizationId,
                organizerId: process.env.EVENTBRITE_ORGANIZER_ID?.trim() || eventSources.eventbriteOrganizerId,
                groupName: site.name,
            });
            results.push({ source: "eventbrite", enabled: true, events });
            console.log(`Eventbrite: ${events.length} event(s)`);
        } catch (err) {
            results.push({ source: "eventbrite", enabled: true, error: errorMessage(err) });
            warn(`Eventbrite fetch failed, keeping previous Eventbrite events: ${errorMessage(err)}`);
        }
    } else {
        results.push({ source: "eventbrite", enabled: false });
        console.log("Eventbrite: not configured (EVENTBRITE_TOKEN / EVENTBRITE_ORGANIZATION_ID not set) — skipped");
    }

    const snapshot = buildSnapshot(results, previous, new Date(), eventSources.preferredSource);
    writeFileSync(OUTPUT, JSON.stringify(snapshot, null, 2) + "\n");
    console.log(`Wrote ${snapshot.events.length} upcoming event(s) to src/data/events.json`);

    if (process.env.GITHUB_STEP_SUMMARY) {
        const rows = Object.entries(snapshot.sources)
            .map(([name, s]) =>
                `| ${name} | ${!s.enabled ? "not configured" : s.ok ? "✅ ok" : `⚠️ failed: ${s.error}`} | ${s.count} | ${s.lastSuccessAt ?? "never"} |`,
            )
            .join("\n");
        appendFileSync(
            process.env.GITHUB_STEP_SUMMARY,
            `### Event sync\n\n| Source | Status | Events | Last success |\n| --- | --- | --- | --- |\n${rows}\n\n` +
                `**${snapshot.events.length}** upcoming event(s) after merging.\n`,
        );
    }
}

main().catch((err) => {
    // Unexpected failure: leave the existing events.json untouched and let the build continue.
    warn(`Event sync crashed; existing event data left unchanged: ${errorMessage(err)}`);
});
