# Vedam — Bug Log

Every bug gets a ticket here: opened when found, closed when fixed and verified,
always with the commit that fixed it. Newest first.

Status: `OPEN` · `IN PROGRESS` · `CLOSED`

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
