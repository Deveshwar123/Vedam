/**
 * Vedam — the pre-launch gate  (must load in <head>, before anything renders)
 * ===========================================================================
 * Before the launch date, the house is closed: every page sends visitors to
 * waitlist.html. After it, this file does nothing at all and the site behaves
 * exactly as it always has.
 *
 * It runs in the <head>, synchronously, on purpose. Redirecting later — from
 * the foot of the page, or after the bundle unpacks — would let the real site
 * paint for a moment first, which is precisely what a closed house must not
 * show.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS AND IS NOT
 * ---------------------------------------------------------------------------
 * This hides the site from visitors. It is NOT access control: every page on
 * a GitHub Pages site is a public file, so somebody who disables JavaScript or
 * reads the page source can still reach the collection markup. For a soft
 * launch that is the right trade — the pages stay deployed, indexed and ready,
 * and open by themselves on the day. If the collection must be truly
 * unreachable before launch, the only way is to keep those pages out of the
 * published branch until the date.
 *
 * Owner preview: add ?preview=1 to any page to look at the real site while the
 * gate is up. It lasts for that browser tab only.
 * ===========================================================================
 */
(function () {
  'use strict';

  var CFG = window.VEDAM_LAUNCH || {};
  if (CFG.preLaunchMode !== 'gate') return;

  var page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();

  // The waitlist is the destination; the owner portal is how the launch is
  // run; the policies page carries the privacy notice that the waitlist form
  // and every email link to, so it has to stay reachable.
  if (page === 'waitlist.html' || page === 'admin.html' || page === 'policies.html') return;

  // Owner preview, remembered for this tab so links keep working while
  // looking around.
  try {
    if (/[?&]preview=1\b/.test(location.search)) sessionStorage.setItem('vedamPreview', '1');
    if (sessionStorage.getItem('vedamPreview') === '1') return;
  } catch (e) {}

  var launchAt = typeof CFG.launchAt === 'string' ? CFG.launchAt.trim() : '';

  // A date the owner set in the portal reaches this device through the cache
  // vedam-launch.js writes, and outranks the committed one.
  try {
    var c = JSON.parse(localStorage.getItem('vedamLaunchCfgV1') || 'null');
    if (c && c.at && Date.now() - c.at < 24 * 60 * 60 * 1000 && typeof c.launchAt === 'string') {
      launchAt = c.launchAt;
    }
  } catch (e) {}

  var t = launchAt ? Date.parse(launchAt) : NaN;

  // No date set yet still means "not open". An unreadable date is treated as
  // open rather than locking the whole site behind a typo.
  var closed = !launchAt || (!isNaN(t) && Date.now() < t);
  if (!closed) return;

  // replace(), not assign(): Back from the waitlist must not bounce the
  // visitor straight back into the gate.
  location.replace('./waitlist.html');
})();
