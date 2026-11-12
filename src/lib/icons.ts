/**
 * Every Material Symbols icon the site uses. The icon font is cut down to
 * just these (astro.config.mjs), so it's a few kilobytes instead of several
 * megabytes and loads before the page shows, with no icon names flashing.
 *
 * Using a new icon (e.g. a Resources link's `icon` in src/config/site.ts)?
 * Add its name here, in alphabetical order. The build fails with the missing
 * name if you forget (scripts/check-dist.ts). Names: https://fonts.google.com/icons
 */
export const ICONS = [
    "arrow_back",
    "arrow_forward",
    "campaign",
    "cancel",
    "card_membership",
    "celebration",
    "check_circle",
    "close",
    "confirmation_number",
    "content_copy",
    "diversity_3",
    "edit_note",
    "event",
    "expand_more",
    "favorite",
    "front_hand",
    "handshake",
    "hiking",
    "link",
    "location_on",
    "menu",
    "photo_camera",
    "qr_code_2",
    "restaurant",
    "schedule",
    "search",
    "sell",
    "share",
    "storefront",
    "volunteer_activism",
    "wifi_off",
] as const;
