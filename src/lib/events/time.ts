/**
 * Time-zone helpers built on the standard Intl API (no date libraries).
 * All event times are stored in UTC and displayed in Irish local time,
 * which automatically accounts for Irish Summer Time.
 */

/** Offset (ms) of `timeZone` from UTC at the given instant. */
export function zoneOffsetMs(instant: number, timeZone: string): number {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    }).formatToParts(new Date(instant));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * Converts a wall-clock time in `timeZone` to a UTC instant (ms).
 * For times that do not exist (spring-forward gap) the result is shifted
 * forward; for ambiguous times (autumn fall-back) the earlier one is chosen.
 */
export function zonedTimeToUtc(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    second: number,
    timeZone: string,
): number {
    const guess = Date.UTC(year, month - 1, day, hour, minute, second);
    const firstOffset = zoneOffsetMs(guess, timeZone);
    let utc = guess - firstOffset;
    const secondOffset = zoneOffsetMs(utc, timeZone);
    if (secondOffset !== firstOffset) {
        utc = guess - secondOffset;
    }
    return utc;
}

export function isValidTimeZone(timeZone: string): boolean {
    try {
        new Intl.DateTimeFormat("en-IE", { timeZone });
        return true;
    } catch {
        return false;
    }
}
