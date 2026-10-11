/**
 * Vedam — waitlist page behaviour  (loaded by waitlist.html only)
 * ===========================================================================
 * Three jobs:
 *   1. the countdown in the hero, ticking every second
 *   2. the sign-up form: validation, honeypot, duplicate handling, states
 *   3. the switch to launch mode when the date passes — including while the
 *      page is sitting open, so a visitor watching the countdown reach zero
 *      sees the collection open without touching anything
 *
 * The form sends only what the visitor typed, to the one Apps Script endpoint
 * in launch-config.js, over HTTPS. Nothing is stored in this browser except a
 * flag that the visitor joined (no email, no name, no phone).
 * ===========================================================================
 */
(function () {
  'use strict';

  var L = window.VedamLaunch;
  var $ = function (id) { return document.getElementById(id); };

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  ready(function () {
    if (!L) return;                       // vedam-launch.js failed to load
    var form = $('vwForm');
    if (!form) return;                    // not the waitlist page

    /* ----------------------------- countdown ---------------------------- */

    var cd = $('vwCountdown');
    var cdNote = $('vwCountNote');
    var timer;

    function paintCountdown() {
      if (!cd) return;
      if (!L.hasDate) {
        cd.style.display = 'none';
        if (cdNote) cdNote.textContent = 'The opening date is being set — join the waitlist and you will be the first to know it.';
        return;
      }
      cd.style.display = '';
      var p = L.parts(L.msLeft);
      var set = function (id, v) { var el = $(id); if (el && el.textContent !== String(v)) el.textContent = v; };
      set('vwD', p.d);
      set('vwH', p.h);
      set('vwM', p.m);
      set('vwS', p.s);
      if (cdNote) cdNote.textContent = openingLine();
    }

    /**
     * One time, in IST — the clock Vedam keeps and the one the launch was
     * announced in. The countdown above it already tells every visitor how
     * long they have, whatever timezone they are in.
     */
    function openingLine() {
      var ms = L.launchMs;
      if (!ms) return '';
      var d = new Date(ms);
      var opts = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
                   hour: 'numeric', minute: '2-digit' };
      try {
        return 'Final launch for order placements — ' +
          d.toLocaleString('en-IN', Object.assign({ timeZone: 'Asia/Kolkata' }, opts)) + ' IST';
      } catch (e) {
        return 'Final launch for order placements — ' + d.toString();
      }
    }

    /* --------------------------- launch switch -------------------------- */

    /**
     * While the site is closed in gate mode, every link into the rest of the
     * site would bounce the visitor straight back here. Hide those rather
     * than offer them: the nav keeps only the waitlist, and the wordmark
     * stops being a way out. They all come back at launch.
     */
    var GATED = (window.VEDAM_LAUNCH || {}).preLaunchMode === 'gate';

    function paintGatedLinks(launched) {
      if (!GATED) return;
      var closed = !launched;
      var links = document.querySelectorAll('[data-gated]');
      for (var i = 0; i < links.length; i++) links[i].hidden = closed;
      var col = $('vwFootExplore');
      if (col) col.hidden = closed;              // the whole column empties out
      var mark = $('vwWordmark');
      if (mark) mark.setAttribute('href', closed ? './waitlist.html' : './index.html');
    }

    function paintMode() {
      var launched = L.mode === 'launched';
      paintGatedLinks(launched);
      var show = function (id, on) { var el = $(id); if (el) el.hidden = !on; };
      show('vwWaiting', !launched);
      show('vwOpen', launched);
      var cta = $('vwOpenCta');
      if (cta) cta.href = L.collectionUrl;
      if (launched && timer) { clearInterval(timer); timer = null; }
      if (!launched) paintCountdown();
      // Keep the <h1> honest for screen readers and the browser tab.
      var h1 = $('vwTitle');
      if (h1) h1.textContent = launched ? 'The Collection Is Open' : 'Join the Waitlist';
      document.title = (launched ? 'The Collection Is Open' : 'Join the Waitlist') + ' — Vedam';
    }

    L.onChange(paintMode);
    timer = setInterval(function () {
      if (L.mode === 'launched') paintMode();
      else paintCountdown();
    }, 1000);

    /* ------------------------------- form ------------------------------- */

    var btn = $('vwBtn');
    var msg = $('vwMsg');
    var sending = false;
    var lastSent = '';

    function say(kind, text) {
      if (!msg) return;
      msg.textContent = text;
      msg.style.color = kind === 'err' ? '#A5341F' : '#2F5D3A';
      msg.hidden = !text;
    }

    function val(name) {
      var el = form.querySelector('[name="' + name + '"]');
      return el ? el.value.trim() : '';
    }

    function emailLooksReal(em) {
      var el = form.querySelector('[name="email"]');
      var at = em.indexOf('@'), dot = em.lastIndexOf('.');
      return (el && el.checkValidity ? el.checkValidity() : true) &&
        at > 0 && at === em.lastIndexOf('@') &&
        dot > at + 1 && dot < em.length - 2 && em.indexOf(' ') === -1;
    }

    function succeed(text) {
      sending = false;
      L.remember();
      form.reset();
      var thanks = $('vwThanks');
      if (thanks) {
        var line = $('vwThanksLine');
        if (line) line.textContent = text;
        form.hidden = true;
        thanks.hidden = false;
        thanks.setAttribute('tabindex', '-1');
        try { thanks.focus({ preventScroll: false }); } catch (e) {}
      } else {
        say('ok', text);
      }
      paintBtn();
    }

    function paintBtn() {
      if (!btn) return;
      btn.disabled = sending;
      btn.style.opacity = sending ? '.6' : '1';
      btn.textContent = sending ? 'Reserving your place…' : 'Join the Waitlist';
    }

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (sending) return;

      // Honeypot: a field kept off-screen that people never see. Only bots
      // fill it. Thank them and send nothing.
      if (val('_gotcha')) { succeed('Thank you — your place on the waitlist is held.'); return; }

      var name = val('name'), email = val('email').toLowerCase(), phone = val('phone');

      if (!name) { say('err', 'Please tell us your name.'); focus('name'); return; }
      if (name.length > 100) { say('err', 'That name is longer than we can store — please shorten it.'); return; }
      if (!email) { say('err', 'Please add your email address — it is how we will tell you we have opened.'); focus('email'); return; }
      if (!emailLooksReal(email)) { say('err', 'That email address does not look right — please check it.'); focus('email'); return; }
      if (!phone) { say('err', 'Please add a phone number — we use it to confirm your order.'); focus('phone'); return; }
      if (phone.length > 30) { say('err', 'That phone number is longer than we can store.'); return; }
      if (!/^[\d\s()+\-.]{6,30}$/.test(phone)) { say('err', 'That phone number has characters we cannot read — digits, spaces, + and - only.'); focus('phone'); return; }

      var payload = {
        action: 'join', name: name, email: email, phone: phone,
        source: 'waitlist.html', secret: L.joinSecret
      };

      var sig = name + '|' + email + '|' + phone;
      if (sig === lastSent) { succeed('You are already on the waitlist — thank you.'); return; }

      var url = L.endpoint;
      if (!url || url.indexOf('script.google.com') === -1) {
        say('err', 'The waitlist is not connected yet. Your details are safe above — meanwhile, please write to vedavalavala08@gmail.com and we will add you by hand.');
        return;
      }

      sending = true; say('', ''); paintBtn();

      // text/plain keeps this a "simple" request, so the browser sends it
      // straight through — Apps Script cannot answer a CORS preflight.
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          lastSent = sig;
          if (j && j.ok) {
            if (j.status === 'already') {
              succeed('You are already on the waitlist — we have your place held. You will hear from us the moment it opens.');
            } else {
              succeed('Thank you — your place is held. A confirmation is on its way to your inbox.');
            }
            return;
          }
          sending = false; paintBtn();
          var err = (j && j.error) || '';
          if (err === 'email_invalid') say('err', 'That email address was not accepted — please check it and try again.');
          else if (err === 'name_required') say('err', 'Please tell us your name.');
          else if (err === 'phone_required') say('err', 'Please add a phone number — we use it to confirm your order.');
          else say('err', 'Something went wrong and your details were not sent. They are still here — please try once more.');
        })
        .catch(function () {
          // The response could not be read (a browser blocking the cross-site
          // read, or a flaky connection). Send once more as a fire-and-forget
          // post, which always gets through, so a visitor is never lost to a
          // CORS quirk. The server's own duplicate check makes the retry safe.
          fetch(url, { method: 'POST', mode: 'no-cors', body: new URLSearchParams(payload) })
            .then(function () {
              lastSent = sig;
              succeed('Thank you — your place is held. A confirmation is on its way to your inbox.');
            })
            .catch(function () {
              sending = false; paintBtn();
              say('err', 'Your details could not be sent just now — please check your connection and try again, or write to vedavalavala08@gmail.com.');
            });
        });
    });

    function focus(name) {
      var el = form.querySelector('[name="' + name + '"]');
      if (el) try { el.focus(); } catch (e) {}
    }

    // Somebody who already joined on this device gets a gentler frame.
    if (L.joined) {
      var note = $('vwJoinedNote');
      if (note) note.hidden = false;
    }

    paintMode();
    paintBtn();
  });
})();
