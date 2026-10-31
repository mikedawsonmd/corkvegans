# Cork Vegans — Administrator Guide

For whoever looks after the website's GitHub repository and accounts.
Editors only need [CONTENT-EDITOR-GUIDE.md](CONTENT-EDITOR-GUIDE.md).

---

## 1. How the site works

```
 Pages CMS (editors) ─┐
 Admin edits / PRs ───┼──► GitHub repo (main) ──► "Deploy site" Action ──► GitHub Pages ──► corkvegans.ie
 Every 6 hours ───────┘          ▲                    │
                                 │                    ├─ fetch Meetup iCal + Eventbrite API → events
                                 │                    ├─ unit tests
                                 │                    ├─ astro build (stories, pages, sitemap, OG images)
                                 │                    └─ post-build checks (links, metadata, drafts, secrets)
```

- **Static site** built with [Astro](https://astro.build). Output is plain
  HTML/CSS with a little JavaScript. There's no server or database.
- **Styling:** Tailwind CSS v3, using the original theme tokens
  (`tailwind.config.mjs`) and `src/styles/global.css`.
- **Content:** stories are Markdown files in `src/content/stories/`, and
  their images are in `src/assets/stories/`.
- **Settings:** in `src/config/site.ts`: navigation, social links (footer
  icons), the Resources page links, membership settings and the form endpoints.

| Path | What it is |
| --- | --- |
| `src/pages/` | One file per page/route |
| `src/components/` | Reusable building blocks (header, footer, cards, form…) |
| `src/lib/events/` | Meetup/Eventbrite fetching, normalising, de-duplication |
| `src/lib/stories.ts`, `src/lib/markdown.ts` | Story parsing, validation and safe rendering |
| `src/data/events.json` | Fallback event snapshot (refreshed by CI on every build) |
| `scripts/sync-events.ts` | Event refresh script |
| `scripts/check-dist.ts` | Post-build checks; a failure blocks the deploy |
| `.pages.yml` | Pages CMS configuration |
| `.github/workflows/` | `deploy.yml` (build + publish), `checks.yml` (pull request checks) |

---

## 2. First-time setup (one-off)

Do these **in this order**.

### 2.1 Switch GitHub Pages to deploy from Actions

The site used to be served directly from the `main` branch. It now needs a
build step.

1. GitHub → repository → **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Check **Custom domain** still shows `corkvegans.ie` and **Enforce HTTPS**
   is ticked. Don't change DNS.

> Do this **before** merging the new site into `main`. If the old
> "deploy from branch" setting is still active when the new code lands, the
> raw source folder would be published and the live site would break.

### 2.2 Merge and deploy

Merge the `feature/multipage-site` branch into `main` (via a pull request).
The **Deploy site** workflow runs automatically. Watch it under **Actions**;
it takes about 2 minutes.

### 2.3 Protect `main` (recommended)

Settings → Rules → Rulesets → New branch ruleset for `main`: enable
**Block force pushes** and **Restrict deletions**. Don't require pull
requests, because that would stop Pages CMS from saving, and would stop the
social posting workflow from recording what it has posted
(`data/social-posted.json`), risking repeat posts.

### 2.4 Pages CMS

1. Go to **https://app.pagescms.org** and sign in with the GitHub account
   that owns the repository.
2. When asked to install the **Pages CMS GitHub App**, choose
   **Only select repositories → corkvegans**. Don't grant it access to all
   repositories.
3. Open the project. You should see **Stories** and **Media → Story images**.

**About the app's permissions:** the GitHub App needs read/write access to
repository contents so that it can save stories, and your install screen
will list any other permissions it asks for. Review them before approving.
Editors can only change what `.pages.yml` exposes (stories and story images),
but the app itself can write to the whole repository. Keep the owner's
GitHub account protected with two-factor authentication, and only invite
people you trust.

### 2.5 Eventbrite (optional, **requires owner setup**)

Only needed if Cork Vegans lists events on Eventbrite.

1. Log in to the Cork Vegans Eventbrite account → **Account settings →
   Developer links → API keys** → create an API key, then copy its
   **Private token**.
2. Find the **organisation ID**: with the token, open
   `https://www.eventbriteapi.com/v3/users/me/organizations/` (for example
   in a terminal: `curl -H "Authorization: Bearer <TOKEN>" https://www.eventbriteapi.com/v3/users/me/organizations/`)
   and copy the `id`.
3. GitHub → **Settings → Secrets and variables → Actions**:
   - **Secrets** tab → New secret `EVENTBRITE_TOKEN` = the private token.
   - **Variables** tab → New variable `EVENTBRITE_ORGANIZATION_ID` = the ID.
4. Actions → **Deploy site** → **Run workflow**. In the run's summary, the
   **Event sync** table should show `eventbrite ✅ ok`.

Events are filtered to the Cork Vegans organiser (`eventbriteOrganizerId` in
`src/config/site.ts`, taken from
`eventbrite.ie/o/cork-vegans-91797524863`).

The token is only ever used inside GitHub Actions. It never appears in the
website, and the post-build check fails the deploy if it ever does.

To remove Eventbrite, delete the secret. The site falls back to Meetup only.

### 2.6 Membership (**switched off** until set up)

Cork Vegans membership is "contribute what you can": monthly (€5, €10, €15
or another amount from €2 to €500) or yearly (€50, €100 or another amount
from €50 to €500). Every member gets the same benefits: €5 off one ticket
per paid event, early booking, member events, a digital membership card,
and discounts at partner businesses once there are some. Everything about
membership is on `/membership/` (the Support page links there). The terms
are on `/membership-terms/`; keep them in step with the Membership page.

**How it works**

1. On the Membership page (`#join`) the visitor picks an amount, enters
   their name and email, agrees to the terms and presses **Join**.
2. The membership Worker (`worker/`, on Cloudflare) checks everything and
   creates a Stripe Checkout session. Stripe's checkout opens in a modal;
   card details go straight to Stripe, never to corkvegans.ie.
3. When the payment goes through, Stripe sends `checkout.session.completed`
   to the Worker's webhook. The Worker makes the member's code (like
   `CV-7K3P9Q`), creates it on Eventbrite as an access code with €5 off on
   the **Members** ticket group, saves the code on the Stripe subscription,
   and sends the welcome email through Brevo.
4. Meanwhile the modal says "Welcome to Cork Vegans!" and shows the code as
   soon as it exists, with a Copy button and an "Open your membership card"
   button. The code is remembered in the browser, so Eventbrite links on our
   events list apply it automatically. The welcome email's events link does
   the same on any device, and its card link opens the card.
5. Each renewal (`invoice.paid`) moves the code's end date to the new period
   end plus 3 days. Cancelling keeps the code until the paid period ends.
   When the membership ends (`customer.subscription.deleted`) the code is
   deleted, or ended now if it's been used (Eventbrite can't delete used
   codes).
6. "Lost your code?" on the Membership page re-sends the welcome email
   (code and card link) to any live membership under that email, and always
   shows the same message.

**Membership card.** `/membership/card/#<token>` shows the member's first
name, the current month and year in large type, a ticking clock (so a
screenshot is easy to spot) and a QR code. The token is the subscription ID
plus a signature made with `MEMBER_CODE_SECRET`, so it can't be guessed and
nothing extra is stored; it isn't the member code, so a business never sees
the Eventbrite discount. Each time the card opens it asks the Worker
(`POST /membership/card`) whether the membership is live; once it ends, the
card says so instead of showing the month. Offline, it shows the last answer
from the same calendar month. The QR code opens `/membership/check/#<token>`
on the business's phone: a green "Valid member" with the first name (and the
end date if the member has cancelled), or a red "Not a current member". A
member can't get a new token without changing `MEMBER_CODE_SECRET`, which
would also change every future member code, so never change it.

**Partner businesses.** Organisers add them in Pages CMS → **Partners**:
name, discount, short description, area, website, logo and how to claim. New
partners start **hidden**: untick Hidden to show one on the Membership page,
and tick it again when the discount ends. Agree the wording with the business
first. "Discounts at our partner businesses" only appears in the member
benefits once at least one partner is shown. Businesses ask to join through
**Become a partner**, which opens the contact form with the topic
"Discount partnership". Files are `src/content/partners/*.yml`, logos
`src/assets/partners/`.

Every webhook step is safe to repeat (Stripe retries failures): the code and
Eventbrite discount ID are saved on the subscription, and the code is worked
out from the subscription ID, so a member never gets two codes.

**Where things live**

| What | Where |
| --- | --- |
| Membership page | `src/pages/membership/index.astro` |
| Join form, amounts and limits | `src/components/MembershipForm.astro`, `src/scripts/membership-form.ts`, `src/lib/membership.ts` |
| Card and check pages | `src/components/MemberCard.astro`, `src/components/CardCheck.astro`, `src/scripts/card-api.ts`, `src/scripts/member-card.ts`, `worker/card.js` |
| Partner businesses | `src/content/partners/`, `src/lib/partners.ts`, Pages CMS "Partners" |
| On/off switch | `features.payments` in `src/config/site.ts` |
| Publishable key, Worker address, Turnstile site key, portal link, €5 | `membership` in `src/config/site.ts` |
| Worker routes and checkout | `worker/membership.js` (entry point `worker/index.js`, config `worker/wrangler.toml`) |
| Webhook, codes, Eventbrite, email | `worker/stripe-webhook.js`, `worker/members.js`, `worker/eventbrite.js`, `worker/welcome-email.js` |
| Stripe product and prices | `scripts/stripe-membership-catalogue.ts` |
| Terms and privacy pages | `src/pages/membership-terms/`, `src/pages/privacy/` |

The amounts in `src/lib/membership.ts` and `worker/membership.js` must
match; a unit test fails if they drift apart. If you change the €5, change
`MEMBER_DISCOUNT_EUR` in `worker/wrangler.toml` and `discountEur` in
`src/config/site.ts` together.

**Setup checklist.** Do it all in Stripe test mode first, then repeat the
Stripe steps in live mode.

1. **Product and prices.** Run the catalogue script with a secret key that
   has Products: Write and Prices: Write (type it only in that command):
   ```sh
   STRIPE_SECRET_KEY=sk_test_… node scripts/stripe-membership-catalogue.ts
   ```
   It creates one product per preset amount (**Cork Vegans membership: €5 a
   month** and so on), each with one price whose lookup key is
   `membership_monthly_5`, `_10`, `_15`, `membership_yearly_50` or `_100`,
   plus **Cork Vegans membership** (ID `cv_membership_custom`) for amounts
   members choose themselves. Running it again changes nothing. Each preset
   needs its own product because the customer portal only allows one
   monthly and one yearly price per product.
2. **Restricted key for the Worker.** Developers → API keys → Create
   restricted key: Checkout Sessions: Write, Customers: Write,
   Subscriptions: Write, Prices: Write, Products: Read. Everything else None.
3. **Customer portal.** Settings → Billing → Customer portal: allow
   cancelling (at the end of the billing period). Under subscriptions,
   allow switching plans and add only the three **monthly** products
   (**Cork Vegans membership: €5 / €10 / €15 a month**); choose **No charges
   or credits**, and **Wait until end of billing period** for downgrades.
   Leave the yearly products out: Stripe moves a yearly member to a monthly
   product at once, charging the first month that day and dropping the
   rest of the paid year (tested October 2026). Yearly members and those
   who chose their own amount change by cancelling and rejoining, or by
   emailing us; the terms and welcome email say so.
   Copy the portal's **login link** (https://billing.stripe.com/p/login/…).
4. **Webhook.** Developers → Webhooks → Add endpoint:
   `https://corkvegans-membership.<your-subdomain>.workers.dev/stripe/webhook`,
   API version `2026-09-30.endive` (the Worker reads fields in that
   version's shape), events `checkout.session.completed`, `invoice.paid`,
   `customer.subscription.updated`, `customer.subscription.deleted`. Copy
   its signing secret (`whsec_…`).
5. **Eventbrite.**
   - Create a ticket group called **Members** (Organization settings, or
     when you first add a member ticket). Find its ID with
     `GET https://www.eventbriteapi.com/v3/organizations/<org id>/ticket_groups/`.
   - Make the Worker its own private token. Eventbrite tokens can do
     anything their account can, so ideally create it from a team member
     whose role only allows managing events and promo codes.
   - **For each paid event:** besides the public ticket, add a **Member
     ticket** at the same price, set to **hidden**, with a maximum of **1 per
     order**, with "Member" in its name (e.g. **Member ticket**). Every
     deploy (each push, and every 6 hours) puts hidden tickets named like
     that into the Members group; to do it straight away, run Actions →
     "Deploy site" → "Run workflow". Start its sales before
     the public ticket's: that's the early booking window. Members' codes
     reveal it and take €5 off; at €5 or less it's free.
   - **Member events:** give the event only a hidden Member ticket.
   - In GitHub, add the variable `EVENTBRITE_MEMBERS_TICKET_GROUP_ID` (the
     group's ID) under Settings → Secrets and variables → Actions →
     Variables; without it the deploy skips the member-ticket step.
   - **Confirmed in October 2026:** the API accepts an access code with
     `amount_off` on the Members group, stores `end_date` as sent (Irish
     time), finds codes with the `multi_events` scope, and moves the end date
     on update. Checked on a private test event the same month: a link ending
     `?discount=<code>` reveals the hidden Member ticket with the €5 off, and
     a ticket discounted to €0 checks out without card details.
   - Eventbrite's editor doesn't show ticket groups, hence the deploy step
     (`scripts/sync-member-tickets.ts`). It reads the group, adds any
     missing member tickets and sends the whole list back with
     `POST /v3/ticket_groups/<group id>/`. Names with "non-member" are
     ignored, and so are tickets that aren't hidden.
   - Private events never appear on the site's events page.
6. **Brevo.** Senders, domains & dedicated IPs → Domains: add
   corkvegans.ie with the branded subdomain members.corkvegans.ie, and add
   the DNS records it shows at GoDaddy (Brevo code, two DKIM CNAMEs and three
   branding CNAMEs: `members`, `r.members`, `img.members`). Don't add Brevo's
   DMARC record: corkvegans.ie already has one, and a second breaks both.
   Then authenticate it. Add the sender address you'll use in `EMAIL_FROM`
   (members@corkvegans.ie, done October 2026; it needs no mailbox, as
   replies go to `EMAIL_REPLY_TO`). In the transactional Tracking settings,
   set anonymous tracking to **Yes**. Brevo can't switch click tracking off on
   this plan, so links in the email go through r.members.corkvegans.ie; the
   privacy page says so. Then SMTP & API → API keys → generate a key
   (`xkeysib-…`): no expiration, **Restricted**, Transactional email
   **All**, everything else None. Leave IP blocking (Security → Authorized
   IPs) off: Cloudflare's sending addresses change. Brevo deletes a key
   after 90 days without use, so the Worker's weekly cron makes one
   read-only call to keep it alive (`wrangler.toml` `[triggers]`).
7. **Deploy the Worker.** From `worker/`: `npx wrangler login`, then
   `npx wrangler secret put NAME` for each of:
   `PAYMENTS_ENABLED` (`true`), `STRIPE_SECRET_KEY` (the `rk_…` key),
   `STRIPE_WEBHOOK_SECRET`, `MEMBER_CODE_SECRET` (any long random string;
   never change it), `EVENTBRITE_TOKEN`, `EVENTBRITE_ORGANIZATION_ID`,
   `EVENTBRITE_MEMBERS_TICKET_GROUP_ID`, `BREVO_API_KEY`, `EMAIL_FROM`
   (e.g. `Cork Vegans <members@corkvegans.ie>`) and `STRIPE_PORTAL_URL`.
   Optional: `TURNSTILE_SECRET_KEY`. Then `npx wrangler deploy`. The previous payments
   Worker (the one this replaces) can then be deleted in Cloudflare.
8. **Point the site at it.** In `src/config/site.ts` → `membership`, put the
   publishable key (`pk_live_…`), the Worker address (no path) and the
   portal login link in place of the empty strings, set
   `features.payments` to `true`, and commit to `main`.

**Testing end to end (test mode).**

1. In `worker/.dev.vars` (ignored by git), put the same names as step 7
   with test values: `PAYMENTS_ENABLED=true`, the `rk_test_…` key, and so
   on. Leave `STRIPE_WEBHOOK_SECRET` for step 3.
2. In `.env.local`: `PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_…`,
   `PUBLIC_MEMBERSHIP_ENDPOINT=http://localhost:8787` and
   `PUBLIC_STRIPE_PORTAL_URL=` the test portal login link. Switch
   `features.payments` on locally (don't commit that).
3. Forward Stripe's events to your machine with the
   [Stripe CLI](https://docs.stripe.com/stripe-cli):
   ```sh
   stripe login
   stripe listen --forward-to localhost:8787/stripe/webhook
   ```
   It prints a signing secret (`whsec_…`): put it in `worker/.dev.vars` as
   `STRIPE_WEBHOOK_SECRET`.
4. Run `npx wrangler dev` in `worker/` and `npm run dev` in the project,
   open http://localhost:4321/membership/#join, and join with card
   `4242 4242 4242 4242`, any future date and any CVC. `stripe listen`
   should show the events answered with 200; the modal shows the code, the
   email arrives, and the code appears under Eventbrite's promo codes.
   Eventbrite has no test mode, so use a private test event.
5. Renewal: `stripe subscriptions update sub_… -d billing_cycle_anchor=now
   -d proration_behavior=none` makes an immediate invoice; the code's end
   date moves. Cancelling: `stripe subscriptions cancel sub_…` deletes the
   code. `npx wrangler tail` shows the deployed Worker's logs.

**Abuse protection.** The Worker only accepts requests from corkvegans.ie
(and localhost while testing), checks every field itself, and rate limits
per IP: 5 checkouts, 3 "Lost your code?" requests, 30 code checks and 30
card checks a minute. Cloudflare Turnstile is optional: create a widget for
`corkvegans.ie`, set the Worker's `TURNSTILE_SECRET_KEY` and
`turnstileSiteKey` in `src/config/site.ts`. Set both or neither, otherwise
every join is rejected.

**Receipts.** Turn on Settings → Customer emails → Successful payments in
Stripe so members get a receipt for each payment.

### 2.7 Volunteer form (**set up**)

The form posts to the Formspree form "Volunteer enquiries"
(`https://formspree.io/f/mwlvyppw`), which emails each enquiry to the
organisers' inbox. Without an endpoint, the form shows "Online volunteer
sign-up isn't open yet" and can't be submitted. These were the setup steps:

1. Create a free account at **https://formspree.io** using an organisers'
   shared email address. Notifications go there.
2. Create a new form named "Volunteer enquiries" and copy its endpoint,
   e.g. `https://formspree.io/f/abcdwxyz`.
3. In Formspree's form settings, turn on spam filtering and restrict
   submissions to the `corkvegans.ie` domain, if those options are available
   on your plan.
4. Put the endpoint in `src/config/site.ts`:
   `volunteerForm.endpoint: fixtures ? "…" : "https://formspree.io/f/abcdwxyz"`.
5. Commit, wait for the deploy, and send a test enquiry.

The endpoint ID isn't a secret. It's visible in any form's HTML by design.

**Privacy / GDPR checklist.** Review the "How we use your details" text in
`src/components/VolunteerForm.astro` and make sure it matches what you
actually do. In particular:

- Formspree is US-based. Check its current Data Processing Agreement and
  international transfer terms, and keep a copy.
- Agree who on the team can see enquiries, and how long you keep them.
  Delete old ones periodically from the Formspree dashboard and the
  notification inbox.
- Volunteers are **not** added to any mailing list.
- If someone asks to see or delete their data, find their enquiry in
  Formspree and the inbox, and act on it.

**Alternatives**, if the free tier stops being suitable: Web3Forms (forwards
by email without storing), Tally (EU-based form builder, embedded form), or a
small Cloudflare Worker with Turnstile. The existing Cloudflare account
could host the Worker, but sending email from it needs Cloudflare Email
Routing, which means a DNS change.

### 2.8 RSS feed, Facebook and Instagram (**requires owner setup** for social)

The stories RSS feed (`/stories/feed.xml`, for the email newsletter) and the
social image crops work automatically. Posting stories to the Facebook Page
and Instagram needs a one-off Meta setup and three GitHub secrets
(`META_PAGE_ID`, `META_IG_USER_ID`, `META_PAGE_ACCESS_TOKEN`). Everything,
including dry runs, is in **`docs/social-publishing.md`**.

### 2.9 Contact form (**set up**: Formspree form "Contact", `meaeddlp`)

The About page has a **Get in touch** form (`/about/#contact`) for
questions, event and story ideas, recommendations, collaborations, press
and website feedback. It's separate from the volunteer form. Until it's set
up, it shows "Our contact form isn't open yet".

1. In the same Formspree account, create a **new** form called **Contact**
   (separate from "Volunteer enquiries").
2. In its settings, check the notification email and turn **reCAPTCHA off**.
   The site has its own spam protection: a hidden trap field, dropping
   anything sent within 5 seconds of opening the page, and limits on length
   and links.
3. Put its endpoint in `src/config/site.ts`:
   `contactForm.endpoint: fixtures ? "…" : "https://formspree.io/f/…"`.
4. Commit, wait for the deploy, and send a test message.

Each email's subject says the topic, e.g. *"Contact: Suggest an event"*, so
you can filter them in your inbox. Links like `/about/?topic=event#contact`
open the form with a topic chosen; the Events, Stories and Resources pages
use these. The topic list is in `src/scripts/contact-form.ts`. The same
privacy checklist as the volunteer form (section 2.7) applies.

---

## 3. Everyday site changes

| To change… | Edit in `src/config/site.ts` |
| --- | --- |
| Resources page links | `resources`: copy an entry, then set the title, description, `https://` link and icon colour. Use `image` for a small white icon in `public/images/socials/`, or `icon` for any [Material Symbols](https://fonts.google.com/icons) name. |
| Footer social icons | `socials` (and the URLs in `links`) |
| Top navigation | `nav`. The green "Support us" button is `headerCta`. |

Commit to `main` and the site updates after the deploy.

**Animal illustrations:** the drawings live in `public/images/illustrations/`
and are listed in `src/lib/animals.ts`, with each animal's size relative to
the cow so groups stay in proportion. On each page load the animals are
shuffled and dealt out, so **no animal appears twice on a page**:

- the footer gets a group of 2–3 (never the same group twice in a row);
- then groups of 2–3 go to places around the page while animals remain
  (up to `spotsPerPage`). A lone animal is only used when nothing else is
  showing.
- Places closer than `minSpotGap` (300px) to one already used are skipped,
  so a page header and the card right below it never both get animals.

With the current five farm animals that usually means the footer plus one
group on the page; each new drawing adds variety and, eventually, a second
group. To add a drawing, use a single-colour SVG with the feet touching the
bottom edge and add it to `animals` with its width, height, scale and the way
it faces; it joins the groups automatically. `roams: false` keeps one out (the
shark only appears on the 404 page).

Places an animal may appear are marked in the components with
`animalSpot(kind, zone)`: standing on top of an image or card (`ledge`), or
walking along the bottom of a section (`floor`) — the homepage photo, the
inner page headers, and the foot of some full-width sections, where they keep
to the outer edges (the wide margins on desktop). Floor animals are larger,
take the colour of the section below (as if growing out of it), and are only
used where that section's colour clearly differs — never white on white.
Spots with the same `zone` count as one place. Remove the attribute
to stop animals appearing somewhere.

**Header behaviour:** the header gains a shadow when you scroll. It only
shrinks on phones (under 768px wide); on larger screens it stays full height.

## 4. Managing editors (Pages CMS)

- **Add an editor:** in Pages CMS, open the project → **Settings /
  Collaborators** → invite their email. They don't need a GitHub account.
  Anyone who already has GitHub access to the repository can also sign in
  with GitHub.
- **Remove an editor:** remove them from Collaborators. For GitHub users,
  also remove them under GitHub → Settings → Collaborators.
- **Recover access:** editors sign in with a link emailed to them. If
  they've lost access to that inbox, remove and re-invite them with a new
  address.
- **What editors can do:** create, edit and delete stories and story
  images. They can't change `.pages.yml`, manage collaborators, site
  settings, membership settings or code. There are no finer-grained roles: every
  editor can edit every story.
- **Who changed what:** every save is a commit with the editor's name
  (`settings.commit.identity: user`). See GitHub → repository → Commits, or
  the history of a file in `src/content/stories/`.

### Guest contributors (one-off stories)

Pages CMS has no temporary links or "submit for review" role, so a guest
contributor is simply invited, writes a draft, and has their access removed
once the story is out:

1. **Invite** their email under **Settings → Collaborators**.
2. **Send them the message below** with the quick-start guide
   (`docs/CONTRIBUTOR-QUICKSTART.md`; on GitHub, open the file and share its
   link).
3. When they say it's ready, **review the draft** in Pages CMS: tidy it up,
   check the photos and image description, then untick **Draft** and save.
4. **Remove them** from Collaborators once the story is published (or keep
   them if they'd like to write again).

Guests can technically edit or publish any story. Draft-by-default and the
saved history (every change is recorded and can be undone) are the safety
net, so only invite people you trust.

**Invite message to copy and send:**

> Hi! Thanks so much for offering to write for Cork Vegans. 🌱
>
> You'll get an email from **Pages CMS** inviting you to our *corkvegans*
> project (check spam if it's not there). To write your story:
>
> 1. Go to **https://app.pagescms.org**, enter this email address and click
>    the sign-in link you're sent. No password or GitHub account is needed.
> 2. Open **Stories**, add a new entry, and fill in the form.
> 3. **Leave "Draft" ticked**, save, and message me when it's ready. I'll
>    review it and publish it.
>
> There's a 10-minute guide here: [link to CONTRIBUTOR-QUICKSTART.md]
>
> Any questions, just ask!

---

## 5. Events

- **Meetup** comes from the group's public iCal feed
  (`https://www.meetup.com/corkvegans/events/ical/`). No login or key is
  needed.
- **Eventbrite** comes from the API (section 2.5).
- Events are refreshed **every 6 hours**, on every push, and when you click
  **Actions → Deploy site → Run workflow** for an instant refresh.
- Events shown on both platforms (similar title, start within 90 minutes)
  are merged into one card with an "Also on …" link. Meetup is the main
  listing; change `preferredSource` in `src/config/site.ts` to prefer
  Eventbrite.
- **If a source fails**, the previous events for that source are kept. The
  build reads them back from `https://corkvegans.ie/events.json`. A warning
  appears in the run summary, and the deploy still goes ahead.
- **In visitors' browsers**, events that have finished are hidden
  automatically. If the data is more than 48 hours old
  (`staleAfterHours`), a "last updated…" notice with a link to Meetup
  appears.
- **GitHub limitation:** in public repositories, GitHub **disables
  scheduled workflows after 60 days with no commits**. If the event list
  goes stale, check Actions for a "workflow disabled" banner and re-enable
  it. Any story edit or commit also keeps it alive. Scheduled runs can also
  start some minutes late at busy times.
- The old Cloudflare Worker (`red-wave-4e83.mikedawsonmd.workers.dev`) is no
  longer used by the site. Leave it running until the new site is live, then
  it can be retired.

---

## 6. Deployments and rollback

- **See deploys:** GitHub → Actions → **Deploy site**. Each run's summary
  shows the event sync table and the site checks (pages checked, stories
  published, drafts, any skipped stories with the reason).
- **A failed run never takes the site down.** GitHub Pages keeps serving the
  last successful deploy.
- **Undo a bad change:** GitHub → Commits → open the commit → **Revert**
  (or `git revert <sha>` locally) → push to `main`.
- **Roll back to an older version quickly:** Actions → Deploy site → open an
  older successful run → **Re-run all jobs**. This rebuilds that commit's
  site. Revert the commit afterwards so the next deploy doesn't undo the
  rollback.
- **Emergency: back to the old single-page site.** Settings → Pages →
  Source "Deploy from a branch" and choose a branch containing the old
  `index.html` (e.g. a branch made from commit `1d350b6`).

---

## 7. Troubleshooting builds

| Symptom | Likely cause / fix |
| --- | --- |
| Story not on the site | Run summary → "Site checks" lists skipped stories and why (missing title/summary/date, broken front matter, duplicate address). Fix it in Pages CMS. |
| Deploy failed at "Build and check site" | The log lists each failing check (e.g. broken internal link, missing metadata). Fix it, or revert the last commit. |
| Deploy failed at "Unit tests" | A code change broke something. Revert, or fix and push. |
| "Event sync" shows ⚠️ | Meetup/Eventbrite was down or the token expired. Previous events are kept; check the token if it persists. |
| Deploy step fails with a Pages error | Settings → Pages → Source must be **GitHub Actions**. |
| `npm` fails locally with certificate errors | You're behind a TLS-inspecting proxy; run with `NODE_USE_SYSTEM_CA=1`. |

**Run locally** (Node 24+):

```bash
npm ci
npm run dev            # http://localhost:4321 with real content
npm run dev:fixtures   # with example stories and test form and membership endpoints
npm run sync:events    # refresh src/data/events.json
npm run build          # production build + checks → dist/
npm test               # unit tests
npm run test:e2e       # browser tests (needs: npx playwright install chromium)
```

---

## 8. Free-tier limits and costs

All services are free today. Expected recurring cost: **€0/month**.

| Service | Free terms to keep an eye on |
| --- | --- |
| GitHub Pages / Actions | Free for public repositories. Pages has a soft limit of 100 GB bandwidth/month and 10 builds/hour. |
| Pages CMS (hosted) | Free and open source; it can be self-hosted if the hosted service ever changes. |
| Meetup iCal | Free; depends on Meetup keeping the public feed. |
| Eventbrite API | Free with an organiser account; subject to API rate limits (the site makes a few calls every 6 hours). |
| Formspree | Free tier has a monthly submission cap (50/month at the time of writing). Check before relying on it. |
| Stripe | Free to set up; Stripe charges a fee per payment. |
| Brevo | Free plan has a daily email cap (a few hundred). Plenty for welcome emails. |
| Cloudflare Workers | Free tier allows 100,000 requests a day. |

Re-check these terms once a year.

---

## 9. Security notes and residual risks

- No secrets in the repository. The only credential, the Eventbrite token,
  lives in GitHub Actions secrets. The workflows run with read-only
  permissions, except the deploy step, which can only publish to Pages.
- Story content is sanitised at build time. Scripts, iframes, inline event
  handlers and `javascript:` links are removed, and the H1 is reserved for
  the title.
- External event data is validated: only `https` links to Meetup/Eventbrite
  hosts are accepted, and all text is escaped.
- GitHub Actions are pinned to exact commit SHAs.
- **Residual risks:**
  - CMS saves publish straight to `main` with no review step. A compromised
    editor account could publish unwanted stories. Mitigate by only inviting
    trusted people, removing leavers promptly, and reverting via Git history.
  - Drafts are publicly readable in the GitHub repository.
  - Fonts (Karla, Material Symbols) are still loaded from Google Fonts, as
    before. This sends visitors' IP addresses to Google. Self-hosting the
    fonts is recommended (see README "Next improvements").
  - `npm audit` reports build-time-only advisories in Tailwind CSS v3's file
    scanning dependencies. They don't affect the published site (no runtime
    code) and only process this repository's own files. Upgrading to
    Tailwind v4 would clear them, but it needs a careful visual check.
  - Eventbrite event images are loaded from Eventbrite's CDN in visitors'
    browsers.
