/**
 * Site-wide settings. Administrators edit this file (via GitHub) to change
 * links, feature switches, the volunteer form endpoint and event sources.
 *
 * Nothing in this file is secret: everything here ends up in public HTML.
 * Never put API tokens or passwords in this file — use GitHub Actions secrets.
 */

/**
 * Test builds only (CV_FIXTURES=1, used by the automated browser tests):
 * fake form and membership endpoints so those flows can be exercised.
 * Never set in production.
 */
const fixtures = typeof process !== "undefined" && process.env?.CV_FIXTURES === "1";

export const site = {
    name: "Cork Vegans",
    url: "https://corkvegans.ie",
    description:
        "Join Cork's vibrant vegan community for meetups, dining events, potlucks, and vegan living.",
    locale: "en_IE",
    timeZone: "Europe/Dublin",
    logo: "/images/logo.png",
    /** Default social sharing image (1200 × 630). */
    defaultShareImage: {
        src: "/images/share-default.jpg",
        width: 1200,
        height: 630,
        alt: "Cork Vegans logo beside a group of smiling members gathered around a sheep",
    },
};

export const links = {
    meetup: "https://www.meetup.com/corkvegans/",
    facebook: "https://www.facebook.com/corkvegans/",
    instagram: "https://www.instagram.com/corkvegans",
    eventbrite: "https://www.eventbrite.ie/o/cork-vegans-91797524863",
    whatsapp: "https://chat.whatsapp.com/GLVQxJC9qCFK4xGSUafwo3",
    foodMap: "https://maps.app.goo.gl/2pRjVTprqDZsYrKp8",
};

export const nav = [
    { href: "/events/", label: "Events" },
    { href: "/stories/", label: "Stories" },
    { href: "/membership/", label: "Membership" },
    { href: "/resources/", label: "Resources" },
    { href: "/about/", label: "About" },
];

/** Social profiles, shown as icons in the footer. */
export const socials = [
    { label: "Meetup", href: links.meetup, icon: "/images/socials/meetup.png", color: "rgb(255, 74, 121)" },
    { label: "Eventbrite", href: links.eventbrite, icon: "/images/socials/eventbrite.png", color: "#F05537" },
    { label: "Facebook", href: links.facebook, icon: "/images/socials/facebook.png", color: "#1877F2" },
    {
        label: "Instagram",
        href: links.instagram,
        icon: "/images/socials/insta.png",
        color: "linear-gradient(to top right, #f9ce34, #ee2a7b, #6228d7)",
    },
];

/**
 * Links on the Resources page. To add one, copy an entry and change it.
 * - `image`: a small white icon in public/images/socials/, or leave it out
 *   and set `icon` to any Material Symbols name (https://fonts.google.com/icons).
 * - `color`: background colour of the icon circle.
 * Only https links are shown.
 */
export const resources: {
    title: string;
    description: string;
    href: string;
    image?: string;
    icon?: string;
    color: string;
}[] = [
    {
        title: "WhatsApp community",
        description: "Chat with other members, hear about meetups first and ask for vegan tips around Cork.",
        href: links.whatsapp,
        image: "/images/socials/whatsapp.png",
        color: "#25D366",
    },
    {
        title: "Cork vegan food map",
        description: "Our map of vegan and vegan-friendly places to eat in and around Cork.",
        href: links.foodMap,
        image: "/images/socials/foodmap.png",
        color: "#417660",
    },
];

/** The primary button in the top-right of the header. */
export const headerCta = { href: "/support/", label: "Support us" };

/**
 * Feature switches.
 *
 * payments: the membership join form and its checkout modal
 * (src/components/MembershipForm.astro, worker/membership.js). While it's off
 * the Support page shows "Membership is on the way", Stripe.js is never
 * loaded and the Worker is never called. Turning it on also needs the
 * `membership` settings below and the Worker's PAYMENTS_ENABLED variable.
 * Test builds (CV_FIXTURES=1) switch it on so the browser tests cover the form.
 */
export const features = {
    payments: fixtures,
};

/**
 * Build-time setting, e.g. to try the join form with Stripe test keys.
 * Astro exposes .env/.env.local values on import.meta.env (the dev server
 * doesn't copy them to process.env); plain Node scripts only have process.env.
 */
const env = (name: string): string =>
    String(import.meta.env?.[name] ?? "").trim() || (typeof process !== "undefined" && process.env?.[name]?.trim()) || "";

/** Where members write to us: refunds, privacy requests, questions. */
export const contactEmail = "crkvgns@gmail.com";

/**
 * Membership settings, used only when features.payments is on. The join form
 * uses Stripe Embedded Checkout; the Worker in worker/membership.js creates
 * each Checkout Session, and card details never reach corkvegans.ie.
 *
 * Everything here is public. Override the first four for a single build
 * with PUBLIC_STRIPE_PUBLISHABLE_KEY, PUBLIC_MEMBERSHIP_ENDPOINT,
 * PUBLIC_TURNSTILE_SITE_KEY and PUBLIC_STRIPE_PORTAL_URL (see
 * docs/ADMIN-GUIDE.md, "Membership").
 */
export const membership = fixtures
    ? {
          publishableKey: "pk_test_fixture",
          endpoint: "https://membership.example",
          turnstileSiteKey: "",
          portalUrl: "https://billing.example/login",
          discountEur: 5,
          eventbriteCodeParam: "discount",
      }
    : {
          /** Stripe publishable key: pk_live_… (or pk_test_… while testing). Never a secret key. */
          publishableKey: env("PUBLIC_STRIPE_PUBLISHABLE_KEY") || "",
          /** The Worker's address, e.g. https://corkvegans-membership.<subdomain>.workers.dev (no path). */
          endpoint: env("PUBLIC_MEMBERSHIP_ENDPOINT") || "",
          /** Cloudflare Turnstile site key. Leave empty unless the Worker has TURNSTILE_SECRET_KEY. */
          turnstileSiteKey: env("PUBLIC_TURNSTILE_SITE_KEY") || "",
          /** Stripe customer portal login link (Settings → Billing → Customer portal). Empty: no "manage" link. */
          portalUrl: env("PUBLIC_STRIPE_PORTAL_URL") || "",
          /** Euros off a member ticket. Keep in step with the Worker's MEMBER_DISCOUNT_EUR. */
          discountEur: 5,
          /** The query parameter that makes Eventbrite apply a code from an event link. */
          eventbriteCodeParam: "discount",
      };

/**
 * Volunteer enquiry form: the Formspree "Volunteer enquiries" form, which
 * emails each enquiry to the organisers' inbox.
 *
 * The endpoint ID is public by design (it is visible in every form's HTML);
 * it is not a secret. Set it to "" to show the form as "not yet open".
 */
export const volunteerForm = {
    endpoint: fixtures ? "https://formspree.io/f/testfixture" : "https://formspree.io/f/mwlvyppw",
};

/**
 * Contact form (About page, #contact): the Formspree form "Contact", kept
 * separate from volunteer enquiries. Public by design, like the volunteer
 * endpoint. While empty, the form is shown as "not open yet".
 */
export const contactForm = {
    endpoint: fixtures ? "https://formspree.io/f/contactfixture" : "https://formspree.io/f/meaeddlp",
};

/** Event sources used by scripts/sync-events.ts. */
export const eventSources = {
    meetupIcalUrl: "https://www.meetup.com/corkvegans/events/ical/",
    /** Used to identify the Cork Vegans organiser within an Eventbrite organisation. */
    eventbriteOrganizerId: "91797524863",
    /**
     * When the same event is listed on both platforms, which listing is the
     * main one (its details and its button); the other gets a secondary button.
     */
    preferredSource: "eventbrite" as "meetup" | "eventbrite",
    /** Show a "may be out of date" notice when event data is older than this. */
    staleAfterHours: 48,
};

export const storyCategories = [
    "Community",
    "News",
    "Reviews",
    "Events",
    "Guides",
    "Stories",
] as const;
