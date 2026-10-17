/**
 * Vedam — Waitlist & Launch backend
 * ===========================================================================
 * One Apps Script web app that is the whole server side of the waitlist:
 *
 *   • stores signups in a Google Sheet (the database)
 *   • sends the confirmation email the moment somebody joins
 *   • sends the "ordering is open" announcement once, to everybody, when the
 *     date arrives (a time trigger does it even if nobody is on the site)
 *   • sends owner-written campaigns to the list
 *   • serves the launch date/mode to the site, so the countdown and the
 *     waitlist→launch switch need no redeploy of the site
 *   • serves the one-click unsubscribe page
 *
 * This is a SEPARATE Sheet + deployment from the Inquiries and Fittings
 * scripts, exactly as fittings-apps-script.gs is separate from contact.
 *
 * ---------------------------------------------------------------------------
 * SETUP (one time, ~10 minutes)
 * ---------------------------------------------------------------------------
 *  1. Create a new Google Sheet, e.g. "Vedam Waitlist".
 *  2. Extensions → Apps Script. Delete the sample code, paste this file, save.
 *  3. Run the function `setupVedamWaitlist` once (Run ▸ setupVedamWaitlist).
 *     Authorize when prompted. It creates the sheets, generates the admin
 *     token and the unsubscribe secret, and installs the 15-minute trigger
 *     that sends the launch email and drains campaign queues.
 *     The execution log prints your ADMIN TOKEN — copy it.
 *  4. Deploy ▸ New deployment ▸ Web app:
 *        Execute as:      Me
 *        Who has access:  Anyone
 *     Copy the Web app URL (ends in /exec).
 *  5. Put that URL in launch-config.js (ENDPOINT) and commit.
 *  6. Paste the admin token into the Owner Portal → Waitlist → token box.
 *  7. Set the launch date from the Owner Portal (or leave it empty: the site
 *     then stays in waitlist mode with no countdown until you set one).
 *
 * ---------------------------------------------------------------------------
 * SECRETS — never in this file, never in the repo
 * ---------------------------------------------------------------------------
 * Apps Script's Script Properties are this project's environment variables:
 * Project Settings ▸ Script Properties.
 *
 *   ADMIN_TOKEN     (auto-generated)  owner actions: list/export/campaign/config
 *   UNSUB_SECRET    (auto-generated)  signs unsubscribe links
 *   LAUNCH_AT       ISO 8601 instant, e.g. 2026-11-14T13:30:00.000Z ("" = unset)
 *   COLLECTION_URL  where the launch email + launch mode send people
 *   SITE_URL        site root, used in email links
 *   FROM_NAME       display name on outgoing mail            (default "Vedam")
 *   REPLY_TO        reply address                   (default the Gmail account)
 *   SEND_AS         verified Gmail "Send mail as" alias to send from, e.g.
 *                   vedavalavala08@gmail.com (ignored until Gmail verifies it)
 *   JOIN_SECRET     optional spam speed bump, see note in doPost
 *   RESEND_API_KEY  optional — if present, mail goes out through Resend
 *   MAIL_FROM       required with RESEND_API_KEY, e.g. "Vedam <hello@vedam.in>"
 *
 * Mail provider: with no RESEND_API_KEY the script sends with MailApp from the
 * Google account that owns it. That is free and needs no setup, but a consumer
 * Gmail account is capped at ~100 recipients/day (Workspace ~1,500). The
 * sender is pluggable precisely so a bigger list can move to Resend by adding
 * two properties — no code change. Both paths are logged identically, and a
 * send that is refused for quota is retried by the trigger, never dropped.
 * ===========================================================================
 */

/* ----------------------------- configuration ----------------------------- */

var SHEET_LIST = 'Waitlist';
var SHEET_LOG  = 'Email Log';

// Waitlist sheet columns, in order. Changing this array migrates the header
// row on the next write; existing data columns are matched by name.
var COLS = [
  'Timestamp',      // when they joined
  'Name',
  'Email',          // unique key, stored lowercase
  'Phone',          // required since 11 Oct 2026
  'Source',         // which page/section the signup came from
  'Status',         // Subscribed | Unsubscribed
  'Confirm Email',  // Sent | Failed | Skipped
  'Confirm At',
  'Launch Email',   // Sent | Failed  (blank until the launch send)
  'Launch At',
  'Campaigns Sent', // count
  'Last Campaign',  // subject of the most recent campaign
  'Last Campaign At',
  'Unsubscribed At',
  'Last Error'
];

var LOG_COLS = ['Timestamp', 'Type', 'Email', 'Subject', 'Status', 'Detail', 'Provider'];

// How many messages one trigger run may send. Keeps a run inside the 6-minute
// Apps Script execution limit; the next run picks up where this one stopped.
var BATCH_PER_RUN = 60;

var MAX = { name: 100, email: 200, phone: 30, source: 60, subject: 200, body: 20000 };

/* -------------------------------- setup ---------------------------------- */

/** Run once from the editor. Idempotent — safe to re-run. */
function setupVedamWaitlist() {
  var props = PropertiesService.getScriptProperties();

  sheetFor_(SHEET_LIST, COLS);
  sheetFor_(SHEET_LOG, LOG_COLS);

  if (!props.getProperty('ADMIN_TOKEN')) {
    props.setProperty('ADMIN_TOKEN', randomToken_(32));
  }
  if (!props.getProperty('UNSUB_SECRET')) {
    props.setProperty('UNSUB_SECRET', randomToken_(32));
  }
  if (props.getProperty('LAUNCH_AT') === null) props.setProperty('LAUNCH_AT', '');
  if (!props.getProperty('SITE_URL')) {
    props.setProperty('SITE_URL', 'https://deveshwar123.github.io/Vedam/');
  }
  if (!props.getProperty('COLLECTION_URL')) {
    props.setProperty('COLLECTION_URL', 'https://deveshwar123.github.io/Vedam/collections.html');
  }
  if (!props.getProperty('FROM_NAME')) props.setProperty('FROM_NAME', 'Vedam');

  // One trigger, every 15 minutes: sends the launch mail when the date passes
  // and continues any campaign that ran out of daily quota.
  var have = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'vedamWaitlistTick';
  });
  if (!have) {
    ScriptApp.newTrigger('vedamWaitlistTick').timeBased().everyMinutes(15).create();
  }

  Logger.log('— Vedam waitlist ready —');
  Logger.log('ADMIN TOKEN: ' + props.getProperty('ADMIN_TOKEN'));
  Logger.log('Paste it into the Owner Portal → Waitlist. Deploy as a web app next.');
  return 'ok';
}

/** The 15-minute trigger. */
function vedamWaitlistTick() {
  try { sendLaunchEmails_(); } catch (e) { logLine_('tick', '', '', 'Failed', 'launch: ' + e.message, ''); }
  try { drainCampaign_(); }   catch (e) { logLine_('tick', '', '', 'Failed', 'campaign: ' + e.message, ''); }
}

/* --------------------------------- doGet ---------------------------------- */
/**
 * Public, no token:
 *   ?action=config        → { launchAt, mode, collectionUrl }
 *   ?action=unsubscribe   → branded HTML page, flips the row to Unsubscribed
 *
 * Nothing here can read the list. `config` returns only the launch date and
 * the collection URL — both of which the site shows publicly anyway — and
 * never a name, an email, a phone number or even a count. Owner reads go
 * through doPost so the token travels in the request body, not the query
 * string (SECURITY.md S2: query strings leak via Referer headers, browser
 * history and Apps Script execution logs).
 */
function doGet(e) {
  var p = (e && e.parameter) || {};
  var action = String(p.action || 'config');

  if (action === 'unsubscribe') return unsubscribePage_(p);

  if (action === 'config') {
    var props = PropertiesService.getScriptProperties();
    var out = {
      ok: true,
      launchAt: props.getProperty('LAUNCH_AT') || '',
      collectionUrl: props.getProperty('COLLECTION_URL') || '',
      serverNow: new Date().toISOString()
    };
    out.mode = launchPassed_(out.launchAt) ? 'launched' : 'waitlist';
    return json_(out);
  }

  return json_({ ok: false, error: 'unknown action' });
}

/* --------------------------------- doPost --------------------------------- */
/**
 * Body may be form-encoded or a JSON text/plain body (the site posts JSON as
 * text/plain so the browser treats it as a simple request — no CORS preflight,
 * which Apps Script cannot answer).
 *
 * Public action:
 *   join       { name, email, phone, source, _gotcha }
 *
 * Owner actions (require token):
 *   list       → every row
 *   stats      → counts for the dashboard tiles
 *   config_set { launchAt, collectionUrl, showCount }
 *   campaign   { subject, html, audience, testTo }
 *   resend     { email, type }   re-send a confirmation that failed
 *   remove     { email }         mark unsubscribed by hand
 */
function doPost(e) {
  var p = parseBody_(e);
  var action = String(p.action || 'join');

  try {
    if (action === 'join') return json_(join_(p));

    if (!tokenOk_(p.token)) {
      Utilities.sleep(400); // slow a guessing loop down a little
      return json_({ ok: false, error: 'unauthorized' });
    }

    switch (action) {
      case 'list':       return json_({ ok: true, rows: listRows_(), stats: stats_() });
      case 'stats':      return json_({ ok: true, stats: stats_() });
      case 'config_set': return json_(configSet_(p));
      case 'campaign':   return json_(campaign_(p));
      case 'resend':     return json_(resend_(p));
      case 'remove':     return json_(remove_(p));
      case 'launch_now': return json_(launchNow_(p));
    }
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

/* ------------------------------ join (public) ----------------------------- */

function join_(p) {
  // Honeypot: a field positioned off-screen that people never see. Only bots
  // fill it. Answer as if it worked so they move on, and write nothing.
  if (String(p._gotcha || '')) return { ok: true, status: 'joined' };

  // Optional spam speed bump. JOIN_SECRET lives in launch-config.js, which is
  // public — so this is NOT a secret and is not pretended to be one. It only
  // costs a drive-by script one extra fetch of the site. For real abuse, put
  // Cloudflare Turnstile in front of the form (see SECURITY.md S3).
  var want = PropertiesService.getScriptProperties().getProperty('JOIN_SECRET');
  if (want && String(p.secret || '') !== want) return { ok: false, error: 'rejected' };

  var name  = clip_(p.name, MAX.name);
  var email = normEmail_(p.email);
  var phone = clip_(p.phone, MAX.phone);
  var source = clip_(p.source || 'waitlist', MAX.source);

  if (!name)  return { ok: false, error: 'name_required' };
  if (!emailOk_(email)) return { ok: false, error: 'email_invalid' };
  // Phone is required too. Checked here as well as in the form, because the
  // form is only a suggestion to anything posting straight at this endpoint.
  if (!phone) return { ok: false, error: 'phone_required' };

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = sheetFor_(SHEET_LIST, COLS);
    var idx = headerIndex_(sh);
    var found = findRow_(sh, idx, email);

    if (found) {
      var status = String(found.values[idx['Status']] || '');
      if (status === 'Unsubscribed') {
        // Coming back after unsubscribing is a fresh, wanted signup.
        setCells_(sh, found.row, idx, {
          'Timestamp': new Date(), 'Name': name, 'Phone': phone,
          'Source': source, 'Status': 'Subscribed', 'Unsubscribed At': ''
        });
        sendConfirm_(sh, found.row, idx, name, email);
        return { ok: true, status: 'resubscribed' };
      }
      // Already on the list: keep the earliest Timestamp, top up blank fields,
      // and do NOT send a second confirmation.
      var patch = {};
      if (!found.values[idx['Phone']] && phone) patch['Phone'] = phone;
      if (name && name !== found.values[idx['Name']]) patch['Name'] = name;
      if (Object.keys(patch).length) setCells_(sh, found.row, idx, patch);
      return { ok: true, status: 'already', joinedAt: isoOf_(found.values[idx['Timestamp']]) };
    }

    var row = COLS.map(function (c) {
      return c === 'Timestamp' ? new Date()
        : c === 'Name' ? safeCell_(name)
        : c === 'Email' ? safeCell_(email)
        : c === 'Phone' ? safeCell_(phone)
        : c === 'Source' ? safeCell_(source)
        : c === 'Status' ? 'Subscribed'
        : c === 'Campaigns Sent' ? 0
        : '';
    });
    sh.appendRow(row);
    var r = sh.getLastRow();
    sendConfirm_(sh, r, idx, name, email);
    return { ok: true, status: 'joined' };
  } finally {
    lock.releaseLock();
  }
}

function sendConfirm_(sh, row, idx, name, email) {
  var t = emailConfirm_(name, email);
  var res = send_(email, t.subject, t.html, t.text);
  setCells_(sh, row, idx, {
    'Confirm Email': res.ok ? 'Sent' : 'Failed',
    'Confirm At': new Date(),
    'Last Error': res.ok ? '' : clip_(res.error, 300)
  });
  logLine_('confirm', email, t.subject, res.ok ? 'Sent' : 'Failed', res.error || '', res.provider);
}

/* ------------------------------ launch email ------------------------------ */

/**
 * Sends the announcement to everyone who is Subscribed and has no Launch Email
 * mark yet. Safe to call as often as you like: the per-row mark is what makes
 * "exactly once" true, so a crash, a quota wall or two overlapping runs can
 * never double-send. Resumes on the next trigger if it stops early.
 */
function sendLaunchEmails_() {
  var props = PropertiesService.getScriptProperties();
  var launchAt = props.getProperty('LAUNCH_AT') || '';
  if (!launchPassed_(launchAt)) return { ok: true, sent: 0, note: 'not launched yet' };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { ok: true, sent: 0, note: 'another run holds the lock' };
  try {
    var sh = sheetFor_(SHEET_LIST, COLS);
    var idx = headerIndex_(sh);
    var last = sh.getLastRow();
    if (last < 2) return { ok: true, sent: 0 };

    var values = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
    var sent = 0, failed = 0, left = BATCH_PER_RUN;

    for (var i = 0; i < values.length && left > 0; i++) {
      var v = values[i];
      if (String(v[idx['Status']]) !== 'Subscribed') continue;
      if (String(v[idx['Launch Email']] || '')) continue;      // already handled
      var email = String(v[idx['Email']] || '');
      if (!emailOk_(email)) continue;

      if (!quotaLeft_()) {
        logLine_('launch', '', '', 'Deferred', 'daily mail quota reached — resuming next run', '');
        break;
      }
      var t = emailLaunch_(String(v[idx['Name']] || ''), email);
      var res = send_(email, t.subject, t.html, t.text);
      setCells_(sh, i + 2, idx, {
        'Launch Email': res.ok ? 'Sent' : 'Failed',
        'Launch At': new Date(),
        'Last Error': res.ok ? '' : clip_(res.error, 300)
      });
      logLine_('launch', email, t.subject, res.ok ? 'Sent' : 'Failed', res.error || '', res.provider);
      res.ok ? sent++ : failed++;
      left--;
    }
    return { ok: true, sent: sent, failed: failed };
  } finally {
    lock.releaseLock();
  }
}

/** Owner button: send the launch mail now without waiting for the date. */
function launchNow_(p) {
  var props = PropertiesService.getScriptProperties();
  if (!launchPassed_(props.getProperty('LAUNCH_AT') || '')) {
    if (String(p.confirm || '') !== 'yes') {
      return { ok: false, error: 'launch date has not passed — resend with confirm=yes to go early' };
    }
    props.setProperty('LAUNCH_AT', new Date().toISOString());
  }
  return sendLaunchEmails_();
}

/* -------------------------------- campaigns ------------------------------- */
/**
 * A campaign is queued, not blasted inside the request: the daily mail quota
 * and the 6-minute execution limit both mean a large list cannot go out in one
 * call. The queue holds the subject, the body and a cursor; each call and each
 * 15-minute trigger sends the next slice and moves the cursor.
 */
function campaign_(p) {
  var subject = clip_(p.subject, MAX.subject);
  var html = String(p.html || '').slice(0, MAX.body);
  if (!subject) return { ok: false, error: 'subject_required' };
  if (!html.trim()) return { ok: false, error: 'body_required' };

  // "Send me a test first" — one message, no queue, nothing marked.
  var testTo = normEmail_(p.testTo);
  if (testTo) {
    var tt = emailCampaign_('', testTo, subject, html);
    var tr = send_(testTo, '[test] ' + subject, tt.html, tt.text);
    logLine_('campaign-test', testTo, subject, tr.ok ? 'Sent' : 'Failed', tr.error || '', tr.provider);
    return { ok: tr.ok, test: true, error: tr.error || '' };
  }

  var props = PropertiesService.getScriptProperties();
  var pending = props.getProperty('CAMPAIGN');
  if (pending) {
    var q = JSON.parse(pending);
    if (q.cursor < q.emails.length) {
      return { ok: false, error: 'a campaign is still sending (' + q.cursor + '/' + q.emails.length + ') — wait for it to finish' };
    }
  }

  var audience = String(p.audience || 'subscribed');
  var emails = recipients_(audience);
  if (!emails.length) return { ok: false, error: 'no recipients' };

  props.setProperty('CAMPAIGN', JSON.stringify({
    subject: subject, html: html, emails: emails, cursor: 0,
    queuedAt: new Date().toISOString()
  }));
  var out = drainCampaign_();
  out.queued = emails.length;
  return out;
}

function drainCampaign_() {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty('CAMPAIGN');
  if (!raw) return { ok: true, sent: 0 };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { ok: true, sent: 0, note: 'another run holds the lock' };
  try {
    var q = JSON.parse(raw);
    if (q.cursor >= q.emails.length) { props.deleteProperty('CAMPAIGN'); return { ok: true, sent: 0, done: true }; }

    var sh = sheetFor_(SHEET_LIST, COLS);
    var idx = headerIndex_(sh);
    var byEmail = emailRowMap_(sh, idx);
    var sent = 0, failed = 0, left = BATCH_PER_RUN;

    while (q.cursor < q.emails.length && left > 0) {
      if (!quotaLeft_()) {
        logLine_('campaign', '', q.subject, 'Deferred', 'daily mail quota reached — resuming next run', '');
        break;
      }
      var email = q.emails[q.cursor];
      var row = byEmail[email];
      // Somebody may have unsubscribed after the campaign was queued.
      if (row && String(row.values[idx['Status']]) === 'Subscribed') {
        var name = String(row.values[idx['Name']] || '');
        var t = emailCampaign_(name, email, q.subject, q.html);
        var res = send_(email, q.subject, t.html, t.text);
        setCells_(sh, row.row, idx, {
          'Campaigns Sent': (Number(row.values[idx['Campaigns Sent']]) || 0) + 1,
          'Last Campaign': clip_(q.subject, MAX.subject),
          'Last Campaign At': new Date(),
          'Last Error': res.ok ? '' : clip_(res.error, 300)
        });
        logLine_('campaign', email, q.subject, res.ok ? 'Sent' : 'Failed', res.error || '', res.provider);
        res.ok ? sent++ : failed++;
        left--;
      }
      q.cursor++;
    }

    if (q.cursor >= q.emails.length) props.deleteProperty('CAMPAIGN');
    else props.setProperty('CAMPAIGN', JSON.stringify(q));

    return { ok: true, sent: sent, failed: failed, remaining: Math.max(0, q.emails.length - q.cursor) };
  } finally {
    lock.releaseLock();
  }
}

function recipients_(audience) {
  var sh = sheetFor_(SHEET_LIST, COLS);
  var idx = headerIndex_(sh);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  var out = [], seen = {};
  for (var i = 0; i < values.length; i++) {
    var email = String(values[i][idx['Email']] || '');
    var status = String(values[i][idx['Status']] || '');
    if (!emailOk_(email) || seen[email]) continue;
    // Unsubscribed is always respected, whatever the audience asks for.
    if (status !== 'Subscribed') continue;
    if (audience === 'not_launched' && String(values[i][idx['Launch Email']] || '') === 'Sent') continue;
    seen[email] = 1;
    out.push(email);
  }
  return out;
}

/* ---------------------------- owner: read & edit -------------------------- */

function listRows_() {
  var sh = sheetFor_(SHEET_LIST, COLS);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var values = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  return values.map(function (v) {
    var o = {};
    for (var i = 0; i < head.length; i++) {
      if (!head[i]) continue;
      o[head[i]] = v[i] instanceof Date ? v[i].toISOString() : v[i];
    }
    return o;
  });
}

function stats_() {
  var sh = sheetFor_(SHEET_LIST, COLS);
  var idx = headerIndex_(sh);
  var props = PropertiesService.getScriptProperties();
  var s = {
    total: 0, subscribed: 0, unsubscribed: 0,
    week: 0, confirmFailed: 0, launchSent: 0, launchFailed: 0, launchPending: 0,
    launchAt: props.getProperty('LAUNCH_AT') || '',
    collectionUrl: props.getProperty('COLLECTION_URL') || '',
    provider: props.getProperty('RESEND_API_KEY') ? 'Resend' : 'Gmail (MailApp)',
    quotaLeft: mailQuota_(),
    serverNow: new Date().toISOString()
  };
  s.mode = launchPassed_(s.launchAt) ? 'launched' : 'waitlist';

  var pending = props.getProperty('CAMPAIGN');
  if (pending) {
    var q = JSON.parse(pending);
    s.campaign = { subject: q.subject, sent: q.cursor, total: q.emails.length, queuedAt: q.queuedAt };
  }

  var last = sh.getLastRow();
  if (last < 2) return s;
  var values = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  var weekAgo = Date.now() - 7 * 864e5;
  for (var i = 0; i < values.length; i++) {
    var v = values[i];
    if (!String(v[idx['Email']] || '')) continue;
    s.total++;
    var sub = String(v[idx['Status']]) === 'Subscribed';
    sub ? s.subscribed++ : s.unsubscribed++;
    var ts = v[idx['Timestamp']];
    if (ts instanceof Date && ts.getTime() >= weekAgo) s.week++;
    if (String(v[idx['Confirm Email']]) === 'Failed') s.confirmFailed++;
    var le = String(v[idx['Launch Email']] || '');
    if (le === 'Sent') s.launchSent++;
    else if (le === 'Failed') s.launchFailed++;
    else if (sub) s.launchPending++;
  }
  return s;
}

function configSet_(p) {
  var props = PropertiesService.getScriptProperties();
  if (p.launchAt !== undefined) {
    var raw = String(p.launchAt || '').trim();
    if (raw) {
      var t = Date.parse(raw);
      if (isNaN(t)) return { ok: false, error: 'launchAt must be an ISO 8601 instant' };
      props.setProperty('LAUNCH_AT', new Date(t).toISOString());
    } else {
      props.setProperty('LAUNCH_AT', '');   // back to "no date set"
    }
  }
  if (p.collectionUrl !== undefined) {
    var u = String(p.collectionUrl || '').trim();
    if (u && !/^https?:\/\//i.test(u)) return { ok: false, error: 'collectionUrl must be a full URL' };
    props.setProperty('COLLECTION_URL', u);
  }
  return { ok: true, stats: stats_() };
}

function resend_(p) {
  var email = normEmail_(p.email);
  var sh = sheetFor_(SHEET_LIST, COLS);
  var idx = headerIndex_(sh);
  var found = findRow_(sh, idx, email);
  if (!found) return { ok: false, error: 'not_found' };
  if (String(found.values[idx['Status']]) !== 'Subscribed') return { ok: false, error: 'unsubscribed' };
  var name = String(found.values[idx['Name']] || '');

  if (String(p.type || 'confirm') === 'launch') {
    var tl = emailLaunch_(name, email);
    var rl = send_(email, tl.subject, tl.html, tl.text);
    setCells_(sh, found.row, idx, {
      'Launch Email': rl.ok ? 'Sent' : 'Failed', 'Launch At': new Date(),
      'Last Error': rl.ok ? '' : clip_(rl.error, 300)
    });
    logLine_('launch-resend', email, tl.subject, rl.ok ? 'Sent' : 'Failed', rl.error || '', rl.provider);
    return { ok: rl.ok, error: rl.error || '' };
  }
  sendConfirm_(sh, found.row, idx, name, email);
  return { ok: true };
}

function remove_(p) {
  var email = normEmail_(p.email);
  var sh = sheetFor_(SHEET_LIST, COLS);
  var idx = headerIndex_(sh);
  var found = findRow_(sh, idx, email);
  if (!found) return { ok: false, error: 'not_found' };
  setCells_(sh, found.row, idx, { 'Status': 'Unsubscribed', 'Unsubscribed At': new Date() });
  logLine_('unsubscribe', email, '', 'Sent', 'removed from the owner portal', '');
  return { ok: true };
}

/* ------------------------------ unsubscribe ------------------------------- */

function unsubToken_(email) {
  var secret = PropertiesService.getScriptProperties().getProperty('UNSUB_SECRET') || 'unset';
  var sig = Utilities.computeHmacSha256Signature(email, secret);
  return sig.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('').slice(0, 32);
}

function unsubscribeUrl_(email) {
  return ScriptApp.getService().getUrl() + '?action=unsubscribe&e=' +
    encodeURIComponent(email) + '&t=' + unsubToken_(email);
}

function unsubscribePage_(p) {
  var email = normEmail_(p.e);
  var ok = email && String(p.t || '') === unsubToken_(email);
  var body, title;

  if (!ok) {
    title = 'Link expired';
    body = 'This unsubscribe link could not be verified. Write to us and we will take you off the list by hand.';
  } else {
    var sh = sheetFor_(SHEET_LIST, COLS);
    var idx = headerIndex_(sh);
    var found = findRow_(sh, idx, email);
    if (found) {
      setCells_(sh, found.row, idx, { 'Status': 'Unsubscribed', 'Unsubscribed At': new Date() });
      logLine_('unsubscribe', email, '', 'Sent', 'one-click link', '');
    }
    title = 'You are unsubscribed';
    body = '<b>' + esc_(email) + '</b> has been removed from the Vedam waitlist. ' +
           'You will not receive launch or collection emails from us again. ' +
           'If this was a mistake, you are welcome to join the waitlist again at any time.';
  }

  var site = PropertiesService.getScriptProperties().getProperty('SITE_URL') || '';
  var html =
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="robots" content="noindex"><title>' + esc_(title) + ' — Vedam</title></head>' +
    '<body style="margin:0;background:#57131A;color:#F0E1BE;font:17px/1.7 Georgia,\'Times New Roman\',serif;' +
    'display:flex;align-items:center;justify-content:center;min-height:100vh;padding:28px">' +
    '<div style="max-width:560px;text-align:center">' +
    '<div style="display:flex;align-items:center;justify-content:center;gap:14px;margin-bottom:26px">' +
    '<div style="width:54px;height:1px;background:#C9A15C;opacity:.6"></div>' +
    '<div style="width:7px;height:7px;background:#C9A15C;transform:rotate(45deg)"></div>' +
    '<div style="width:54px;height:1px;background:#C9A15C;opacity:.6"></div></div>' +
    '<div style="font-size:34px;letter-spacing:.34em;margin-left:.34em;color:#F0E1BE">VEDAM</div>' +
    '<h1 style="font-weight:400;font-size:24px;letter-spacing:.06em;margin:30px 0 14px;color:#F0E1BE">' + esc_(title) + '</h1>' +
    '<p style="color:rgba(240,225,190,.82);margin:0 0 28px">' + body + '</p>' +
    (site ? '<a href="' + esc_(site) + '" style="display:inline-block;font:11px/1 \'Jost\',Helvetica,Arial,sans-serif;' +
      'letter-spacing:.3em;text-transform:uppercase;color:#F3E6C8;background:#6A0F0C;border:1.5px solid #C9A15C;' +
      'padding:15px 32px;text-decoration:none">Visit Vedam</a>' : '') +
    '</div></body></html>';

  return HtmlService.createHtmlOutput(html)
    .setTitle(title + ' — Vedam')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/* -------------------------------- mailer ---------------------------------- */
/**
 * One door for every outgoing message, so confirmation, launch and campaign
 * mail all share the provider, the logging and the failure shape.
 * Returns { ok, error, provider }.
 */
function send_(to, subject, html, text) {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('RESEND_API_KEY');
  var fromName = props.getProperty('FROM_NAME') || 'Vedam';
  var replyTo = props.getProperty('REPLY_TO') || '';

  if (key) {
    var from = props.getProperty('MAIL_FROM');
    if (!from) return { ok: false, error: 'MAIL_FROM is not set (required with RESEND_API_KEY)', provider: 'Resend' };
    try {
      var res = UrlFetchApp.fetch('https://api.resend.com/emails', {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + key },
        payload: JSON.stringify({
          from: from, to: [to], subject: subject, html: html, text: text,
          reply_to: replyTo || undefined
        }),
        muteHttpExceptions: true
      });
      var code = res.getResponseCode();
      if (code >= 200 && code < 300) return { ok: true, provider: 'Resend' };
      return { ok: false, error: 'Resend ' + code + ': ' + res.getContentText().slice(0, 200), provider: 'Resend' };
    } catch (e) {
      return { ok: false, error: 'Resend: ' + e.message, provider: 'Resend' };
    }
  }

  try {
    var sendAs = sendAs_();
    if (sendAs) {
      var gopts = { htmlBody: html, name: fromName, from: sendAs };
      if (replyTo) gopts.replyTo = replyTo;
      GmailApp.sendEmail(to, subject, text, gopts);
    } else {
      var opts = { to: to, subject: subject, htmlBody: html, body: text, name: fromName };
      if (replyTo) opts.replyTo = replyTo;
      MailApp.sendEmail(opts);
    }
    return { ok: true, provider: 'Gmail' };
  } catch (e) {
    return { ok: false, error: 'Gmail: ' + e.message, provider: 'Gmail' };
  }
}

/**
 * SEND_AS is a "Send mail as" address on the Gmail account that owns this
 * script (Gmail ▸ Settings ▸ Accounts and Import). It is used only once Gmail
 * lists it as a verified alias; until then mail goes out from the owning
 * account exactly as before, so setting the property early breaks nothing.
 * Looked up once per execution — a launch batch sends dozens of messages.
 */
var sendAsCache_;
function sendAs_() {
  if (sendAsCache_ !== undefined) return sendAsCache_;
  var want = String(PropertiesService.getScriptProperties().getProperty('SEND_AS') || '').trim().toLowerCase();
  sendAsCache_ = '';
  if (!want) return sendAsCache_;
  try {
    GmailApp.getAliases().forEach(function (a) { if (String(a).toLowerCase() === want) sendAsCache_ = want; });
  } catch (e) {}
  return sendAsCache_;
}

/** Run once from the editor after setting SEND_AS: it asks for the Gmail
 *  permission GmailApp needs, then logs whether the alias is usable. */
function checkSendAs() {
  var want = PropertiesService.getScriptProperties().getProperty('SEND_AS') || '(not set)';
  Logger.log('SEND_AS: ' + want);
  Logger.log('Gmail aliases on this account: ' + JSON.stringify(GmailApp.getAliases()));
  Logger.log(sendAs_() ? 'OK: mail will be sent from ' + sendAs_() : 'Not active yet: mail still goes out from ' + Session.getEffectiveUser().getEmail());
}

function mailQuota_() {
  var key = PropertiesService.getScriptProperties().getProperty('RESEND_API_KEY');
  if (key) return -1;                       // Resend quota is not readable here
  try { return MailApp.getRemainingDailyQuota(); } catch (e) { return -1; }
}

function quotaLeft_() {
  var q = mailQuota_();
  return q === -1 || q > 0;
}

/* ----------------------------- email templates ---------------------------- */
/**
 * Email clients do not load web fonts, so these use Georgia/serif — the same
 * fallback the site already names after Prata and EB Garamond — on the brand
 * maroon with gold rules. Tables and inline styles only: that is what Gmail,
 * Outlook and Apple Mail all render the same way.
 */
function shell_(innerHtml, footerNote, email) {
  var props = PropertiesService.getScriptProperties();
  var site = props.getProperty('SITE_URL') || '';
  var unsub = email ? unsubscribeUrl_(email) : '';
  return '' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#57131A;margin:0;padding:0">' +
  '<tr><td align="center" style="padding:36px 16px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#F7ECDE;border:1px solid #C9A15C">' +
      '<tr><td align="center" style="background:#57131A;padding:34px 24px 30px">' +
        '<div style="font:34px/1 Georgia,\'Times New Roman\',serif;letter-spacing:.3em;color:#F0E1BE;margin-left:.3em">VEDAM</div>' +
        '<div style="font:italic 14px/1.6 Georgia,serif;color:rgba(240,225,190,.75);margin-top:12px">Tradition Reimagined</div>' +
      '</td></tr>' +
      '<tr><td style="padding:40px clamp(20px,6vw,46px) 36px;font:17px/1.75 Georgia,\'Times New Roman\',serif;color:#4A0F14">' +
        innerHtml +
      '</td></tr>' +
      '<tr><td style="background:#4A0F14;padding:24px 28px;font:12px/1.7 Helvetica,Arial,sans-serif;color:rgba(243,230,200,.72)" align="center">' +
        (footerNote ? '<div style="margin-bottom:10px">' + footerNote + '</div>' : '') +
        (site ? '<div style="margin-bottom:8px"><a href="' + esc_(site) + '" style="color:#C9A15C;text-decoration:none">' + esc_(site.replace(/^https?:\/\//, '').replace(/\/$/, '')) + '</a></div>' : '') +
        '<div>© ' + new Date().getFullYear() + ' Vedam · Made with love in India</div>' +
        (unsub ? '<div style="margin-top:10px"><a href="' + esc_(unsub) + '" style="color:rgba(243,230,200,.6)">Unsubscribe</a> · you are receiving this because you joined the Vedam waitlist.</div>' : '') +
      '</td></tr>' +
    '</table>' +
  '</td></tr></table>';
}

function btn_(href, label) {
  return '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:30px auto 8px"><tr>' +
    '<td align="center" style="background:#6A0F0C;border:1.5px solid #C9A15C">' +
    '<a href="' + esc_(href) + '" style="display:inline-block;padding:16px 36px;font:11px/1 Helvetica,Arial,sans-serif;' +
    'letter-spacing:.3em;text-transform:uppercase;color:#F3E6C8;text-decoration:none">' + esc_(label) + '</a>' +
    '</td></tr></table>';
}

function rule_() {
  return '<div style="text-align:center;margin:26px 0 22px;color:#C9A15C;font-size:13px;letter-spacing:.6em">◆</div>';
}

function firstName_(name) {
  var n = String(name || '').trim().split(/\s+/)[0] || '';
  return n ? n : 'there';
}

function emailConfirm_(name, email) {
  var props = PropertiesService.getScriptProperties();
  var launchAt = props.getProperty('LAUNCH_AT') || '';
  var when = launchAt ? prettyDate_(launchAt) : '';
  var subject = 'You are on the Vedam waitlist';

  var inner =
    '<p style="margin:0 0 18px">Dear ' + esc_(firstName_(name)) + ',</p>' +
    '<p style="margin:0 0 18px">Thank you for joining the Vedam waitlist. Your place is held.</p>' +
    '<p style="margin:0 0 18px">Vedam is open now — you can explore every collection today. ' +
    'What opens later is <b>ordering</b>, and this list is how you will hear of it.</p>' +
    '<p style="margin:0 0 18px">Every Vedam piece is made by hand — real zari, zardozi, handloom silk — ' +
    'so the first collection opens in a limited number. ' +
    (when ? 'Order placements open on <b>' + esc_(when) + '</b>' : 'You will hear from us the moment it opens') +
    ', and you will hear from us before it is announced anywhere else.</p>' +
    rule_() +
    '<p style="margin:0;font-style:italic;color:#6B4A41">Nothing is needed from you until then. ' +
    'We will write once when ordering opens, and only occasionally after that.</p>';

  var text = 'Dear ' + firstName_(name) + ',\n\n' +
    'Thank you for joining the Vedam waitlist. Your place is held.\n\n' +
    'Vedam is open now — you can explore every collection today. What opens later is ' +
    'ordering, and this list is how you will hear of it.\n\n' +
    'Every Vedam piece is made by hand, so the first collection opens in a limited number. ' +
    (when ? 'Order placements open on ' + when : 'You will hear from us the moment it opens') +
    ', and you will hear from us before it is announced anywhere else.\n\n' +
    'Unsubscribe: ' + unsubscribeUrl_(email) + '\n— Vedam';

  return { subject: subject, html: shell_(inner, 'You joined the Vedam waitlist to be told when ordering opens.', email), text: text };
}

function emailLaunch_(name, email) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('COLLECTION_URL') || props.getProperty('SITE_URL') || '';
  var subject = 'Ordering is now open at Vedam';

  var inner =
    '<p style="margin:0 0 18px">Dear ' + esc_(firstName_(name)) + ',</p>' +
    '<p style="margin:0 0 18px">Ordering is now open. You are hearing it first ' +
    'because you were on the waitlist — nobody outside it has been written to.</p>' +
    '<p style="margin:0 0 6px">Each piece is made to order for one person. ' +
    'Reserve the one you want and we will write to you about fabric, measurements and timeline.</p>' +
    (url ? btn_(url, 'Place your order') : '') +
    rule_() +
    '<p style="margin:0;font-style:italic;color:#6B4A41">Thank you for waiting with us.</p>';

  var text = 'Dear ' + firstName_(name) + ',\n\n' +
    'Ordering is now open. You are hearing it first because you were on the waitlist — ' +
    'nobody outside it has been written to.\n\n' + (url ? url + '\n\n' : '') +
    'Unsubscribe: ' + unsubscribeUrl_(email) + '\n— Vedam';

  return { subject: subject, html: shell_(inner, 'Ordering is open at Vedam.', email), text: text };
}

/**
 * Campaign bodies are written by the owner in the portal. The portal sends
 * plain paragraphs; anything that looks like a tag is escaped, so a stray
 * "<" in the copy can never break the email or inject markup.
 */
function emailCampaign_(name, email, subject, body) {
  var paras = String(body).replace(/\r\n/g, '\n').split(/\n{2,}/).map(function (p) {
    return '<p style="margin:0 0 18px">' + esc_(p.trim()).replace(/\n/g, '<br>') + '</p>';
  }).join('');

  var inner = '<p style="margin:0 0 18px">Dear ' + esc_(firstName_(name)) + ',</p>' + paras;
  var text = 'Dear ' + firstName_(name) + ',\n\n' + String(body) +
    '\n\nUnsubscribe: ' + unsubscribeUrl_(email) + '\n— Vedam';
  return { subject: subject, html: shell_(inner, '', email), text: text };
}

function prettyDate_(iso) {
  // The launch is announced in IST, so that is the clock every email quotes.
  // Override with a DISPLAY_TZ script property if that ever changes.
  var tz = PropertiesService.getScriptProperties().getProperty('DISPLAY_TZ') || 'Asia/Kolkata';
  try {
    return Utilities.formatDate(new Date(iso), tz, "d MMMM yyyy 'at' h:mm a") +
      ' (' + Utilities.formatDate(new Date(iso), tz, 'zzz') + ')';
  } catch (e) { return iso; }
}

/* -------------------------------- plumbing -------------------------------- */

function sheetFor_(name, cols) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.appendRow(cols);
    sh.getRange(1, 1, 1, cols.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  } else {
    // Add any column this version of the script knows about and the sheet does not.
    var head = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0];
    var missing = cols.filter(function (c) { return head.indexOf(c) === -1; });
    if (missing.length) {
      sh.getRange(1, head.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
    }
  }
  return sh;
}

function headerIndex_(sh) {
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var idx = {};
  for (var i = 0; i < head.length; i++) if (head[i]) idx[head[i]] = i;
  return idx;
}

function findRow_(sh, idx, email) {
  var last = sh.getLastRow();
  if (last < 2) return null;
  var col = idx['Email'] + 1;
  var emails = sh.getRange(2, col, last - 1, 1).getValues();
  for (var i = 0; i < emails.length; i++) {
    if (normEmail_(emails[i][0]) === email) {
      return { row: i + 2, values: sh.getRange(i + 2, 1, 1, sh.getLastColumn()).getValues()[0] };
    }
  }
  return null;
}

function emailRowMap_(sh, idx) {
  var last = sh.getLastRow();
  var map = {};
  if (last < 2) return map;
  var values = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  for (var i = 0; i < values.length; i++) {
    var e = normEmail_(values[i][idx['Email']]);
    if (e && !map[e]) map[e] = { row: i + 2, values: values[i] };
  }
  return map;
}

/** Writes named cells of one row in as few range calls as possible. */
function setCells_(sh, row, idx, patch) {
  Object.keys(patch).forEach(function (name) {
    if (idx[name] === undefined) return;
    var v = patch[name];
    sh.getRange(row, idx[name] + 1).setValue(typeof v === 'string' ? safeCell_(v) : v);
  });
}

function logLine_(type, email, subject, status, detail, provider) {
  try {
    var sh = sheetFor_(SHEET_LOG, LOG_COLS);
    sh.appendRow([new Date(), type, safeCell_(email), safeCell_(clip_(subject, 200)),
                  status, safeCell_(clip_(detail, 400)), provider || '']);
    // Keep the log from growing without bound: trim the oldest rows past 5,000.
    var last = sh.getLastRow();
    if (last > 5001) sh.deleteRows(2, last - 5001);
  } catch (e) { /* logging must never break a send */ }
}

function parseBody_(e) {
  var p = {};
  if (e && e.parameter) for (var k in e.parameter) p[k] = e.parameter[k];
  var raw = e && e.postData && e.postData.contents;
  if (raw && raw.charAt(0) === '{') {
    try {
      var j = JSON.parse(raw);
      for (var k2 in j) p[k2] = j[k2];
    } catch (err) { /* keep the form-encoded view */ }
  }
  return p;
}

function tokenOk_(given) {
  var want = PropertiesService.getScriptProperties().getProperty('ADMIN_TOKEN') || '';
  given = String(given || '');
  if (!want || given.length !== want.length) return false;
  var diff = 0;
  for (var i = 0; i < want.length; i++) diff |= given.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

function launchPassed_(iso) {
  if (!iso) return false;
  var t = Date.parse(iso);
  return !isNaN(t) && Date.now() >= t;
}


// JSON only, and deliberately no JSONP: a ?callback= parameter would let any
// third-party page read this endpoint through a <script> tag, bypassing CORS.
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function clip_(v, n) { return String(v == null ? '' : v).trim().slice(0, n); }

/**
 * Google Sheets reads a cell starting with =, +, - or @ as a FORMULA. A phone
 * number like "+91 98765 43210" therefore lands in the sheet as #ERROR! and
 * the number is lost — which is every international number, so this is not an
 * edge case. A leading apostrophe forces the cell to text; Sheets strips it
 * again on read, so getValues() still returns the clean number.
 * It also closes the formula-injection hole: a subscriber cannot type a
 * HYPERLINK() or IMPORTRANGE() into a field and have it execute in the
 * owner's spreadsheet.
 */
function safeCell_(v) {
  var s = String(v == null ? '' : v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}
function normEmail_(v) { return clip_(v, MAX.email).toLowerCase(); }
function emailOk_(v) { return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(String(v || '')); }
function esc_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function isoOf_(v) { return v instanceof Date ? v.toISOString() : String(v || ''); }
function randomToken_(n) {
  var a = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  var out = '';
  for (var i = 0; i < n; i++) out += a.charAt(Math.floor(Math.random() * a.length));
  return out;
}
