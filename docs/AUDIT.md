# Cork Vegans website — audit and architecture (October 2026)

This audit was done before any changes were made. It describes the site as it
was on `main` at commit `1d350b6`, and the approach chosen for the multipage
expansion.

## 1. Existing architecture

| Area | Finding |
| --- | --- |
| Framework / bundler | None. One hand-written `index.html`, no build step, no `package.json`. |
| Styling | Tailwind CSS v3 **Play CDN** (`cdn.tailwindcss.com?plugins=forms,container-queries`), compiled in the visitor's browser at runtime. Theme tokens are defined inline in `<script id="tailwind-config">`. A small `styles.css` adds scroll offset, reduced-motion rules, `pill-shadow`, `asymmetric-shape`, a float animation and a skeleton loader. Tailwind's own docs say the Play CDN is not meant for production. |
| Design tokens | Material 3–style colour palette (primary `#275d49`, secondary `#bb000e`, surface `#fef8f9`, peach band `rgb(255,220,188)`, Meetup pink `#f64060`); Karla throughout; type scale `display-lg 48`, `headline-lg 32`, `headline-md 24`, `body-lg 18`, `body-md 16`, `label-bold 14`, `label-sm 12`; spacing `xs 4 / sm 8 / md 16 / lg 24 / xl 40`; radii `1rem / 1.5rem / 2rem / full`; `max-w-7xl` container with 16px gutters. |
| Icons / fonts | Google Fonts (Karla) and Material Symbols Outlined, loaded from Google's servers. |
| Routing | Single page with in-page anchors (`#events`, `#communityLinks`, `#resources`). |
| JavaScript | `js/main.js` (sticky header shrinks on scroll, smooth anchor scrolling that respects reduced motion). `js/meetup-events.js` (runtime fetch, see below). |
| Homepage sections | Sticky header (logo + "Get connected"), hero, about ("Community first, plants always." + 4 activity cards), upcoming events, Get connected (Meetup, Facebook, Instagram; an Eventbrite card is commented out), Resources (WhatsApp community, Cork vegan food map), footer. |
| Meetup integration | Browser fetches `https://red-wave-4e83.mikedawsonmd.workers.dev/events` (a Cloudflare Worker whose source is **not** in this repository). It returns `{ events: [{title, date, time, dateISO, month, day, venue, url, image}], fetchedAt }`. Cards are built with string concatenation and an HTML escaper. `dateISO` is labelled UTC (`…Z`) but appears to hold Irish local time — correct in winter, but likely one hour out during Irish Summer Time. |
| Meetup public feed | `https://www.meetup.com/corkvegans/events/ical/` is an official, public iCalendar feed (no credentials) with `TZID=Europe/Dublin` start/end times, status, description and URL. It has no venue or image data for current events. |
| Eventbrite | Organiser page `https://www.eventbrite.ie/o/cork-vegans-91797524863` (commented-out link only). No integration. |
| Donations | **No donation provider found** — not in the repo, the live site, the Linktree, or public web results. |
| Forms | None. |
| CMS | None. |
| Hosting | GitHub Pages, "deploy from branch" (no workflow files). `CNAME` = `corkvegans.ie`. |
| Canonical domain | **Apex `https://corkvegans.ie`**. `https://www.corkvegans.ie` returns a 301 to the apex. Existing `og:url` and JSON-LD use the apex. The new site keeps the apex as canonical. |
| SEO | Title, description, Open Graph and Twitter tags on the homepage; `WebSite` JSON-LD. `og:image:width/height` state 2000×1363 but `bio.jpg` is 1500×1261. No sitemap, no robots.txt, no 404 page. |
| Accessibility | Reduced-motion support, alt text, semantic sections. Issues: hero image alt "Hero background" (decorative image announced), events region labelled but no list semantics, a duplicate `rel` attribute, invalid `draggable="{false}"` attributes, typo "Vegan foor map". |
| Tests / linting | None. |
| Repo visibility | Public (required for free GitHub Pages). **Anything committed — including CMS drafts — is publicly readable on GitHub.** |

## 2. Recommended technical approach

**Astro (static output) + Tailwind CSS v3.4 compiled at build time + Pages CMS +
GitHub Actions deployment to GitHub Pages.**

Why a build step at all: the requirements (individual crawlable article pages
with Open Graph tags in the initial HTML, a sitemap, content validation, image
optimisation) cannot be met by a single hand-written HTML file. Something must
generate HTML from content files.

Why Astro rather than keeping plain HTML or adding a hand-rolled generator:

- Outputs plain static HTML with zero client JavaScript by default — the same
  runtime model as today, and fully compatible with GitHub Pages.
- Components let the header, footer, cards and buttons be written once.
- Built-in image optimisation (sharp) resizes editors' phone photos and
  produces reliable 1200×630 social images.
- Tailwind v3.4 keeps every existing class name and token **identical**,
  so the visual design carries over unchanged; it is compiled once at build
  instead of in each visitor's browser.
- No server, no database, no SSR. Next.js was not considered necessary.

Content (stories) is read with a small, tolerant loader rather than Astro's
strict content collections, so that **a malformed draft can never break the
production build**.

## 3. Reusable components and styles

Everything visual is reused: the Tailwind theme (moved verbatim into
`tailwind.config.mjs`), `styles.css` utilities, header/footer markup, pill
buttons, the bordered `rounded-lg` cards, the section-heading pattern (eyebrow
label + `headline-lg` + coloured bar), the social link tiles and the event card
layout (logo panel + date badge + details + pill CTA).

## 4. Sitemap

```
/                     Home (hero, intro, next events, latest stories, support teaser, get connected, resources)
/events/              All upcoming events (Meetup + Eventbrite)
/stories/             Stories & Updates (paginated: /stories/page/2/ …)
/stories/[slug]/      Individual story
/support/             Support us (#donate, #volunteer)
/about/               About Cork Vegans
/404.html             Not found
/sitemap.xml, /robots.txt, /events.json (last event snapshot)
```

## 5. Third-party integrations

| Integration | Choice | Credentials |
| --- | --- | --- |
| Meetup | Public iCal feed, fetched at build time | None |
| Eventbrite | API v3 `GET /v3/organizations/{id}/events/` with a private token, fetched at build time in GitHub Actions | `EVENTBRITE_TOKEN` (GitHub secret), organisation ID |
| CMS | Pages CMS (hosted, free, open source, Git-backed) | GitHub App install by repo owner |
| Volunteer form | Formspree (hosted form backend; free tier) — endpoint is configurable | Form endpoint ID (public by design, not a secret) |
| Donations | Provider unknown — config-driven hosted-checkout links | Owner must supply one-off and monthly links |

## 6. Risks and breaking changes

1. **Deployment switch.** GitHub Pages must be changed from "deploy from
   branch" to "GitHub Actions" **before** merging, otherwise the branch deploy
   would publish the raw source folder and the live site would break.
2. Event data becomes build-time data refreshed every few hours rather than
   fetched live from the Worker. New Meetup events can take up to ~6 hours to
   appear (or can be refreshed instantly with "Run workflow").
3. GitHub disables scheduled workflows in public repos after 60 days without
   repository activity; the site then shows a "last updated" notice and hides
   past events in the browser, but new events stop appearing until a run.
4. Drafts in a public repository are publicly readable on GitHub.
5. Pages CMS collaborators get edit access to every collection configured in
   `.pages.yml`; there are no per-collection roles.
6. Google Fonts continue to be loaded from Google (existing behaviour; see
   next improvements).

## 7. Estimated additional recurring cost

**€0/month.** GitHub Pages and Actions are free for public repositories; Pages
CMS hosted app is free; Meetup iCal is free; Eventbrite API is free with an
organiser account; Formspree's free tier (50 submissions/month at time of
writing) is expected to be sufficient. All free tiers can change — see
`ADMIN-GUIDE.md`.

## 8. What the owner needs to provide

- Switch GitHub Pages source to GitHub Actions (repo admin).
- Install the Pages CMS GitHub App on this repository only, and invite editors.
- Eventbrite private token and organisation ID (if Eventbrite events should appear).
- Donation provider name plus one-off and monthly checkout links.
- A Formspree account (or chosen alternative) and the form endpoint, with the
  notification email set to an organisers' address.
- Approval of the Support page wording and privacy notice.
