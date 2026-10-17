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
  icons), the Resources page links, donation URLs and the form endpoint.

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
requests, because that would stop Pages CMS from saving.

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

### 2.6 Donations (**requires owner setup**)

No donation provider was found in the old site, its Linktree or elsewhere,
so donation buttons currently show **"Coming soon"**.

1. Choose a provider that offers **hosted checkout pages** for both one-off
   and monthly gifts. Options include Stripe Payment Links, PayPal, Ko-fi
   and Buy Me a Coffee. Cork Vegans must own the account.
2. Create two links: a one-off donation (ideally "customer chooses amount")
   and a monthly subscription.
3. Edit `src/config/site.ts`:

   ```ts
   export const donations = fixtures ? { … } : {
       providerName: "Stripe",
       oneOffUrl: "https://donate.stripe.com/…",
       monthlyUrl: "https://donate.stripe.com/…",
   };
   ```

4. Commit to `main`. The buttons go live after the deploy.

Card details are only ever entered on the provider's own site.

**Support page wording.** The "Donations help us with things like…" list
and the intro text in `src/pages/support/index.astro` are a starting
point. Organisers should confirm they're accurate before relying on them.
The page deliberately makes no claim about charity status or tax relief.
Only add those if they've been verified.

### 2.7 Volunteer form (**requires owner setup**)

Until this is done, the form shows "Online volunteer sign-up isn't open yet"
and can't be submitted.

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
to the outer edges (the wide margins on desktop). Spots with the same `zone`
count as one place. The colour adapts to the surface (`tone`). Remove the attribute
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
  settings, donation links or code. There are no finer-grained roles: every
  editor can edit every story.
- **Who changed what:** every save is a commit with the editor's name
  (`settings.commit.identity: user`). See GitHub → repository → Commits, or
  the history of a file in `src/content/stories/`.

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
npm run dev:fixtures   # with example stories and test form/donation links
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
| Donation provider | Usually free to set up; the provider charges per-transaction fees. |

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
