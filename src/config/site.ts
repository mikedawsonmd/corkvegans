/**
 * Site-wide settings. Administrators edit this file (via GitHub) to change
 * links, donation checkout URLs, the volunteer form endpoint and event sources.
 *
 * Nothing in this file is secret: everything here ends up in public HTML.
 * Never put API tokens or passwords in this file — use GitHub Actions secrets.
 */

/**
 * Test builds only (CV_FIXTURES=1, used by the automated browser tests):
 * fake form and donation endpoints so those flows can be exercised.
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
 * Donations: Stripe Payment Links, managed in the Cork Vegans Stripe account.
 *
 * Card details are entered on Stripe's site, never on corkvegans.ie. Each
 * payment link's confirmation page should redirect to /support/thanks/.
 *
 * Leave a URL empty to show that option as "coming soon" instead of a
 * broken link (for monthly, empty the whole `monthly` list).
 */
export const donations = fixtures
    ? {
          providerName: "Test Provider",
          oneOffUrl: "https://donate.example/once",
          monthly: [
              { label: "€5 a month", url: "https://donate.example/monthly-5" },
              { label: "€10 a month", url: "https://donate.example/monthly-10" },
          ],
          manageUrl: "https://donate.example/manage",
      }
    : {
          /** Shown to visitors, e.g. "Stripe" or "PayPal". */
          providerName: "Stripe",
          /** Hosted checkout for a one-off gift (donor chooses the amount). */
          oneOffUrl: "https://donate.stripe.com/eVq7sFgkE5V025l9GL0co03",
          /** Hosted checkouts for monthly recurring gifts, one button each. */
          monthly: [
              { label: "€5 a month", url: "https://buy.stripe.com/7sY28lc4ocjoaBR6uz0co00" },
              { label: "€10 a month", url: "https://buy.stripe.com/fZuaER5G06Z4dO3cSX0co01" },
              { label: "€20 a month", url: "https://buy.stripe.com/cNi9AN9Wg1EKdO3dX10co02" },
          ],
          /** Customer portal where monthly donors change or cancel their gift. */
          manageUrl: "https://billing.stripe.com/p/login/7sY28lc4ocjoaBR6uz0co00",
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
