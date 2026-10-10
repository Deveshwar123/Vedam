# Vedam — Security & Hardening Checklist

Findings from the 2026-08-09 review, most serious first. Items marked
**[owner action]** can only be done in a console (Firebase / Google Cloud /
Apps Script) — they are not code in this repo and cannot be fixed by a commit.

---

## S1 — Firestore rules are the whole access-control model **[owner action]**

`admin.html` grants owner access purely by whether reading the `users`
collection succeeds, so everything rests on the Firestore rules — which are not
in the repo and so could not be verified from code alone.

**RESOLVED — verified 2026-08-10.** The deployed rules were read directly in the
Firebase console and are **already correctly locked down** (deployed 2026-07-16):
`carts/{uid}` and `users/{uid}` allow read/write only when
`request.auth.uid == uid` (owner reads all via `isOwner()`), `inquiryStatus` is
owner-only, and `isOwner()` pins the owner uids (by uid, not email). No
permissive hole exists in production. See VEDAM-3 in `BUGS.md`.

**Optional hardening (not required):** the repo's [`firestore.rules`](./firestore.rules)
is an equivalent reference that additionally restricts which fields a shopper
may write to their own doc via `hasOnly(['items','updated'])` /
`hasOnly(['email','name','lastSeen','created'])`. To adopt it: replace the UID
placeholder with the real owner uid(s), paste into Firestore → Rules → Publish,
and confirm in the Rules Playground that a shopper can `get` their own cart but
not another's, and cannot `list` the collection.

## S2 — Inquiry access token travels in the URL **[owner action + code]**

`admin.html` fetches inquiries as `INQ_URL + "?token=" + token`. Query strings
leak via `Referer` headers, browser history, and Apps Script execution logs.

**Fix:** change the Apps Script `doGet` to read the token from a header or a
`POST` body, rotate the token, and update the fetch in `admin.html`. (The
`doGet` script is not in this repo — it lives in the Apps Script project.)

## S3 — Book-a-fitting endpoint is open to anyone **[owner action + code]**

`fittings-apps-script.gs` deploys with *"Who has access: Anyone"* and takes no
shared secret, honeypot, or rate limit → open spam funnel into the Sheet.

**Fix:** add a shared-secret parameter checked server-side, a hidden honeypot
field, and consider Cloudflare Turnstile. (Also see VEDAM-4: the form is not
even wired up yet.)

## S4 — No email verification on signup **[code]**

`login.html` calls `createUserWithEmailAndPassword` with no
`sendEmailVerification`. Anyone can register under any email, verified or not.

**Fix:** send a verification email on signup; optionally gate reservation on a
verified email. (Do **not** add `email_verified` to the Firestore rules until
existing accounts are migrated, or you will lock them out.)

## S5 — Firebase browser API key is unrestricted **[owner action]**

The key `AIzaSyCxZ4K17JB8ZQtcF9kD-X8HOi1XKwbKFU8` is public by design, but it is
not domain-restricted.

**Fix:** Google Cloud console → APIs & Services → Credentials → this key → set
**Application restrictions → HTTP referrers** → `deveshwar123.github.io/*`.

## S6 — Owner dashboard trusts client-sent prices **[code]**

`admin.html` computes cart value as `it.price || PRICE[it.id]`, preferring the
price the client wrote into its own cart doc. No financial impact (reservation
model), but a customer can skew the owner's dashboard totals.

**Fix:** prefer the server-side catalog: `PRICE[it.id] ?? it.price`.

## S7 — No Content-Security-Policy / Subresource-Integrity **[code]**

Low risk (imports are from Google's gstatic), but a strict CSP `<meta>` and
`crossorigin` on the module imports are cheap hardening.

---

## Waitlist — how subscriber data is protected *(added 2026-10-10)*

The waitlist collects names, emails and phone numbers, so it was built to keep
that data in as few places as possible.

**Where it lives.** One Google Sheet, owned by the Vedam Google account.
Subscriber details are never written to Firestore, never kept in a visitor's
browser, and never rendered on a public page. The waitlist page remembers only
a flag that *somebody* joined on that device — no name, no email, no number.

**What the public endpoint will answer.** `?action=config` returns the launch
date and the collection link, and nothing else — not a name, not a count. Every
read of the list is a `POST` that requires the admin token. There is
deliberately no JSONP callback, which would have let any third-party page read
the endpoint through a `<script>` tag.

**Two locks on the owner portal.** `admin.html` is a public URL — anyone can
load the page — so neither lock is in the page:

1. *Firebase sign-in + Firestore rules.* The portal renders only for a uid the
   rules recognise as an owner (the existing `users` probe, S1 above).
2. *The admin token*, held in Firestore at `ownerSecrets/waitlist`, which the
   rules open to the owner uid alone.

So reaching the subscriber list needs the owner's Firebase password. The token
is **not** in the repo, **not** in a URL (it travels in the POST body, unlike
the inquiries token in S2) and **not** in `localStorage`. If the `ownerSecrets`
rule has not been published, the portal falls back to holding the token in
memory for that visit only — never writing it to the device.

**Unsubscribe links** are signed with an HMAC of the address, so one subscriber
cannot unsubscribe another by editing the link.

**Spam.** The form carries an off-screen honeypot, server-side length limits, a
per-email duplicate check, and an optional `JOIN_SECRET`. That secret lives in
a public file and is documented as a speed bump, not a secret — it is the S3
shared-secret idea applied honestly. For real abuse, put Cloudflare Turnstile
in front of the form.

**Irreversible actions ask twice.** Sending the launch announcement or a
campaign needs the word SEND typed into a confirmation box. Emails cannot be
unsent.

**Remaining owner actions:**

- Publish the `ownerSecrets` block from `firestore.rules` (Firebase → Rules).
- Keep `ADMIN_TOKEN`, `UNSUB_SECRET` and any `RESEND_API_KEY` in Apps Script
  **Script Properties** — never in the repo. Rotate `ADMIN_TOKEN` by editing
  that property; the portal will ask for the new one once.
- S5 still applies and now matters a little more: restrict the Firebase browser
  API key to `deveshwar123.github.io/*`.

---

See [`BUGS.md`](./BUGS.md) for the tracked tickets (VEDAM-3 … VEDAM-11).
