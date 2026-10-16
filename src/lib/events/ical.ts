/**
 * Minimal iCalendar (RFC 5545) reader — enough for Meetup's public group feed.
 * Supports line unfolding, parameters, text unescaping and DATE / DATE-TIME
 * values with TZID, UTC ("Z") or floating times.
 */

import { isValidTimeZone, zonedTimeToUtc } from "./time.ts";

export interface IcalProperty {
    params: Record<string, string>;
    value: string;
}

export type IcalComponent = Record<string, IcalProperty>;

export function unfoldLines(text: string): string[] {
    return text
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .replace(/\n[ \t]/g, "")
        .split("\n");
}

function parseLine(line: string): { name: string; params: Record<string, string>; value: string } | null {
    let inQuotes = false;
    let colon = -1;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') inQuotes = !inQuotes;
        else if (ch === ":" && !inQuotes) {
            colon = i;
            break;
        }
    }
    if (colon === -1) return null;

    const [rawName, ...rawParams] = line.slice(0, colon).split(";");
    const params: Record<string, string> = {};
    for (const p of rawParams) {
        const eq = p.indexOf("=");
        if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
    }
    return { name: rawName.toUpperCase(), params, value: line.slice(colon + 1) };
}

/** Returns the properties of every VEVENT in the calendar. */
export function parseVEvents(text: string): IcalComponent[] {
    const events: IcalComponent[] = [];
    let current: IcalComponent | null = null;
    let nestedDepth = 0;

    for (const line of unfoldLines(text)) {
        if (!line.trim()) continue;
        const parsed = parseLine(line);
        if (!parsed) continue;
        const { name, params, value } = parsed;

        if (name === "BEGIN") {
            if (value.toUpperCase() === "VEVENT") {
                current = {};
                nestedDepth = 0;
            } else if (current) {
                nestedDepth++; // e.g. VALARM inside VEVENT
            }
            continue;
        }
        if (name === "END") {
            if (value.toUpperCase() === "VEVENT" && current) {
                events.push(current);
                current = null;
            } else if (current && nestedDepth > 0) {
                nestedDepth--;
            }
            continue;
        }
        if (current && nestedDepth === 0 && !(name in current)) {
            current[name] = { params, value };
        }
    }
    return events;
}

export function unescapeText(value: string): string {
    return value.replace(/\\([\\;,nN])/g, (_, ch: string) => (ch === "n" || ch === "N" ? "\n" : ch));
}

export interface IcalDate {
    /** UTC instant in ms. */
    utc: number;
    allDay: boolean;
}

/**
 * Parses DTSTART / DTEND style properties.
 * Floating times (no TZID, no Z) are interpreted in `defaultTimeZone`.
 */
export function parseIcalDate(prop: IcalProperty | undefined, defaultTimeZone: string): IcalDate | null {
    if (!prop) return null;
    const value = prop.value.trim();

    const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
    if (dateOnly || prop.params.VALUE === "DATE") {
        if (!dateOnly) return null;
        const [, y, m, d] = dateOnly.map(Number);
        return { utc: zonedTimeToUtc(y, m, d, 0, 0, 0, defaultTimeZone), allDay: true };
    }

    const dt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
    if (!dt) return null;
    const [y, mo, d, h, mi, s] = dt.slice(1, 7).map(Number);
    if (dt[7] === "Z") {
        return { utc: Date.UTC(y, mo - 1, d, h, mi, s), allDay: false };
    }
    const tzid = prop.params.TZID;
    const zone = tzid && isValidTimeZone(tzid) ? tzid : defaultTimeZone;
    return { utc: zonedTimeToUtc(y, mo, d, h, mi, s, zone), allDay: false };
}
