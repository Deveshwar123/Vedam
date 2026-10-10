/**
 * Vedam — launch configuration
 * ===========================================================================
 * The one file to edit for the launch. Every page reads it, so a change here
 * (one commit, ~1 minute for GitHub Pages to redeploy) moves the countdown,
 * the waitlist page and the site-wide bar together.
 *
 * You can also change the launch date WITHOUT a commit, from the Owner Portal
 * → Waitlist → "Launch date". That writes it on the server, and the server's
 * value wins over the one below — so the date you set in the portal is what
 * visitors see, and it is the date the launch email is sent on.
 *
 * Nothing secret belongs in this file. It is public, like every file on a
 * GitHub Pages site. The admin token lives in the Owner Portal's own
 * Firestore-backed store, never here.
 * ===========================================================================
 */
window.VEDAM_LAUNCH = {

  /* ---------------------------------------------------------------------
   * 1. WHEN DOES THE HOUSE OPEN?
   *
   * An ISO 8601 instant. The simplest correct way to write it is with the
   * offset spelled out, so there is no doubt which clock it means:
   *
   *     '2026-11-14T19:00:00+05:30'   7 pm India Standard Time
   *     '2026-11-14T13:30:00Z'        the same moment, written in UTC
   *
   * Leave it as '' (empty) until the date is decided: the site then shows
   * the waitlist and the sign-up form with no countdown, and says the date
   * is being announced soon. Nothing breaks, and no launch email can fire.
   * ------------------------------------------------------------------- */
  launchAt: '',

  /* ---------------------------------------------------------------------
   * 2. THE BACKEND (Google Apps Script web app URL, ends in /exec)
   *
   * Paste the URL you get from step 4 of the setup in
   * waitlist-apps-script.gs. Until it is filled in, the waitlist page
   * still renders and counts down, but tells visitors to email the house
   * directly instead of silently dropping their details.
   * ------------------------------------------------------------------- */
  endpoint: '',

  /* ---------------------------------------------------------------------
   * 3. WHERE LAUNCH MODE SENDS PEOPLE
   * The page the launch email's button and the post-launch bar link to.
   * ------------------------------------------------------------------- */
  collectionUrl: './collections.html',

  /* ---------------------------------------------------------------------
   * 4. HOW THE REST OF THE SITE BEHAVES BEFORE LAUNCH
   *
   *   'gate' — the house is closed. Every page sends visitors to the
   *            waitlist until the launch date passes, so nobody sees the
   *            collection early. Collections, cart and sign-in all come
   *            back by themselves on the day — nothing to switch on.
   *            (default)
   *
   *   'bar'  — the site stays open and browsable, with a slim countdown
   *            bar at the foot of every page inviting visitors to join.
   *
   * Always reachable, in either mode: the waitlist itself, the policies
   * page (the privacy notice the form and the emails link to) and the
   * owner portal.
   *
   * To look at the real site yourself while the gate is up, add ?preview=1
   * to any page — it lasts for that browser tab.
   *
   * A note on what 'gate' is: it hides the site from visitors, it does not
   * lock it. Every page on a GitHub Pages site is a public file, so anyone
   * who turns JavaScript off or reads the page source can still reach the
   * markup. If the collection must be truly unreachable before launch, keep
   * those pages out of the published branch until the day.
   * ------------------------------------------------------------------- */
  preLaunchMode: 'gate',

  /* ---------------------------------------------------------------------
   * 5. Optional spam speed bump. If you set a JOIN_SECRET script property
   * in the Apps Script, put the same string here. It is not a secret (this
   * file is public) — it only costs a drive-by bot one extra request.
   * ------------------------------------------------------------------- */
  joinSecret: ''
};
