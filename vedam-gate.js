/**
 * Vedam — ordering state  (must load in <head>, before anything renders)
 * ===========================================================================
 * VEDAM is live. The website is open to everyone — browse the brand, the
 * collections and every piece. What is not yet open is *ordering*, and the
 * waitlist exists to tell people the moment it is.
 *
 * This file is the single source of truth for "can somebody order yet?", and
 * it runs in the <head> so the answer is already known when the collection
 * pages build their buttons. Without that, a piece would render "Add to Cart"
 * for a frame before correcting itself.
 *
 *   window.VedamOrdering.isOpen()   -> true once ordering has opened
 *   window.VedamOrdering.opensAt()  -> ms timestamp, or 0 if no date is set
 *   window.VedamOrdering.msLeft()   -> ms until it opens (Infinity if no date)
 *
 * It also still carries the pre-launch gate, which is switched OFF now that
 * the brand has launched (launch-config.js: preLaunchMode 'bar'). The code is
 * kept because it costs nothing and makes a future closed-door drop a
 * one-word change rather than a rebuild.
 * ===========================================================================
 */
(function () {
  'use strict';

  var CFG = window.VEDAM_LAUNCH || {};

  /** The instant ordering opens: the server's value if the owner has changed
   *  it in the portal (cached by vedam-launch.js), else the committed one. */
  function resolveOpensAt() {
    var at = typeof CFG.launchAt === 'string' ? CFG.launchAt.trim() : '';
    try {
      var c = JSON.parse(localStorage.getItem('vedamLaunchCfgV1') || 'null');
      if (c && c.at && Date.now() - c.at < 24 * 60 * 60 * 1000 && c.launchAt) at = c.launchAt;
    } catch (e) {}
    var t = at ? Date.parse(at) : NaN;
    return isNaN(t) ? 0 : t;
  }

  window.VedamOrdering = {
    opensAt: resolveOpensAt,
    /** No date set means "not open yet" — never "open". */
    isOpen: function () {
      var t = resolveOpensAt();
      return !!t && Date.now() >= t;
    },
    msLeft: function () {
      var t = resolveOpensAt();
      return t ? t - Date.now() : Infinity;
    },
    /** Runs fn when ordering opens, and once immediately. Used by the
     *  collection pages so a visitor sitting on a piece at 10:30 sees the
     *  button become live without reloading. */
    watch: function (fn) {
      var stopped = false;
      function tick() {
        if (stopped) return;
        var open = window.VedamOrdering.isOpen();
        try { fn(open); } catch (e) {}
        if (open) return;
        var left = window.VedamOrdering.msLeft();
        setTimeout(tick, Math.min(Math.max(isFinite(left) ? left : 60000, 1000), 60000));
      }
      tick();
      return function () { stopped = true; };
    }
  };

  /* ------------------------- the pre-launch gate -------------------------
   * Off while preLaunchMode is 'bar'. Set it to 'gate' to close the whole
   * site behind the waitlist again (see launch-config.js).
   * --------------------------------------------------------------------- */
  if (CFG.preLaunchMode !== 'gate') return;

  var page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  if (page === 'waitlist.html' || page === 'admin.html' || page === 'policies.html') return;

  try {
    if (/[?&]preview=1\b/.test(location.search)) sessionStorage.setItem('vedamPreview', '1');
    if (sessionStorage.getItem('vedamPreview') === '1') return;
  } catch (e) {}

  if (window.VedamOrdering.isOpen()) return;
  location.replace('./waitlist.html');
})();
