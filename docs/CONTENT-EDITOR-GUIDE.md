# Cork Vegans — Story Editor Guide

This guide is for Cork Vegans team members who write and publish stories on
**corkvegans.ie/stories/**. You don't need any technical knowledge.

---

## 1. Getting access

1. An administrator invites you using your email address.
2. You'll receive an email from **Pages CMS**. Click the link in it.
3. Go to **https://app.pagescms.org** and sign in:
   - If you have a GitHub account, you can choose **Sign in with GitHub**.
   - Otherwise, enter the email address you were invited with and click the
     sign-in link that is emailed to you.
4. Choose the **corkvegans** project.

Bookmark **https://app.pagescms.org**. That's the only address you need.

> **Can't get in?** Sign-in links expire after a short time, so request a new
> one. If that doesn't work, ask an administrator to check your invitation.
> They can remove and re-invite you in a minute.

---

## 2. Writing a new story

1. Click **Stories** in the left-hand menu.
2. Click the button to add a new entry (top right of the list).
3. Fill in the form:

| Field | What to put |
| --- | --- |
| **Draft** (at the top) | Ticked = hidden from the website. **Untick it to publish.** |
| **Title** | The headline, e.g. *"Our autumn potluck at the Quay Co-op"*. |
| **Short summary** | One or two sentences. This appears on the story card **and** in the preview when someone shares the link on WhatsApp, Facebook, etc. |
| **Category** | Community, News, Reviews, Events, Guides or Stories. Readers can filter the Stories page by category, so pick the closest match. |
| **Author** | Your name, or leave it as *Cork Vegans*. |
| **Publish date** | The date shown on the story. |
| **Last updated** | Leave empty, unless you make a big change to a story that's already published. |
| **Featured image** | The main photo (see section 3). Required. |
| **Image description** | A short description of the photo for people who can't see it, e.g. *"Six people laughing around a table of vegan dishes"*. Required. |
| **Keep which part of the photo when cropping?** | Which part stays in view when the photo is cropped for link previews and social media (see section 3). |
| **Story** | The story itself (see section 4). |
| **Post to Facebook and Instagram** (at the bottom) | Optional. Click **Add** to also post the story to our Facebook and Instagram (see section 9). |

4. Click **Save**.

The **web address** of the story is created from the title the first time
you save, e.g. `corkvegans.ie/stories/our-autumn-potluck-at-the-quay-co-op/`.
It **doesn't change** if you later edit the title, so links that people have
shared keep working. If a story needs a different address, ask an
administrator.

---

## 3. Images

- Every story needs a **featured photo** and a short description of it.
- Use **landscape** photos. **1200 × 630 pixels or larger** is ideal.
- Keep the important part (faces, the food) **near the centre**. Social media
  previews crop the edges; if the key part is near the top or bottom, set
  **"Keep which part of the photo when cropping?"** to match.
- JPG, PNG or WebP files only. Photos straight from a phone are fine: the
  website automatically resizes and compresses them.
- Only upload photos you have permission to use. Ask people before posting
  clear photos of them.
- Always fill in the **Image description**.

To upload, click the featured image box (or the image button in the story
editor) and choose **Upload**. Uploaded images are also listed under
**Media → Story images** in the left-hand menu, where you can reuse them.

> ⚠️ Don't delete an image from Media while a story still uses it. The story
> will still work, but the photo will disappear from it.

---

## 4. Writing the story text

The story editor works like a simple word processor. Use the toolbar for:

- **Headings**: use them to break up long stories. The title is already the
  main heading, so start with the second level.
- **Bold**, *italic*, bulleted and numbered lists
- **Links**: select text, click the link button and paste the address
- **Quotes**: for something someone said
- **Images**: upload or choose a photo; write a description when asked

Keep paragraphs short. They're easier to read on a phone.

---

## 5. Saving drafts and publishing

- **Draft ticked** + Save → your work is saved but **not** on the website.
  You and other editors can keep working on it.
- **Draft unticked** + Save → the story is **published**. It appears on the
  website about **2–3 minutes** later. Refresh
  `corkvegans.ie/stories/` to check.

New stories start as drafts, so nothing goes live by accident.

**Guest contributors** (people invited to write one story) leave Draft
ticked and tell an organiser when it's ready. An organiser reviews it and
publishes. Guests have their own short guide: `docs/CONTRIBUTOR-QUICKSTART.md`.

> **Important: drafts are not private.** The website's files are stored in a
> public GitHub repository, so anyone who knows where to look can read a
> draft there. Don't put anything confidential in a story, even in a draft.

**Previewing:** the editor shows your formatting as you type. There is no
separate "preview of the finished page" before publishing. If you want to
see it on the real site, publish it, check it, and tick Draft again if it
needs more work. It will disappear again within a few minutes.

**Scheduling** for a future date isn't supported. Publish the story when you
want it to go live.

---

## 6. Editing, unpublishing and deleting

- **Edit:** open **Stories**, click the story, make changes, **Save**. The
  website updates in 2–3 minutes.
- **Unpublish (hide):** tick **Draft** and **Save**. The story is removed
  from the website but kept in the CMS.
- **Delete:** in the Stories list, use the story's menu and choose **Delete**. This
  removes it from the CMS and the website. An administrator can still recover
  it from the history if needed.

---

## 7. How link previews work

When someone shares a story link on WhatsApp, Facebook, LinkedIn, Slack or
Discord, the preview shows:

- the story **Title**
- the **Short summary**
- the **Featured image**, cropped to a wide 1200 × 630 rectangle. If there's
  no featured image, the Cork Vegans logo image is used instead.

Each story page has **Share** buttons (WhatsApp, Facebook, LinkedIn, Email,
Copy link) for readers.

> Social networks remember previews for a while. If you change the image or
> summary after the link has already been shared, old previews may not update
> straight away. Facebook's *Sharing Debugger*
> (developers.facebook.com/tools/debug) can refresh it.

---

## 8. Fixing mistakes

| Problem | What to do |
| --- | --- |
| Published something by accident | Tick **Draft**, **Save**. It's gone from the site in a few minutes. |
| Typo in a published story | Fix it and **Save**. |
| Deleted a story by mistake | Ask an administrator. Every change is kept in the history and can be restored. |
| Story doesn't appear after 5 minutes | Check **Draft** is unticked and **Title**, **Short summary** and **Publish date** are filled in. If it still doesn't show, tell an administrator. The build log will say why. |
| Shared preview shows the wrong picture | See section 7. |

Every save is recorded with your name, so nothing is ever truly lost.

---

## 9. Sharing on Facebook, Instagram and the newsletter

Every published story goes into the newsletter feed automatically.

To also post it to **Facebook and Instagram**, click **Add** under **Post to
Facebook and Instagram** at the bottom of the form. That reveals optional
fields for the post text, an Instagram caption and a different photo; leave
them empty and sensible defaults are used. Adding the section is what makes
the story post (once, when it's published), so please check with an
organiser first. Full details: `docs/social-publishing.md`, section 3.
