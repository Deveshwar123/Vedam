/**
 * Vedam — shared ordering state  (loaded by every page)
 * ===========================================================================
 * VEDAM is live and every page is public. The one question this answers is
 * whether ORDERING has opened yet.
 *
 *   • resolves the launch date (server value wins over launch-config.js)
 *   • corrects for a visitor's wrong device clock using the server's time
 *   • exposes window.VedamLaunch for waitlist.html's own countdown
 *   • adds a "Waitlist" link to the nav before launch, and removes it after
 *   • shows a slim countdown bar at the foot of every page, which becomes
 *     "the collection is open" at launch and can be dismissed
 *   • in 'gate' mode, redirects the site to waitlist.html until launch
 *
 * It never reads or writes anything about a subscriber. The only call it
 * makes is for the public launch date — no names, emails or phone numbers
 * pass through this file.
 * ===========================================================================
 */
(function () {
  'use strict';

  var CFG = window.VEDAM_LAUNCH || {};
  var CACHE_KEY = 'vedamLaunchCfgV1';
  var DISMISS_KEY = 'vedamLaunchBarDismissedV1';
  var JOINED_KEY = 'vedamWaitlistJoinedV1';
  var CACHE_MS = 5 * 60 * 1000;          // re-ask the server at most every 5 min

  var page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  var ON_WAITLIST_PAGE = page === 'waitlist.html';
  var ON_ORDERS_PAGE = page === 'my-orders.html' || page === 'checkout.html';
  // Gate mode (hiding the site before launch) is decided once, in
  // vedam-gate.js, which runs in <head> before the page paints. This file
  // only dresses the pages that are allowed to render.

  /* ----------------------------- state ---------------------------------- */

  var state = {
    launchAt: typeof CFG.launchAt === 'string' ? CFG.launchAt.trim() : '',
    collectionUrl: CFG.collectionUrl || './collections.html',
    endpoint: (CFG.endpoint || '').trim(),
    skewMs: 0,                            // serverNow - deviceNow
    source: 'config'
  };

  try {
    var cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    // Up to a day old is still better than the committed file: a date the
    // owner changed in the portal is the newer intent. refresh() below
    // re-asks the server anyway, at most once every CACHE_MS.
    if (cached && cached.at && Date.now() - cached.at < 24 * 60 * 60 * 1000) {
      if (typeof cached.launchAt === 'string') state.launchAt = cached.launchAt;
      if (cached.collectionUrl) state.collectionUrl = cached.collectionUrl;
      if (typeof cached.skewMs === 'number') state.skewMs = cached.skewMs;
      state.source = 'cache';
    }
  } catch (e) {}

  function now() { return Date.now() + state.skewMs; }

  function launchMs() {
    if (!state.launchAt) return 0;
    var t = Date.parse(state.launchAt);
    return isNaN(t) ? 0 : t;
  }

  function msLeft() {
    var t = launchMs();
    return t ? t - now() : Infinity;      // no date set → never "launched"
  }

  function mode() { return launchMs() && msLeft() <= 0 ? 'launched' : 'waitlist'; }

  /* --------------------------- public surface ---------------------------- */

  var listeners = [];

  var api = {
    get mode() { return mode(); },
    get launchAt() { return state.launchAt; },
    get launchMs() { return launchMs(); },
    get msLeft() { return msLeft(); },
    get hasDate() { return !!launchMs(); },
    get collectionUrl() { return state.collectionUrl; },
    get endpoint() { return state.endpoint; },
    get joinSecret() { return CFG.joinSecret || ''; },
    get joined() { try { return !!localStorage.getItem(JOINED_KEY); } catch (e) { return false; } },
    /** Remembers on this device only that the visitor joined, so the bar can
     *  say "you are on the waitlist". No email is stored. */
    remember: function () { try { localStorage.setItem(JOINED_KEY, '1'); } catch (e) {} },
    now: now,
    /** Called once immediately, and again if the server's answer differs. */
    onChange: function (fn) { listeners.push(fn); try { fn(api); } catch (e) {} },
    parts: parts,
    refresh: refresh
  };
  window.VedamLaunch = api;

  function announce() {
    for (var i = 0; i < listeners.length; i++) { try { listeners[i](api); } catch (e) {} }
  }

  /** Breaks a duration into padded days/hours/minutes/seconds. */
  function parts(ms) {
    if (!isFinite(ms) || ms < 0) ms = 0;
    var s = Math.floor(ms / 1000);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return {
      d: Math.floor(s / 86400),
      h: p(Math.floor(s % 86400 / 3600)),
      m: p(Math.floor(s % 3600 / 60)),
      s: p(s % 60)
    };
  }

  /* ------------------------ server config refresh ------------------------ */
  /**
   * Keeps the countdown honest in two ways the committed file cannot:
   * a date the owner changed in the portal, and a visitor whose own device
   * clock is wrong (we measure the difference and count down by server time).
   */
  function refresh() {
    if (!state.endpoint) return Promise.resolve(api);
    try {
      var last = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (last && Date.now() - last.at < CACHE_MS) return Promise.resolve(api);
    } catch (e) {}

    return fetch(state.endpoint + '?action=config', { method: 'GET' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok) return api;
        var before = state.launchAt + '|' + mode();
        // An empty value from the server means "no date set there" — it must
        // not wipe a date that is committed in launch-config.js, or an
        // unconfigured backend would silently turn the countdown off.
        // (So to have no date at all, clear it in BOTH places.)
        if (typeof j.launchAt === 'string' && j.launchAt) state.launchAt = j.launchAt;
        if (j.collectionUrl) state.collectionUrl = j.collectionUrl;
        if (j.serverNow) {
          var sn = Date.parse(j.serverNow);
          if (!isNaN(sn)) state.skewMs = sn - Date.now();
        }
        state.source = 'server';
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({
            at: Date.now(), launchAt: state.launchAt,
            collectionUrl: state.collectionUrl, skewMs: state.skewMs
          }));
        } catch (e) {}
        if (before !== state.launchAt + '|' + mode()) announce();
        return api;
      })
      .catch(function () { return api; });   // offline, blocked, mistyped URL
  }

  /* ---------------------------- nav + the bar ---------------------------- */

  function navLink() {
    // Clone the look of a real nav link rather than hard-coding styles, so
    // this stays correct if the nav is restyled in the design tool.
    var nav = document.querySelector('nav');
    if (!nav || document.getElementById('vdWaitlistNav')) return;
    var links = nav.querySelectorAll('a[href*="collections.html"], a[href*="contact-us.html"]');
    var model = links[links.length - 1];
    if (!model || !model.parentNode) return;
    var a = model.cloneNode(false);
    a.id = 'vdWaitlistNav';
    a.href = './waitlist.html';
    a.textContent = 'Waitlist';
    model.parentNode.insertBefore(a, model.nextSibling);
  }

  /** My Orders belongs in the nav only once somebody is signed in — it is
   *  meaningless to a visitor, and the site already remembers who is here. */
  function ordersLink() {
    var nav = document.querySelector('nav');
    if (!nav || document.getElementById('vdOrdersNav')) return;
    var signedIn = false;
    try { signedIn = !!JSON.parse(localStorage.getItem('vedamUserV1')); } catch (e) {}
    if (!signedIn) return;
    var links = nav.querySelectorAll('a[href*="cart.html"], a[href*="collections.html"]');
    var model = links[links.length - 1];
    if (!model || !model.parentNode) return;
    var a = model.cloneNode(false);
    a.id = 'vdOrdersNav';
    a.href = './my-orders.html';
    a.textContent = 'My Orders';
    model.parentNode.insertBefore(a, model.nextSibling);
  }

  function syncOrdersNav() {
    var a = document.getElementById('vdOrdersNav');
    var signedIn = false;
    try { signedIn = !!JSON.parse(localStorage.getItem('vedamUserV1')); } catch (e) {}
    if (signedIn && !ON_ORDERS_PAGE) { if (!a) ordersLink(); }
    else if (a) a.parentNode.removeChild(a);
  }

  function syncNav() {
    var a = document.getElementById('vdWaitlistNav');
    // The waitlist outlives the opening of ordering — it carries on for the
    // next collection — so the link stays in the nav either way.
    if (!ON_WAITLIST_PAGE) {
      if (!a) navLink();
    } else if (a) {
      a.parentNode.removeChild(a);
    }
  }

  var bar, barText, tick;

  function buildBar() {
    if (bar || ON_WAITLIST_PAGE) return;
    try { if (localStorage.getItem(DISMISS_KEY) === mode()) return; } catch (e) {}

    bar = document.createElement('div');
    bar.id = 'vdLaunchBar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Launch status');
    bar.style.cssText = [
      'position:fixed', 'left:0', 'right:0', 'bottom:0', 'z-index:80',
      'display:flex', 'align-items:center', 'justify-content:center',
      'flex-wrap:wrap', 'gap:8px 20px',
      'padding:13px clamp(46px,6vw,70px) calc(13px + env(safe-area-inset-bottom, 0px))',
      'background:rgba(37,9,13,.93)', '-webkit-backdrop-filter:blur(8px)',
      'backdrop-filter:blur(8px)', 'border-top:1px solid rgba(201,161,92,.5)',
      'font-family:\'Jost\', -apple-system, BlinkMacSystemFont, sans-serif',
      'font-size:11px', 'letter-spacing:.2em', 'text-transform:uppercase',
      'color:#F0E1BE', 'text-align:center',
      'transform:translateY(100%)', 'transition:transform .6s ease .4s'
    ].join(';');

    barText = document.createElement('span');
    barText.style.cssText = 'color:rgba(240,225,190,.9)';

    var cta = document.createElement('a');
    cta.id = 'vdLaunchBarCta';
    cta.style.cssText = [
      'font-size:10.5px', 'letter-spacing:.26em', 'text-transform:uppercase',
      'color:#F3E6C8', 'border:1px solid rgba(201,161,92,.75)',
      'padding:9px 20px', 'min-height:38px', 'display:inline-flex',
      'align-items:center', 'text-decoration:none',
      'transition:background .3s ease'
    ].join(';');
    cta.addEventListener('mouseenter', function () { cta.style.background = 'rgba(201,161,92,.18)'; });
    cta.addEventListener('mouseleave', function () { cta.style.background = 'transparent'; });

    var x = document.createElement('button');
    x.type = 'button';
    x.setAttribute('aria-label', 'Dismiss');
    x.style.cssText = [
      'position:absolute', 'right:10px', 'top:50%', 'transform:translateY(-50%)',
      'width:44px', 'height:44px', 'min-height:44px', 'background:transparent',
      'border:0', 'color:rgba(240,225,190,.6)', 'font-size:18px',
      'line-height:1', 'cursor:pointer', 'font-family:inherit'
    ].join(';');
    x.textContent = '×';
    x.addEventListener('click', function () {
      try { localStorage.setItem(DISMISS_KEY, mode()); } catch (e) {}
      // No entry delay on the way out, and hide it for real once it has gone:
      // a bar that has only slid off-screen still holds a tabbable link.
      bar.style.transition = 'transform .35s ease';
      bar.style.transform = 'translateY(100%)';
      bar.addEventListener('transitionend', function () { bar.hidden = true; }, { once: true });
      setTimeout(function () { if (bar) bar.hidden = true; }, 600);   // reduced-motion
      if (tick) { clearInterval(tick); tick = null; }
    });

    bar.appendChild(barText);
    bar.appendChild(cta);
    bar.appendChild(x);
    document.body.appendChild(bar);
    requestAnimationFrame(function () { bar.style.transform = 'translateY(0)'; });
  }

  function paintBar() {
    if (!bar) return;
    var cta = document.getElementById('vdLaunchBarCta');
    if (mode() === 'launched') {
      barText.textContent = 'Ordering is now open';
      cta.textContent = 'View the collection';
      cta.href = state.collectionUrl;
      if (tick) { clearInterval(tick); tick = null; }
      return;
    }
    if (!api.hasDate) {
      barText.textContent = 'Ordering opens soon';
    } else {
      var p = parts(msLeft());
      barText.textContent = 'Ordering opens in ' +
        (p.d > 0 ? p.d + 'd ' : '') + p.h + 'h ' + p.m + 'm ' + p.s + 's';
    }
    cta.textContent = api.joined ? 'You are on the waitlist' : 'Be first to order';
    cta.href = './waitlist.html';
  }

  function start() {
    syncNav();
    syncOrdersNav();
    buildBar();
    paintBar();
    keepAlive();
    if (!tick && bar && mode() === 'waitlist' && api.hasDate) {
      tick = setInterval(function () {
        paintBar();
        if (mode() === 'launched') { syncNav(); paintBar(); }   // crossed the line live
      }, 1000);
    }
    refresh();
  }

  /**
   * The pages are design-tool components that re-render, and a re-render
   * rebuilds the nav from its own markup — dropping the Waitlist link and,
   * if the bar were inside that subtree, the bar too. The existing Firebase
   * block solves the same problem the same way: watch for mutation bursts
   * and re-apply once per frame rather than once per mutation.
   */
  function keepAlive() {
    var raf = 0;
    try {
      new MutationObserver(function () {
        if (raf) return;
        raf = requestAnimationFrame(function () {
          raf = 0;
          syncNav();
          syncOrdersNav();
          if (bar && !bar.hidden && !bar.isConnected) { document.body.appendChild(bar); }
          paintBar();
        });
      }).observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {}
  }

  listeners.push(function () { syncNav(); syncOrdersNav(); paintBar(); });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
