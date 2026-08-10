# Vedam — Security & Hardening Checklist

Findings from the 2026-08-09 review, most serious first. Items marked
**[owner action]** can only be done in a console (Firebase / Google Cloud /
Apps Script) — they are not code in this repo and cannot be fixed by a commit.

---

## S1 — Firestore rules are the whole access-control model **[owner action]**

`admin.html` grants owner access purely by whether reading the `users`
collection succeeds. If the deployed Firestore rules are permissive, any
signed-in customer can read every other customer's `users` profile and `carts`
document, and could write outside their own `uid`.

**Fix:** deploy [`firestore.rules`](./firestore.rules).
1. Get the owner UID: Firebase console → Authentication → Users → copy the
   owner account's **User UID**.
2. Paste it into `firestore.rules` (replace `REPLACE_WITH_OWNER_UID`).
3. Firebase console → Firestore → Rules → paste the file → **Publish**.
4. Verify in the **Rules Playground**:
   - as customer A, `get /carts/{A}` → allow; `get /carts/{B}` → deny;
     `list /carts` → deny.
   - as owner, `list /users` and `list /carts` → allow.

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

See [`BUGS.md`](./BUGS.md) for the tracked tickets (VEDAM-3 … VEDAM-11).
