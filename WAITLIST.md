# Vedam — Waitlist & Launch

The house is closed until the launch date: every page sends visitors to
`waitlist.html`, where they can join the list and watch the countdown. On the
day, the site opens by itself and everyone on the list is emailed once.

Nothing has to be pushed, redeployed or clicked on the day.

---

## What was added

| File | What it does |
|---|---|
| `waitlist.html` | The waitlist page — countdown, sign-up form, and the "house is open" state it switches to at launch. |
| `launch-config.js` | **The one file to edit.** Launch date, backend URL, collection link, gate mode. |
| `vedam-gate.js` | Runs in every page's `<head>` before anything paints, and sends visitors to the waitlist while the house is closed. |
| `vedam-launch.js` | Resolves the launch date (server value beats the file), adds the Waitlist nav link and the countdown bar, flips the site to launch mode on the day. |
| `vedam-waitlist.js` | The waitlist page itself: countdown, validation, signup, the launch switch. |
| `waitlist-apps-script.gs` | The backend. Sheet storage, confirmation email, launch email, campaigns, unsubscribe. Lives in Apps Script, not on GitHub Pages. |
| `admin.html` | Gained a **Waitlist & launch** section: subscribers, totals, CSV export, campaigns, launch date, delivery status. |
| `firestore.rules` | Gained `ownerSecrets` — an owner-only document that holds the admin token. |

The eleven existing pages each gained **two script tags and nothing else**
(`git show --stat` will confirm: one changed line per page).

---

## Setup, in order

### 1. Deploy the backend (~10 min, once)

1. Create a Google Sheet called **Vedam Waitlist**.
2. **Extensions → Apps Script**, delete the sample, paste `waitlist-apps-script.gs`, save.
3. Run **`setupVedamWaitlist`** once and authorize it. It creates the sheets,
   generates the admin token and the unsubscribe secret, and installs the
   15-minute trigger that sends the launch email.
4. **Copy the ADMIN TOKEN from the execution log.** It is shown once; if it
   scrolls away, open Project Settings → Script Properties and read `ADMIN_TOKEN`.
5. **Deploy → New deployment → Web app**: *Execute as* **Me**, *Who has access*
   **Anyone**. Copy the `/exec` URL.

### 2. Point the site at it

In `launch-config.js`, set `endpoint` to that `/exec` URL. Commit and push.
GitHub Pages redeploys in about a minute.

### 3. Publish the Firestore rule

Firebase console → Firestore → Rules. Add the `ownerSecrets` block from
`firestore.rules` and **Publish**. Without it the owner portal still works, but
the admin token has to be pasted on every visit.

### 4. Connect the owner portal

Open `admin.html`, sign in as owner, paste the admin token once under
**Waitlist & launch → Connect the waitlist**. It is stored for the owner
account, so no other device will ask again.

### 5. Set the launch date

Owner portal → **Launch date** → pick the date and time → *Save launch date*.
Your own timezone is used, and stored as an exact instant, so the countdown
reads the same everywhere in the world.

You can also set it in `launch-config.js` and push. If both exist, the portal's
value wins.

---

## How launch day works

1. The instant passes. Every page stops redirecting; the site is open.
2. Within 15 minutes the trigger sends the announcement to everyone on the
   list, in batches, and marks each person as sent.
3. Anyone whose email failed, or who was skipped because the daily quota ran
   out, is picked up by the next run. **Nobody is emailed twice** — the mark on
   their row, not the timing, is what guarantees it.

To open early, use **Send launch announcement now** in the portal. It asks you
to type SEND, because it cannot be undone.

---

## Sending emails later

Owner portal → **Email the list**. Write a subject and plain paragraphs; the
letterhead, the greeting and the unsubscribe link are added for you. *Send a
test to me* first — it goes to the address you signed in with.

Large lists send in the background over several trigger runs, so closing the
portal does not stop a campaign.

**Sending limits.** With no Resend key configured, mail goes out through the
Gmail account that owns the script: about **100 recipients a day** on a
consumer account, 1,500 on Workspace. The portal shows how many are left today.
Past that, add `RESEND_API_KEY` and `MAIL_FROM` to the Script Properties and
the same code sends through Resend instead — no change to the site.

---

## Switching the gate off

`launch-config.js` → `preLaunchMode`:

- `'gate'` *(default)* — the house is closed; everything redirects to the waitlist.
- `'bar'` — the site stays browsable with a countdown bar at the foot of each page.

Always reachable either way: the waitlist, the policies page and the owner
portal. To look at the real site while the gate is up, add `?preview=1` to any
page — it lasts for that browser tab.

**What the gate is not:** it hides the site, it does not lock it. Every page on
a GitHub Pages site is a public file, so anyone who turns JavaScript off or
reads the page source can still reach the markup. If the collection must be
genuinely unreachable before launch, keep those pages out of the published
branch until the day.

---

## Where the data lives

Names, emails and phone numbers are **only** in the Vedam Waitlist Google
Sheet. They are never written to Firestore, never stored in a visitor's
browser, and never rendered on any public page. The only thing the public
endpoint will answer is the launch date and the collection link.

See `SECURITY.md` → *Waitlist* for the full picture.
