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

### 1.4 Get a long-lived Page access token and the IDs

1. Open the **Graph API Explorer**
   (https://developers.facebook.com/tools/explorer/). Pick your app, click
   **Generate Access Token**, and approve the permissions above. Make sure
   you tick the Cork Vegans Page and Instagram account when asked.
2. Exchange that short-lived token for a **long-lived user token** (about 60
   days). In the Explorer, or in a browser, call:
   ```
   https://graph.facebook.com/v26.0/oauth/access_token?grant_type=fb_exchange_token&client_id=APP_ID&client_secret=APP_SECRET&fb_exchange_token=SHORT_LIVED_TOKEN
   ```
   The **App ID** and **App secret** are under the app's **Settings → Basic**.
   Copy `access_token` from the response.
3. Use the long-lived user token to list your Pages:
   ```
   https://graph.facebook.com/v26.0/me/accounts?access_token=LONG_LIVED_USER_TOKEN
   ```
   Find Cork Vegans in the list. Its `id` is the **Page ID**, and its
   `access_token` is the **Page access token**. A Page token made this way
   **doesn't expire**.
4. Find the Instagram account's ID:
   ```
   https://graph.facebook.com/v26.0/PAGE_ID?fields=instagram_business_account&access_token=PAGE_ACCESS_TOKEN
   ```
   The `id` inside `instagram_business_account` is the **Instagram user ID**.
   It's a long number, not the @handle.
5. Optional: paste the Page token into the **Access Token Debugger**
   (https://developers.facebook.com/tools/debug/accesstoken/) to check its
   permissions and that **Expires** says **Never**.

Treat the tokens and the App secret like passwords. Don't paste them into
chat, email or the repository; they only go into GitHub (section 2).

**If posting stops working** with an error about the token (e.g. after
someone changes their Facebook password, loses their role on the Page, or
removes the app), repeat step 1.4 and update the secret.

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
| Record of posts | `data/social-posted.json` |

The Meta Graph API version is set once, in `scripts/post-social.ts`
(`GRAPH_VERSION`, currently `v26.0`). Meta supports each version for about
two years; update it when Meta announces the current one is ending.
