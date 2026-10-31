# Cork Vegans Website

Official website for the Cork Vegans community: **https://corkvegans.ie**

A static site built with [Astro](https://astro.build) and Tailwind CSS,
hosted on GitHub Pages. Stories are edited by the team in
[Pages CMS](https://pagescms.org). Events are pulled from Meetup (and
Eventbrite, when configured) every few hours.

## Pages

| URL | Page |
| --- | --- |
| `/` | Home: hero, intro, next events, latest stories, support |
| `/events/` | All upcoming events (Meetup + Eventbrite) |
| `/stories/` | Stories & Updates (paginated at `/stories/page/2/` …) |
| `/stories/<slug>/` | Individual story, with social preview metadata and share buttons |
| `/resources/` | Useful links: WhatsApp community, Cork vegan food map |
| `/support/` | Membership summary (`#membership`) and volunteer (`#volunteer`) |
| `/membership/` | Join (`#join`), partner discounts (`#partners`) and the membership card (`#card`) |
| `/membership/card/`, `/membership/check/` | A member's digital card, and the page a business opens from its QR code (not indexed) |
| `/membership-terms/` | Membership terms |
| `/privacy/` | Privacy notice |
| `/about/` | About Cork Vegans |

## Documentation

- **[Story editor guide](docs/CONTENT-EDITOR-GUIDE.md)**: for team members
  writing stories (no technical knowledge needed).
- **[Administrator guide](docs/ADMIN-GUIDE.md)**: deployment, events,
  CMS access, membership and payments, the volunteer form, troubleshooting and costs.
- **[Audit and architecture](docs/AUDIT.md)**: why the site is built this way.

Run `npm run dev:fixtures` to preview the Stories pages with example
content (the test fixtures). It is never published.

## Development

Requires Node.js 24+.

```bash
npm ci
npm run dev            # local site at http://localhost:4321
npm run dev:fixtures   # same, with example stories and test form/payment links
npm run sync:events    # refresh events from Meetup/Eventbrite into src/data/events.json
npm test               # unit tests (events, stories, sanitising, CMS config, form)
npm run build          # production build into dist/, then automatic site checks
npm run test:e2e       # browser tests incl. accessibility (npx playwright install chromium first)
npm run check          # TypeScript / Astro type check
```

Deployment is automatic: every push to `main` (including Pages CMS saves)
and a run every 6 hours build and publish the site via
`.github/workflows/deploy.yml`. Nothing to run by hand.

## Next improvements

In order of value:

1. **Connect the volunteer form** (owner setup; see the admin guide). Payments are switched off until membership launches.
2. **Self-host the fonts** (Karla, Material Symbols) to stop sending
   visitors' IP addresses to Google and speed up the first load.
3. **Optimise the hero and about photos** (currently 1–1.5 MB JPEGs) with
   Astro's image pipeline. Keep `/images/bio.jpg` for existing share links.
4. **Draft previews** on a separate free preview host (e.g. a `preview`
   branch deployed to Cloudflare Pages with `noindex`), so editors can see a
   draft on the real layout before publishing.
5. **Category filter pages** for stories, once there are enough stories to
   justify them.
6. **Upgrade to Tailwind CSS v4** with a visual regression check, to clear
   the build-time `npm audit` advisories.
7. **Simple event source filter** (Meetup / Eventbrite) if Eventbrite becomes a
   regular source.

## License

Content and branding are the property of Cork Vegans unless otherwise stated.
