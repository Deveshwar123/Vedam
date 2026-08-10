# Vedam — Bug Log

Every bug gets a ticket here: opened when found, closed when fixed and verified,
always with the commit that fixed it. Newest first.

Status: `OPEN` · `IN PROGRESS` · `CLOSED`

---

## VEDAM-3 — Firestore rules are the entire access-control model

| | |
|---|---|
| **Status** | CLOSED (verified secure in production) |
| **Opened** | 2026-08-09 |
| **Closed** | 2026-08-10 |
| **Reported by** | Security review |
| **Severity** | Critical *if* permissive — **verified NOT permissive** |
| **Pages** | admin.html, login.html (Firestore) |

`admin.html` decides owner access solely by whether a read of the `users`
collection succeeds, so everything rests on the Firestore rules — which are not
in the repo and so could not be verified from code alone.

**Verified 2026-08-10** by reading the deployed rules directly in the Firebase
console. They were **already correctly locked down** (deployed 2026-07-16):

- `carts/{uid}` and `users/{uid}`: `allow read, write: if request.auth.uid == uid`
  (a shopper touches only their own doc); `allow read: if isOwner()` (owner
  reads all). An unconstrained collection `list` by a shopper is denied.
- `inquiryStatus/{id}`: `isOwner()` only.
- `isOwner()` pins two UIDs (the `owner@…` account and the personal owner
  account) — access is by uid, not email, so a signup using an owner's email
  can't gain access. Unmatched paths are denied by Firestore default.

The critical hole does **not** exist in production. `firestore.rules` in this
repo is kept as an equivalent reference that adds one optional hardening the
live rules lack: `hasOnly([...])` to restrict which fields a shopper may write
to their own `carts`/`users` doc. Adopting it is optional; the live rules are
secure without it. The repo file keeps a UID placeholder rather than committing
the real owner UIDs to a public repo.

---

## VEDAM-4 — Book-a-fitting form is dead (placeholder endpoint)

| | |
|---|---|
| **Status** | OPEN |
| **Opened** | 2026-08-09 |
| **Reported by** | Security review |
| **Severity** | High — the primary CTA on book-a-fitting.html does nothing |
| **Pages** | book-a-fitting.html |

The form still posts to the literal string `PASTE_FITTING_SHEET_WEB_APP_URL`
(both occurrences). Needs a real Apps Script Web App deployment URL. Blocked on
the owner creating/providing that deployment (`fittings-apps-script.gs` is the
server side and is ready to deploy).

---

## VEDAM-5 — Inquiry access token is passed in the URL

| | |
|---|---|
| **Status** | OPEN |
| **Opened** | 2026-08-09 |
| **Reported by** | Security review |
| **Severity** | Medium — token leaks via Referer, history, and Apps Script logs |
| **Pages** | admin.html + Apps Script `doGet` (not in repo) |

`fetch(INQ_URL + "?token=" + token)`. Move the token to a header or POST body,
rotate it. See `SECURITY.md` S2.

---

## VEDAM-6 — Book-a-fitting endpoint open to anyone, no anti-abuse

| | |
|---|---|
| **Status** | OPEN |
| **Opened** | 2026-08-09 |
| **Reported by** | Security review |
| **Severity** | Medium — open spam funnel into the Sheet |
| **Pages** | fittings-apps-script.gs |

`doPost` accepts any request with no shared secret, honeypot, or rate limit.
See `SECURITY.md` S3.

---

## VEDAM-7 — No email verification on signup

| | |
|---|---|
| **Status** | IN PROGRESS |
| **Opened** | 2026-08-09 |
| **Reported by** | Security review |
| **Severity** | Medium — anyone can register under any email |
| **Fixed in** | `0b2ab78` (code) |
| **Pages** | login.html |

`createUserWithEmailAndPassword` with no `sendEmailVerification`. Fixed in code:
`signUp` now calls `sendEmailVerification(cred.user)` (best-effort, does not
block signup). Closes once a real signup is confirmed to receive the email;
gating reservation on a verified email is optional future hardening (do not add
`email_verified` to the Firestore rules until existing accounts are migrated).
See `SECURITY.md` S4.

---

## VEDAM-8 — Firebase browser API key is unrestricted

| | |
|---|---|
| **Status** | OPEN |
| **Opened** | 2026-08-09 |
| **Reported by** | Security review |
| **Severity** | Low — key/quota abuse from other origins |
| **Pages** | all (Firebase config) |

Restrict the key to `deveshwar123.github.io/*` (HTTP-referrer restriction) in
the Google Cloud console. See `SECURITY.md` S5.

---

## VEDAM-9 — Accessibility gaps: alt text, contrast, ARIA (HIG polish)

| | |
|---|---|
| **Status** | IN PROGRESS |
| **Opened** | 2026-08-09 |
| **Reported by** | UI/UX (Apple HIG) review |
| **Severity** | Medium — product imagery invisible to screen readers/SEO; gold-on-cream likely fails 4.5:1 |
| **Partly fixed in** | `0b2ab78` |
| **Pages** | srngara.html, nizami-nights.html, manduva.html, collections.html, and others |

Product pieces render as CSS/base64 backgrounds with no text alternative;
several controls lack labels; the splash/pulsing-dots animation has no
`prefers-reduced-motion` guard; some touch targets fall under 44px.

**Done (`0b2ab78`):** `prefers-reduced-motion` guard, 44px minimum touch
targets, and visible `:focus-visible` outlines on all 11 bundled pages
(additive `#hig-overrides` block); on `admin.html` also WCAG-passing text
colors, `scope="col"`, and aria-labels.

**Done (`42e99dd`):** a full read-only WCAG audit of all 12 pages (foreground
resolved through `rgba` alpha onto real backgrounds, ratios computed). The only
real contrast failures were 10 semi-transparent maroon micro-labels
(`rgba(74,15,20,.5/.55/.6)`, ~3.1–4.2:1) on cream cards across book-a-fitting,
contact-us, login, cart, policies — now opaque `#6B4A41` (6.72:1). Cart's ± / −
quantity buttons were 32px wide → `min-width:44px`. Audit confirmed everything
else passes: the customer palette is a dark theme (gold/cream on maroon,
≥5.7:1), golds on cream are borders/fills, all `<img>` have alt, all form
inputs are `<label>`-wrapped. All verified via headless-render.

**Remaining (needs design judgment / real copy):** the transient "Click to
enter" splash prompt (4.15:1 on a moving gradient — raising its alpha touches
the fade aesthetic); optional per-piece text alternatives for the product
`<image-slot>` renders (the adjacent visible piece name already satisfies the
minimum); and the 8pt spacing / Georgia type-scale tightening.

---

## VEDAM-10 — Reserve flow loses context after login

| | |
|---|---|
| **Status** | IN PROGRESS |
| **Opened** | 2026-08-09 |
| **Reported by** | UX review |
| **Severity** | Medium — signed-out "Reserve Your Pieces" redirects to login with no return path |
| **Fixed in** | `002ab4b` |
| **Pages** | all 11 bundled pages (interceptor) + login.html (redirect) |

The reserve interceptor now appends `?return=<dest>` (default
`contact-us.html`), and the login component redirects there on successful
sign-in. The return value is validated against a whitelist of same-site page
filenames — no open-redirect. Every touched module was `node --check`'d and
headless-render confirmed. Closes once a live sign-in round-trip is confirmed
to land on the reservation step.

---

## VEDAM-11 — Policies page legally incomplete

| | |
|---|---|
| **Status** | OPEN |
| **Opened** | 2026-08-09 |
| **Reported by** | Review (owner runbook) |
| **Severity** | Low — India E-Commerce Rules 2020 compliance |
| **Pages** | policies.html |

Missing legal entity name, registered address, phone, and named grievance
officer; only the email is published. Needs a lawyer's once-over.

---

## VEDAM-2 — Cart says "Your cart is empty" while it is still loading

| | |
|---|---|
| **Status** | CLOSED |
| **Opened** | 2026-07-23 |
| **Closed** | 2026-07-23 |
| **Reported by** | Deveshwar |
| **Severity** | Medium — a signed-in visitor with a full cart is told their cart is empty |
| **Fixed in** | `f336390` |
| **Pages** | cart.html |

**Steps to reproduce**
1. Sign in and add pieces to the cart.
2. Open `cart.html` in a browser with no local cart cache (new device, cleared
   storage, or a hard reload).

**Expected:** an indication that the cart is being fetched.
**Actual:** *"Your cart is empty — no treasures yet"* for as long as Firebase
takes to answer (0.5–2.0s live), then the real cart pops in.

**Root cause**

The component only had two states: `hasItems` and `isEmpty`, both derived from
`items.length`. Firebase loads from gstatic and resolves the signed-in user
*after* the component mounts, so `items` is `[]` on first render for anyone
without a cached cart — and `[]` was read as "empty cart" rather than "not
fetched yet".

**Fix**

- Added `state.resolved`, set true when the `vedam-cart` event arrives or when
  `vedamFB.ready` settles, with an 8s ceiling so a gstatic outage falls through
  to the empty-cart message instead of spinning forever.
- New `isLoading` branch renders the house's loading mark — the same gold
  diamond divider and three pulsing dots the page splash uses on every page —
  above the words *Gathering your pieces*.
- `isEmpty` is now `!isLoading && items.length === 0`.
- A cached cart still renders instantly; the dots only appear when there is
  nothing to draw yet, so returning visitors see no spinner flash.

**Verification** (local server, Chrome)

| | before | after |
|---|---|---|
| Load with no cache, Firebase pending | "Your cart is empty" | dots + "Gathering your pieces" |
| Firebase never answers (module forced to throw) | "Your cart is empty" immediately | dots for 8s, then "Your cart is empty" |
| Load with cached items | items | items, no spinner flash |

---

## VEDAM-1 — Sign-in fails right after sign-out: "Still connecting to the house"

| | |
|---|---|
| **Status** | CLOSED |
| **Opened** | 2026-07-22 |
| **Closed** | 2026-07-22 |
| **Reported by** | Deveshwar |
| **Severity** | High — blocks sign-in, and leaves live sessions open after an apparent sign-out |
| **Fixed in** | `5477155` |
| **Pages** | login.html, cart.html, srngara.html, nizami-nights.html, manduva.html, index.html, collections.html, contact-us.html, our-story.html, policies.html, book-a-fitting.html |

**Steps to reproduce**
1. Sign in on `login.html`.
2. Add a piece to the cart from a collection page.
3. Return to `login.html` and click Sign Out.
4. Immediately sign in again.

**Expected:** sign-in proceeds.
**Actual:** *"Still connecting to the house — please try again in a moment."*

**Root cause**

`window.vedamFB` was assigned at the very end of the injected Firebase module,
behind a top-level `await setPersistence(auth, browserLocalPersistence)`. A
top-level await suspends the whole module, so nothing after it ran until
Firebase had finished initialising auth — which performs a network token
refresh whenever a session is stored. Every page was therefore fully rendered
and interactive before any auth existed.

In that window:
- `submit()` hit `if (!window.vedamFB)` — the only code path emitting that message;
- `doSignOut()` skipped Firebase entirely (`if (window.vedamFB)` guarded the
  call) while still clearing `vedamUserV1` and flipping the UI, so the visitor
  looked signed out with a live session that reappeared once the auth listener
  caught up.

Sign Out only exists on `login.html`, so the reported sequence forces a fresh
load of that page **while signed in** — the slowest case, squarely inside the window.

**Fix**
- `setPersistence` is no longer awaited at the top level; `window.vedamFB` is
  assigned as soon as the module evaluates, and a `vedam-fb-ready` event
  announces it.
- Components wait via `Component.whenFB()` (event + poll + 15s timeout) rather
  than reading a not-yet-loaded `window.vedamFB` as "not available". Sign-in
  shows *"One moment…"* and completes; sign-out can no longer be faked.
- Product pages no longer bounce signed-in visitors to login when Add to Cart
  is clicked before Firebase lands.
- Cart edits made during load no longer go to the legacy `vedamCartV1` guest
  key, where they were overwritten once the account's cloud cart arrived.

**Verification** (headless Chrome over CDP, against the live build)

| | before | after |
|---|---|---|
| Sign in before Firebase loads | dead end: *"Still connecting to the house"* | *"One moment…"* → real Firebase answer |
| Sign out before Firebase loads | local session cleared, Firebase never called | waits, then signs out for real |

A gap between the form becoming interactive and Firebase arriving still exists
(measured 0.5–2.0s live, network-dependent) because the SDK loads from
gstatic — the fix is that the UI now waits through it instead of failing.

---

## Open tickets

_None._
