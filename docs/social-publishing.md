# Sharing stories: RSS feed, Facebook and Instagram

Every published story is automatically:

- added to the **RSS feed** at `https://corkvegans.ie/stories/feed.xml`, for
  feed readers and RSS-to-email tools (Buttondown, MailerLite, Mailchimp);
- given two cropped images at fixed addresses:
  - `/stories/<story>/share-1200x630.jpg`, used for link previews, Facebook
    and email;
  - `/stories/<story>/instagram-1080x1350.jpg`, a 4:5 crop for Instagram.

Stories are posted to the **Facebook Page** and **Instagram** only when an
editor adds the **"Post to Facebook and Instagram"** section to the story, and
each platform gets a story only once.

Setting up Facebook and Instagram posting is a one-off job for an
administrator (section 1). After that, editors just tick a box (section 3).

---

## 1. One-off Meta setup

You need to be an admin of the Cork Vegans Facebook Page, with access to the
Instagram account.

### 1.1 Make Instagram a professional account and link it to the Page

1. In the Instagram app: **Settings → Account type and tools → Switch to
   professional account**. Choose **Business** (Creator also works).
2. Link it to the Facebook Page. In Facebook, open the Page → **Settings →
   Linked accounts → Instagram** and connect it. Meta sometimes moves this
   into **Accounts Centre**; either is fine.

Instagram only allows automatic posting from a professional account that's
linked to a Facebook Page.

### 1.2 Create a Meta app

1. Go to **https://developers.facebook.com** → **My Apps → Create app**.
   Sign in with the Facebook account that manages the Page.
2. Name it something like *Cork Vegans website*. When asked what it's for,
   choose the options for managing a **Page** and **Instagram content**. If
   it asks for an app type, choose **Business**.
3. Add the **Facebook Login** product if it isn't already there.

The app only acts on the Cork Vegans Page, for people who have a role on
the app (you). For that, Meta doesn't normally require **App Review**. If
it asks, follow its prompts.

### 1.3 Permissions the token needs

| Permission | Why |
| --- | --- |
| `pages_show_list` | To find the Page |
| `pages_read_engagement` | To read the Page and its linked Instagram account |
| `pages_manage_posts` | To post to the Page |
| `instagram_basic` | To read the Instagram account |
| `instagram_content_publish` | To publish to Instagram |
| `business_management` | Only if the Page is owned by a Meta Business account |

### 1.4 Get a Page access token from a system user

The website posts with a token belonging to a **system user**: a robot
account in the Cork Vegans Meta Business portfolio, not a person. Its token
never expires and isn't affected by anyone's password changes, security
checks or logins. (A token made from a personal Facebook account stops
working whenever any of those happen, and Meta also expires its data access
every 90 days.)

The current setup, made on 22 October 2026:

| | |
| --- | --- |
| Business portfolio | Cork Vegans (ID 156729148686489) |
| System user | **WebsitePublisher** (Employee) |
| Its assets | Cork Vegans Page and the corkvegans Instagram account (Content, Community activity, Insights); **Cork Vegans Publisher** app (full access) |

**To set it up again, or make a new token:**

1. Go to **https://business.facebook.com/settings** → **Users → System
   users**. You need full control of the portfolio. To create a new system
   user, click **Add** and choose the **Employee** role. Meta rejects some
   names without saying why; one word with no spaces, like
   `WebsitePublisher`, works.
2. Click the system user → **Assign assets**:
   - **Pages** → Cork Vegans → Content, Community activity, Insights
   - **Instagram accounts** → corkvegans → the same (Instagram asks you to
     log in separately)
   - **Apps** → Cork Vegans Publisher → full access

   If the Instagram account or the app isn't listed, add it to the portfolio
   first under **Accounts → Instagram accounts** or **Accounts → Apps →
   Connect an app ID** (`1640539060772695`).
3. Click **Generate token**. Choose the Cork Vegans Publisher app, set
   **Token expiration** to **Never**, and tick the permissions from 1.3
   (`business_management` isn't needed). Copy the token: Meta shows it only
   once.
4. That's a *user* token, but Facebook only accepts Page posts made with a
   *Page* token. Open the **Graph API Explorer**
   (https://developers.facebook.com/tools/explorer/), paste the token into
   the **Access Token** box, run `me/accounts`, and copy the `access_token`
   from the Cork Vegans entry. That's the **Page access token**.
5. Check it in the **Access Token Debugger**
   (https://developers.facebook.com/tools/debug/accesstoken/):
   - **Type:** Page, and **Page ID:** Cork Vegans
   - **App-Scoped User ID:** WebsitePublisher, not a person
   - **Expires** and **Data Access Expires:** Never

Treat tokens like passwords. Don't paste them into chat, email or the
repository; they only go into GitHub (section 2).

**First-time setup only:** you'll also need the IDs. The **Page ID** is shown
in the debugger. For the **Instagram user ID**, run
`PAGE_ID?fields=instagram_business_account` in the Explorer with the Page
token; it's the `id` inside `instagram_business_account` (a long number, not
the @handle). When renewing, the IDs don't change, so only update
`META_PAGE_ACCESS_TOKEN`.

### 1.5 When posting stops working

The "Post stories to social media" run fails, and the error mentions the
token or permissions, for example *"Any of the pages_read_engagement, …
permission(s) must be granted before impersonating a user's page"*.

A system user token is only cancelled if the system user is deleted or loses
its assets, or the app is removed from the portfolio. Check those in
Business settings first. (Before 22 October 2026 the token came from a
personal account, and a Facebook security check cancelled it.)

To fix it:

1. Make a new Page token (1.4, steps 3–5), after re-assigning any missing
   assets (step 2).
2. Update `META_PAGE_ACCESS_TOKEN` in GitHub (section 2: click the pencil
   next to the secret).
3. Go to **Actions → Post stories to social media → Run workflow**, untick
   **Dry run**, and run it. Stories that failed get posted. Stories already
   posted are skipped.

If the Explorer only shows "Sorry, something went wrong", log out of
Facebook and back in, complete any security checks it asks for, and try
again in a private window.

**The weekly token check.** Every Monday morning, **Actions → Check social
media token** checks the token without posting anything. It checks that the
token can read the Page and the Instagram account, that it's a Page token
with the permissions from 1.3, and that it isn't expiring within 30 days.
If anything's wrong, the run fails and GitHub emails you, usually before a
story is affected. The run's summary says what's wrong; fix it as above, then
re-run the check (**Run workflow**) to confirm.

GitHub pauses scheduled checks in a repository with no commits for 60 days.
Any story added in Pages CMS counts as a commit. If the check is paused,
Actions shows a banner with a button to turn it back on.

---

## 2. GitHub secrets

GitHub → the `corkvegans` repository → **Settings → Secrets and variables →
Actions → Secrets** tab → **New repository secret**. Add these three:

| Name | Value |
| --- | --- |
| `META_PAGE_ID` | The Page ID (step 1.4.3) |
| `META_IG_USER_ID` | The Instagram user ID (step 1.4.4) |
| `META_PAGE_ACCESS_TOKEN` | The Page access token (step 1.4.3) |

Until these are set, the posting workflow does nothing, unless a story is
ticked. Then it fails with a clear "missing secrets" message.

---

## 3. Posting a story to Facebook and Instagram (editors)

At the bottom of the story form, below the story text, there's a section
called **Post to Facebook and Instagram**. It's empty unless you click
**Add**, and **adding it is what tells the website to post the story**.
Remove it (before publishing) and the story isn't posted.

Once added, it has three optional fields:

| Field | What it does |
| --- | --- |
| **Post text** | 1–3 sentences for the Facebook post and the email newsletter. Plain text, no links. If empty, the story's short summary is used. |
| **Instagram caption** | Your own Instagram text. If empty, the post text is used. *"Full story at the link in our bio."* is always added at the end. |
| **Different photo** | A different photo for Facebook, Instagram and email. If empty, the featured image is used. |

Further up, next to the featured image, **Keep which part of the photo when
cropping?** applies to every shared image: Top, Centre or Bottom keeps that
part in view (the crops are wide for Facebook and tall for Instagram).
**Whole photo** fits the entire image on a green border instead. Use it for
screenshots, flyers or anything with text.

**To post a story:**

1. Write it as usual, with a featured photo (required).
2. Under **Post to Facebook and Instagram**, click **Add** and fill in the
   fields if you like.
3. Untick **Draft** at the top of the form, and save.

About 2–3 minutes later the website updates. Straight after that, the story
is posted:

- **Facebook:** the summary, plus a link to the story. Facebook builds the
  preview card from the story's photo and title.
- **Instagram:** the tall crop of the photo, with the caption.

Each story is posted **once**. Editing it afterwards won't post it again,
and removing the section afterwards doesn't delete the posts. Delete those
on Facebook or Instagram directly.

**Ask an organiser before ticking the box**, and double-check the photo and
spelling first. Once it's posted, it's posted.

---

## 4. Checking what happened, and dry runs

Every run appears on GitHub under **Actions → Post stories to social
media**, with a summary table: posted ✅, failed ❌, or waiting ⏳.

Posts are recorded in `data/social-posted.json` (story → post IDs and
times). That record is how a story is never posted twice. Don't edit it,
unless you deliberately want a story posted again: remove its entry.

### Reposting a story (e.g. it went out with the wrong photo)

1. Delete the post on Facebook or Instagram.
2. On GitHub, open `data/social-posted.json` → pencil icon → delete that
   platform's entry for the story, e.g. the `"instagram": { … }` block
   under `"hello-world"` (keep the commas and brackets valid). Commit the
   change.
3. That commit deploys the site, and the next run posts the story again on
   that platform only, with whatever the story has now.

### When a post fails

If one platform fails (e.g. Instagram), the other's post is still recorded,
and the next run retries **only** the failed platform. Runs happen after
every deploy, at least every 6 hours. The error message in the run
explains what went wrong.

### Dry run: see what would be posted, without posting

1. GitHub → **Actions → Post stories to social media → Run workflow**.
2. Leave **Dry run** ticked (the default).
3. Optionally, type a story's file name (without `.md`, e.g. `hello-world`)
   in the second box. That previews it even if it isn't ticked. This only
   works in a dry run.
4. Click **Run workflow** and open the run to read the output: the exact
   Facebook message and link, and the Instagram image and caption.

Nothing is sent to Meta and nothing is recorded in a dry run.

On a computer with the repository, you can do the same with:

```
DRY_RUN=true FORCE=hello-world node scripts/post-social.ts
```

---

## 5. The newsletter (RSS to email)

Point your email tool's "RSS campaign" or "RSS to email" feature at:

```
https://corkvegans.ie/stories/feed.xml
```

Each item has the story's title, link, date, sharing summary and the
1200 × 630 image (as both `enclosure` and `media:content`, so Buttondown,
MailerLite and Mailchimp can all show it). The feed lists the 20 most recent
stories.

---

## How it fits together (for developers)

| Part | File |
| --- | --- |
| CMS fields | `.pages.yml` (the `social` section, `imageFocus`) |
| Fallbacks (summary, image, focus) | `src/lib/stories.ts` |
| Crops (sharp) | `src/lib/social-images.ts`, `src/pages/stories/[slug]/*.jpg.ts` |
| RSS feed | `src/lib/feed.ts`, `src/pages/stories/feed.xml.ts` |
| Posting | `scripts/post-social.ts`, `.github/workflows/social.yml` |
| Weekly token check | `scripts/check-social-token.ts`, `.github/workflows/social-token-check.yml` |
| Record of posts | `data/social-posted.json` |

The Meta Graph API version is set once, in `scripts/post-social.ts`
(`GRAPH_VERSION`, currently `v26.0`). Meta supports each version for about
two years; update it when Meta announces the current one is ending.
