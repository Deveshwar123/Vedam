/**
 * Vedam — Order Management backend
 * ===========================================================================
 * The master Orders spreadsheet and the server that owns it. Deployed as its
 * own Apps Script web app, separate from the waitlist, the fittings and the
 * inquiries scripts — one responsibility each.
 *
 * WHAT THIS IS THE RECORD OF
 * Vedam has no server of its own: the site is static files on GitHub Pages.
 * So this script IS the order database. The sheet is the authoritative copy,
 * this script is the only thing that writes to it, and the website reads
 * through it. There is no second database to drift out of sync with, and so
 * no sync loop to guard against — the problem is designed away rather than
 * managed.
 *
 * WHAT THE WEBSITE CAN AND CANNOT DO
 * Anything a browser sends can be forged, so the browser is never believed
 * about money or identity:
 *   • a customer's identity is proved by their Firebase ID token, which this
 *     script verifies with Google before returning a single order;
 *   • payment is proved by the payment provider calling us directly, never by
 *     the customer reaching a success page.
 *
 * ---------------------------------------------------------------------------
 * SETUP (one time)
 * ---------------------------------------------------------------------------
 *  1. Create a Google Sheet called "Vedam Orders".
 *  2. Extensions → Apps Script, paste this file, save.
 *  3. Run `setupVedamOrders` once and authorise it. It builds the Orders
 *     sheet — headers, dropdowns, conditional formatting, frozen row,
 *     filter, date formats, and protection on the columns the system owns —
 *     and installs the triggers.
 *     The execution log prints the ADMIN TOKEN and the SITE KEY.
 *  4. Deploy → New deployment → Web app: Execute as **Me**,
 *     Who has access **Anyone**. Copy the /exec URL.
 *  5. Put that URL in orders-config.js on the site.
 *
 * REMEMBER: editing this file changes nothing until you publish a NEW VERSION
 * of the deployment (Deploy → Manage deployments → pencil → New version).
 *
 * ---------------------------------------------------------------------------
 * SECRETS — Script Properties only, never in the repo
 * ---------------------------------------------------------------------------
 *   ADMIN_TOKEN        owner-only actions
 *   FIREBASE_API_KEY   public web key, used to verify customer ID tokens
 *   SITE_URL           used in email links
 *   PAY_PROVIDER       'manual' (default) | 'phonepe'
 *   PHONEPE_MERCHANT_ID / PHONEPE_SALT_KEY / PHONEPE_SALT_INDEX
 *   UPI_ID, BANK_DETAILS   shown at checkout while PAY_PROVIDER is 'manual'
 *   PROD_CAPACITY_PER_WEEK / PROD_DAYS_PER_PIECE / SHIP_DAYS
 *                      the delivery estimate settings, changeable any time
 * ===========================================================================
 */

/* ------------------------------- configuration --------------------------- */

var SHEET_ORDERS = 'Orders';
var SHEET_AUDIT  = 'Audit';          // not order data: a log of what changed

/** The master columns, in the order the owner asked for them. */
var COLS = [
  'Order ID',                    // system
  'Order Date',                  // system
  'Customer Name',               // system
  'Customer Email',              // system
  'Phone Number',                // system
  'Shipping Address',            // system
  'Products Ordered',            // system
  'Size',                        // system (measurements, one block per piece)
  'Customization Details',       // system
  'Quantity',                    // system
  'Total Amount',                // system
  'Payment Method',              // system
  'Payment Status',              // OWNER EDITS (dropdown)
  'Payment Confirmation Date',   // system
  'Queue Position',              // system (calculated)
  'Order Status',                // OWNER EDITS (dropdown)
  'Estimated Delivery Date',     // OWNER MAY OVERRIDE
  'Tracking Number',             // OWNER EDITS
  'Courier',                     // OWNER EDITS
  'Last Updated',                // system
  // Hidden, system-owned. Developer metadata would have been tidier, but
  // Apps Script only allows it on a whole row/column/sheet, and the live
  // first order died on exactly that. A hidden column has no such rule,
  // travels with the row when the sheet is sorted, and can be read back
  // without a second API call.
  'Order Data',                  // system — the structured order, as JSON
  'ETA Source'                   // system — 'auto' or 'manual'
];

/** Columns the owner is meant to edit. Everything else is protected. */
var OWNER_EDITABLE = ['Payment Status', 'Order Status', 'Estimated Delivery Date',
                      'Tracking Number', 'Courier'];

var PAYMENT_STATUSES = ['Pending', 'Paid', 'Failed', 'Refunded'];

var STATUSES = ['Payment Pending', 'Payment Confirmed', 'In Queue', 'Production Started',
                'Quality Check', 'Ready to Ship', 'Shipped', 'Delivered', 'Cancelled'];

/** The stages a customer's progress tracker shows, in order. */
var TRACKER = ['Payment Confirmed', 'In Queue', 'Production Started',
               'Quality Check', 'Ready to Ship', 'Shipped', 'Delivered'];

/** Statuses that occupy a place in the production queue. Shipped, Delivered
 *  and Cancelled are done with the workroom and stop counting. */
var ACTIVE_IN_QUEUE = ['Payment Confirmed', 'In Queue', 'Production Started',
                       'Quality Check', 'Ready to Ship'];

/** Which status changes are worth emailing a customer about. */
var STATUS_EMAILS = {
  'Payment Confirmed': true, 'Production Started': true, 'Quality Check': true,
  'Ready to Ship': true, 'Shipped': true, 'Delivered': true
};

var AUDIT_COLS = ['Timestamp', 'Order ID', 'Field', 'From', 'To', 'By', 'Note'];

var MAX = { name: 100, email: 200, phone: 30, address: 500, notes: 2000, items: 8000 };

/* ---------------------------------- setup -------------------------------- */

/** Run once from the editor. Safe to re-run. */
function setupVedamOrders() {
  var props = PropertiesService.getScriptProperties();
  var sh = ordersSheet_();
  sheetFor_(SHEET_AUDIT, AUDIT_COLS);

  if (!props.getProperty('ADMIN_TOKEN')) props.setProperty('ADMIN_TOKEN', randomToken_(32));
  if (!props.getProperty('SITE_KEY'))    props.setProperty('SITE_KEY', randomToken_(24));
  if (!props.getProperty('SITE_URL'))    props.setProperty('SITE_URL', 'https://deveshwar123.github.io/Vedam/');
  if (!props.getProperty('PAY_PROVIDER')) props.setProperty('PAY_PROVIDER', 'manual');
  if (!props.getProperty('FIREBASE_API_KEY')) {
    props.setProperty('FIREBASE_API_KEY', 'AIzaSyCxZ4K17JB8ZQtcF9kD-X8HOi1XKwbKFU8');
  }
  // Delivery estimate settings — changeable here, never hard-coded in logic.
  if (!props.getProperty('PROD_CAPACITY_PER_WEEK')) props.setProperty('PROD_CAPACITY_PER_WEEK', '3');
  if (!props.getProperty('PROD_DAYS_PER_PIECE'))    props.setProperty('PROD_DAYS_PER_PIECE', '21');
  if (!props.getProperty('SHIP_DAYS'))              props.setProperty('SHIP_DAYS', '5');

  formatOrdersSheet_(sh);
  installTriggers_();

  Logger.log('— Vedam Orders ready —');
  Logger.log('ADMIN TOKEN: ' + props.getProperty('ADMIN_TOKEN'));
  Logger.log('SITE KEY:    ' + props.getProperty('SITE_KEY'));
  Logger.log('Deploy as a web app next, then put the /exec URL in orders-config.js.');
  return 'ok';
}

function installTriggers_() {
  var have = {};
  ScriptApp.getProjectTriggers().forEach(function (t) { have[t.getHandlerFunction()] = true; });
  if (!have['onOrdersEdit']) {
    ScriptApp.newTrigger('onOrdersEdit')
      .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet()).onEdit().create();
  }
  if (!have['ordersTick']) {
    ScriptApp.newTrigger('ordersTick').timeBased().everyMinutes(15).create();
  }
}

/** Dropdowns, colours, frozen header, filter, date formats, protection. */
function formatOrdersSheet_(sh) {
  var idx = headerIndex_(sh);
  var last = Math.max(sh.getMaxRows(), 500);

  sh.setFrozenRows(1);
  sh.setFrozenColumns(1);                       // Order ID always in view
  sh.getRange(1, 1, 1, COLS.length)
    .setFontWeight('bold').setBackground('#4A0F14').setFontColor('#F3E6C8')
    .setVerticalAlignment('middle').setWrap(true);
  sh.setRowHeight(1, 34);

  var col = function (name) { return idx[name] + 1; };

  // Dropdowns on the two fields the owner drives.
  sh.getRange(2, col('Order Status'), last - 1, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true)
      .setAllowInvalid(false)
      .setHelpText('Pick a stage. Changing this updates the customer and may email them.')
      .build());
  sh.getRange(2, col('Payment Status'), last - 1, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(PAYMENT_STATUSES, true)
      .setAllowInvalid(false)
      .setHelpText('Set to Paid to confirm a UPI or bank transfer. That puts the order in the queue.')
      .build());

  // Consistent dates.
  ['Order Date', 'Payment Confirmation Date', 'Last Updated'].forEach(function (n) {
    sh.getRange(2, col(n), last - 1, 1).setNumberFormat('dd MMM yyyy  HH:mm');
  });
  sh.getRange(2, col('Estimated Delivery Date'), last - 1, 1).setNumberFormat('dd MMM yyyy');
  sh.getRange(2, col('Total Amount'), last - 1, 1).setNumberFormat('"₹"#,##0');

  // Readable widths; the long free-text columns wrap rather than sprawl.
  sh.setColumnWidth(col('Order ID'), 110);
  [['Products Ordered', 260], ['Size', 240], ['Customization Details', 240],
   ['Shipping Address', 240]].forEach(function (p) {
    sh.setColumnWidth(col(p[0]), p[1]);
    sh.getRange(2, col(p[0]), last - 1, 1).setWrap(true).setVerticalAlignment('top');
  });

  // Colour that reads at a glance: money first, then the workroom.
  var rules = [];
  var band = function (rangeName, value, bg, fg) {
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(value)
      .setBackground(bg).setFontColor(fg || '#3A1210')
      .setRanges([sh.getRange(2, col(rangeName), last - 1, 1)]).build());
  };
  band('Payment Status', 'Pending', '#FFF3CD');
  band('Payment Status', 'Paid', '#D7EBD8');
  band('Payment Status', 'Failed', '#F8D7DA');
  band('Payment Status', 'Refunded', '#E2E3E5');
  band('Order Status', 'Payment Pending', '#FFF3CD');
  band('Order Status', 'Payment Confirmed', '#E8F0FE');
  band('Order Status', 'In Queue', '#E8F0FE');
  band('Order Status', 'Production Started', '#FDE8D7');
  band('Order Status', 'Quality Check', '#FDE8D7');
  band('Order Status', 'Ready to Ship', '#E6E0F8');
  band('Order Status', 'Shipped', '#D7EBD8');
  band('Order Status', 'Delivered', '#CDE7CF');
  band('Order Status', 'Cancelled', '#E2E3E5');
  sh.setConditionalFormatRules(rules);

  // The two system columns are for the machine, not the owner.
  ['Order Data', 'ETA Source'].forEach(function (n) {
    if (idx[n] !== undefined) sh.hideColumns(idx[n] + 1);
  });

  if (!sh.getFilter()) sh.getRange(1, 1, last, COLS.length).createFilter();

  // Protect what the system owns, leaving the owner's five columns open.
  sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(function (p) {
    if (p.getDescription() === 'Vedam system columns') p.remove();
  });
  var me = Session.getEffectiveUser();
  COLS.forEach(function (name) {
    if (OWNER_EDITABLE.indexOf(name) !== -1) return;
    var p = sh.getRange(2, idx[name] + 1, last - 1, 1).protect()
      .setDescription('Vedam system columns')
      .setWarningOnly(true);   // a warning, not a lock: the owner stays in control
  });
}

/* ----------------------------------- doGet -------------------------------- */
/**
 * Public, no secrets returned:
 *   ?action=ping       → { ok:true } so the site can tell the backend is up
 *   ?action=settings   → payment method on offer + delivery estimate inputs
 * Everything that touches an order is a POST.
 */
function doGet(e) {
  var p = (e && e.parameter) || {};
  var props = PropertiesService.getScriptProperties();
  if (p.action === 'settings') {
    return json_({
      ok: true,
      payProvider: props.getProperty('PAY_PROVIDER') || 'manual',
      upiId: props.getProperty('UPI_ID') || '',
      bankDetails: props.getProperty('BANK_DETAILS') || '',
      capacityPerWeek: Number(props.getProperty('PROD_CAPACITY_PER_WEEK') || 3),
      daysPerPiece: Number(props.getProperty('PROD_DAYS_PER_PIECE') || 21),
      shipDays: Number(props.getProperty('SHIP_DAYS') || 5),
      serverNow: new Date().toISOString()
    });
  }
  return json_({ ok: true, service: 'vedam-orders' });
}

/* ---------------------------------- doPost -------------------------------- */
/**
 * Customer actions — require a Firebase ID token, verified with Google:
 *   place_order   { idToken, items[], address, phone, name, paymentMethod }
 *   my_orders     { idToken }
 *   order         { idToken, orderId }
 *
 * Owner actions — require the admin token:
 *   list | stats | confirm_payment | set_status | recalc
 *
 * Payment provider:
 *   pay_webhook   called by the provider, verified by signature. Never by a browser.
 */
function doPost(e) {
  var p = parseBody_(e);
  var action = String(p.action || '');

  try {
    switch (action) {
      case 'place_order': return json_(placeOrder_(p));
      case 'my_orders':   return json_(myOrders_(p));
      case 'order':       return json_(oneOrder_(p));
      case 'pay_webhook': return json_(payWebhook_(p, e));
    }

    if (!tokenOk_(p.token)) {
      Utilities.sleep(400);
      return json_({ ok: false, error: 'unauthorized' });
    }
    switch (action) {
      case 'list':            return json_({ ok: true, rows: listOrders_(), stats: stats_() });
      case 'stats':           return json_({ ok: true, stats: stats_() });
      case 'confirm_payment': return json_(confirmPayment_(p.orderId, 'owner'));
      case 'set_status':      return json_(setStatus_(p.orderId, p.status, 'owner'));
      case 'recalc':          return json_(recalcAll_());
    }
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

/* ------------------------- who is this, really? --------------------------- */
/**
 * The only thing that proves a customer's identity. The browser sends the
 * Firebase ID token it holds; Google tells us whose it is and whether it is
 * still valid. A forged token fails here, which is why My Orders can be
 * trusted to show one customer their own orders and nobody else's.
 */
function verifyCustomer_(idToken) {
  if (!idToken) return null;
  var key = PropertiesService.getScriptProperties().getProperty('FIREBASE_API_KEY');
  if (!key) return null;
  try {
    var res = UrlFetchApp.fetch(
      'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + encodeURIComponent(key),
      { method: 'post', contentType: 'application/json',
        payload: JSON.stringify({ idToken: String(idToken) }), muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;
    var u = (JSON.parse(res.getContentText()).users || [])[0];
    if (!u || !u.localId) return null;
    return { uid: u.localId, email: normEmail_(u.email), name: u.displayName || '' };
  } catch (err) {
    return null;
  }
}

/* ------------------------------ placing an order -------------------------- */

function placeOrder_(p) {
  var who = verifyCustomer_(p.idToken);
  if (!who) return { ok: false, error: 'sign_in_required' };

  var items = p.items;
  if (!Array.isArray(items) || !items.length) return { ok: false, error: 'empty_order' };
  if (items.length > 20) return { ok: false, error: 'too_many_items' };

  var name = clip_(p.name || who.name, MAX.name);
  var phone = clip_(p.phone, MAX.phone);
  var address = clip_(p.address, MAX.address);
  if (!name) return { ok: false, error: 'name_required' };
  if (!phone) return { ok: false, error: 'phone_required' };
  if (!address) return { ok: false, error: 'address_required' };

  // Prices come from the catalogue held here, never from the browser — a
  // customer editing the page cannot change what they are charged.
  var priced = [], total = 0;
  for (var i = 0; i < items.length; i++) {
    var it = items[i] || {};
    var cat = CATALOG[String(it.id)];
    if (!cat) return { ok: false, error: 'unknown_item:' + String(it.id).slice(0, 40) };
    var qty = Math.max(1, Math.min(10, parseInt(it.qty, 10) || 1));
    priced.push({
      id: String(it.id), name: cat.name, collection: cat.collection, price: cat.price, qty: qty,
      measurements: clip_(it.measurements, MAX.notes),
      customisation: clip_(it.customisation, MAX.notes)
    });
    total += cat.price * qty;
  }

  var method = String(p.paymentMethod || 'manual');
  if (['manual', 'upi', 'bank', 'phonepe', 'card'].indexOf(method) === -1) method = 'manual';

  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    // An idempotency key stops a double-tapped button or a retried request
    // from becoming two orders.
    var key = clip_(p.clientRef, 64);
    if (key) {
      var dupe = findByClientRef_(key);
      if (dupe) return { ok: true, duplicate: true, orderId: dupe.orderId, order: dupe.view };
    }

    var sh = ordersSheet_();
    var idx = headerIndex_(sh);
    var orderId = nextOrderId_(sh, idx);
    var now = new Date();

    var row = [];
    for (var c = 0; c < COLS.length; c++) row.push('');
    var put = function (n, v) { if (idx[n] !== undefined) row[idx[n]] = v; };
    put('Order ID', orderId);
    put('Order Date', now);
    put('Customer Name', safeCell_(name));
    put('Customer Email', safeCell_(who.email));
    put('Phone Number', safeCell_(phone));
    put('Shipping Address', safeCell_(address));
    put('Products Ordered', safeCell_(fmtProducts_(priced)));
    put('Size', safeCell_(fmtPerItem_(priced, 'measurements')));
    put('Customization Details', safeCell_(fmtPerItem_(priced, 'customisation')));
    put('Quantity', safeCell_(fmtQty_(priced)));
    put('Total Amount', total);
    put('Payment Method', safeCell_(labelForMethod_(method)));
    put('Payment Status', 'Pending');
    put('Order Status', 'Payment Pending');
    put('Queue Position', '');
    put('Last Updated', now);
    put('ETA Source', 'auto');
    sh.appendRow(row);

    // The machine-readable copy of the order lives in developer metadata on
    // the row, so the sheet stays human-readable while My Orders still gets
    // exact items, prices and measurements back.
    var r = sh.getLastRow();
    setMeta_(sh, r, { orderId: orderId, uid: who.uid, clientRef: key, items: priced, total: total });

    audit_(orderId, 'Order', '', 'placed', 'customer', method);
    var view = buildView_(sh, r, idx);
    sendOrderPlaced_(view);
    return { ok: true, orderId: orderId, order: view,
             payment: paymentInstructions_(view, method) };
  } finally {
    lock.releaseLock();
  }
}

/** VED-0001, VED-0002 … stable, never reused, independent of row order. */
function nextOrderId_(sh, idx) {
  var props = PropertiesService.getScriptProperties();
  var n = parseInt(props.getProperty('ORDER_SEQ') || '0', 10) || 0;
  // Reconcile with the sheet so a restored backup cannot hand out a used id.
  var last = sh.getLastRow();
  if (last > 1) {
    var ids = sh.getRange(2, idx['Order ID'] + 1, last - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      var m = /^VED-(\d+)$/.exec(String(ids[i][0] || '').trim());
      if (m) n = Math.max(n, parseInt(m[1], 10));
    }
  }
  n += 1;
  props.setProperty('ORDER_SEQ', String(n));
  return 'VED-' + ('0000' + n).slice(-4);
}

/* ------------------------------- formatting ------------------------------- */
/** One row per order; several pieces read as a numbered list inside the cell,
 *  and the same numbering is used by Size, Customization and Quantity so the
 *  four columns line up when read side by side. */
function fmtProducts_(items) {
  return items.map(function (it, i) {
    return '[' + (i + 1) + '] ' + it.name + ' — ' + inr_(it.price) + ' each';
  }).join('\n');
}
function fmtQty_(items) {
  return items.map(function (it, i) { return '[' + (i + 1) + '] × ' + it.qty; }).join('\n');
}
function fmtPerItem_(items, field) {
  return items.map(function (it, i) {
    return '[' + (i + 1) + '] ' + (it[field] ? it[field] : '—');
  }).join('\n');
}
function labelForMethod_(m) {
  return { manual: 'Bank transfer / UPI', upi: 'UPI', bank: 'Bank transfer',
           phonepe: 'PhonePe (online)', card: 'Card (online)' }[m] || m;
}

/* --------------------------- payment confirmation ------------------------- */
/**
 * The single door into the production queue. Nothing else sets Paid, and
 * nothing enters the queue without coming through here.
 */
function confirmPayment_(orderId, by) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var sh = ordersSheet_();
    var idx = headerIndex_(sh);
    var found = findRow_(sh, idx, orderId);
    if (!found) return { ok: false, error: 'not_found' };
    // "Already confirmed" is the presence of a confirmation TIMESTAMP, not
    // the word Paid in the status cell. When the owner confirms a transfer
    // by choosing Paid in the sheet, the cell already says Paid by the time
    // this runs — testing the status would make the system decide it had
    // nothing to do, and the order would never reach the queue.
    if (found.values[idx['Payment Confirmation Date']] instanceof Date) {
      return { ok: true, already: true };            // never confirm twice
    }
    var now = new Date();
    setCells_(sh, found.row, idx, {
      'Payment Status': 'Paid',
      'Payment Confirmation Date': now,
      'Order Status': 'Payment Confirmed',
      'Last Updated': now
    });
    audit_(orderId, 'Payment Status', 'Pending', 'Paid', by, '');
    recalcAll_();
    var view = buildView_(sh, findRow_(sh, idx, orderId).row, idx);
    sendStatusEmail_(view, 'Payment Confirmed');
    return { ok: true, order: view };
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------ the provider ------------------------------ */
/**
 * Called by the payment provider's servers, not by a browser. The signature
 * is what makes it believable: a customer cannot POST here and mark their own
 * order paid, because they cannot produce the signature without the salt key.
 *
 * PhonePe signs as sha256(base64Payload + '/pg/v1/status' + saltKey) + '###' + saltIndex.
 * Until PHONEPE_SALT_KEY is set, this endpoint refuses everything — which is
 * the safe default while the merchant account is still being opened.
 */
function payWebhook_(p, e) {
  var props = PropertiesService.getScriptProperties();
  var provider = props.getProperty('PAY_PROVIDER') || 'manual';
  if (provider !== 'phonepe') return { ok: false, error: 'online_payments_not_enabled' };

  var salt = props.getProperty('PHONEPE_SALT_KEY');
  var saltIndex = props.getProperty('PHONEPE_SALT_INDEX') || '1';
  if (!salt) return { ok: false, error: 'provider_not_configured' };

  var raw = (e && e.postData && e.postData.contents) || '';
  var header = '';
  try { header = (e.parameter && e.parameter.xverify) || p.xverify || ''; } catch (err) {}
  var body = p.response || '';                      // base64 payload from PhonePe
  if (!body || !header) return { ok: false, error: 'missing_signature' };

  var expect = sha256Hex_(body + salt) + '###' + saltIndex;
  if (!constantEquals_(expect, String(header))) {
    audit_('', 'Webhook', '', 'rejected', 'provider', 'bad signature');
    return { ok: false, error: 'bad_signature' };
  }

  var decoded;
  try { decoded = JSON.parse(Utilities.newBlob(Utilities.base64Decode(body)).getDataAsString()); }
  catch (err) { return { ok: false, error: 'bad_payload' }; }

  var d = decoded.data || {};
  var orderId = String(d.merchantTransactionId || '').trim();
  var paid = decoded.success === true && String(d.state || '').toUpperCase() === 'COMPLETED';
  if (!orderId) return { ok: false, error: 'no_order_ref' };

  if (!paid) {
    setFieldByOrder_(orderId, { 'Payment Status': 'Failed', 'Last Updated': new Date() });
    audit_(orderId, 'Payment Status', '', 'Failed', 'provider', String(d.state || ''));
    return { ok: true, status: 'failed' };
  }
  return confirmPayment_(orderId, 'provider');
}

function paymentInstructions_(view, method) {
  var props = PropertiesService.getScriptProperties();
  if ((props.getProperty('PAY_PROVIDER') || 'manual') === 'phonepe' &&
      (method === 'phonepe' || method === 'card')) {
    return { mode: 'online', note: 'You will be taken to PhonePe to pay.' };
  }
  return {
    mode: 'manual',
    upiId: props.getProperty('UPI_ID') || '',
    bankDetails: props.getProperty('BANK_DETAILS') || '',
    reference: view.orderId,
    note: 'Pay using the details above and quote ' + view.orderId +
          ' as the reference. We confirm by hand, usually within a day, and your ' +
          'place in the queue is taken from the moment we confirm it.'
  };
}

/* ------------------------------- the queue -------------------------------- */
/**
 * First come, first served, by the moment payment was CONFIRMED — not by when
 * the order was placed, and not by where the row happens to sit. Sorting the
 * sheet cannot change anybody's place, because position is derived from the
 * timestamps every time and written back keyed by Order ID.
 */
function recalcAll_() {
  var sh = ordersSheet_();
  var idx = headerIndex_(sh);
  var last = sh.getLastRow();
  if (last < 2) return { ok: true, queued: 0 };

  var values = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  var queue = [];
  for (var i = 0; i < values.length; i++) {
    var v = values[i];
    if (String(v[idx['Payment Status']]) !== 'Paid') continue;
    if (ACTIVE_IN_QUEUE.indexOf(String(v[idx['Order Status']])) === -1) continue;
    var t = v[idx['Payment Confirmation Date']];
    queue.push({ row: i + 2, at: (t instanceof Date) ? t.getTime() : 0,
                 id: String(v[idx['Order ID']]) });
  }
  queue.sort(function (a, b) { return a.at - b.at || (a.id < b.id ? -1 : 1); });

  var writes = {};
  queue.forEach(function (q, n) { writes[q.row] = n + 1; });

  for (var j = 0; j < values.length; j++) {
    var row = j + 2;
    var want = writes[row] || '';
    if (String(values[j][idx['Queue Position']]) !== String(want)) {
      sh.getRange(row, idx['Queue Position'] + 1).setValue(want);
    }
    // Refresh the estimate unless the owner has written their own.
    var est = estimateFor_(values[j], idx, writes[row]);
    if (est) {
      var cur = values[j][idx['Estimated Delivery Date']];
      if (!isManualEstimate_(sh, row) && (!(cur instanceof Date) || cur.getTime() !== est.getTime())) {
        sh.getRange(row, idx['Estimated Delivery Date'] + 1).setValue(est);
      }
    }
  }
  return { ok: true, queued: queue.length };
}

/**
 * Hybrid estimate: how many paid orders sit ahead, how much the workroom can
 * finish in a week, how long a piece takes, plus shipping. All four are
 * settings, so the estimate moves when the business does.
 */
function estimateFor_(v, idx, position) {
  if (!position) return null;
  var props = PropertiesService.getScriptProperties();
  var capacity = Math.max(1, Number(props.getProperty('PROD_CAPACITY_PER_WEEK') || 3));
  var days = Math.max(1, Number(props.getProperty('PROD_DAYS_PER_PIECE') || 21));
  var ship = Math.max(0, Number(props.getProperty('SHIP_DAYS') || 5));
  var from = v[idx['Payment Confirmation Date']];
  var start = (from instanceof Date) ? from.getTime() : Date.now();
  var waitWeeks = Math.floor((position - 1) / capacity);
  var total = waitWeeks * 7 + days + ship;
  return new Date(start + total * 864e5);
}

/* ---------------------------- status transitions -------------------------- */

function setStatus_(orderId, status, by) {
  if (STATUSES.indexOf(String(status)) === -1) return { ok: false, error: 'bad_status' };
  var sh = ordersSheet_();
  var idx = headerIndex_(sh);
  var found = findRow_(sh, idx, orderId);
  if (!found) return { ok: false, error: 'not_found' };
  var from = String(found.values[idx['Order Status']] || '');
  if (from === status) return { ok: true, unchanged: true };
  setCells_(sh, found.row, idx, { 'Order Status': status, 'Last Updated': new Date() });
  afterStatusChange_(orderId, from, status, by);
  return { ok: true };
}

/** Everything that must happen when a stage changes, wherever it came from. */
function afterStatusChange_(orderId, from, to, by) {
  audit_(orderId, 'Order Status', from, to, by, '');
  recalcAll_();
  var sh = ordersSheet_();
  var idx = headerIndex_(sh);
  var f = findRow_(sh, idx, orderId);
  if (!f) return;
  var view = buildView_(sh, f.row, idx);
  if (STATUS_EMAILS[to]) sendStatusEmail_(view, to);
}

/* ------------------------- the owner edits the sheet ---------------------- */
/**
 * The owner's main interface. An edit to Order Status, Payment Status,
 * Estimated Delivery Date, Courier or Tracking Number is picked up here.
 *
 * Deliberately narrow: an edit to any other cell does nothing at all, so
 * tidying a note or fixing a spelling can never email a customer.
 */
function onOrdersEdit(e) {
  try {
    if (!e || !e.range) return;
    var sh = e.range.getSheet();
    if (sh.getName() !== SHEET_ORDERS) return;
    var row = e.range.getRow();
    if (row < 2) return;
    var idx = headerIndex_(sh);
    var colName = null;
    for (var n in idx) if (idx[n] + 1 === e.range.getColumn()) colName = n;
    if (!colName || OWNER_EDITABLE.indexOf(colName) === -1) return;

    var orderId = String(sh.getRange(row, idx['Order ID'] + 1).getValue() || '').trim();
    if (!orderId) return;
    var before = e.oldValue === undefined ? '' : String(e.oldValue);
    var after = String(e.range.getValue() || '');
    if (before === after) return;                  // nothing actually changed

    sh.getRange(row, idx['Last Updated'] + 1).setValue(new Date());

    if (colName === 'Payment Status' && after === 'Paid' && before !== 'Paid') {
      confirmPayment_(orderId, 'owner (sheet)');
      return;
    }
    if (colName === 'Order Status') {
      afterStatusChange_(orderId, before, after, 'owner (sheet)');
      return;
    }
    if (colName === 'Estimated Delivery Date') {
      markManualEstimate_(sh, row);                // the owner's date now wins
      audit_(orderId, 'Estimated Delivery', before, after, 'owner (sheet)', 'manual override');
      var v1 = buildView_(sh, row, idx);
      sendEstimateChanged_(v1, before);
      return;
    }
    if (colName === 'Courier' || colName === 'Tracking Number') {
      audit_(orderId, colName, before, after, 'owner (sheet)', '');
      return;                                       // surfaces on the site; no email of its own
    }
  } catch (err) {
    try { audit_('', 'onEdit', '', 'error', 'system', String(err && err.message)); } catch (e2) {}
  }
}

/** A quarter-hourly safety net: keeps the queue and estimates honest even if
 *  an onEdit ever fails, and retries anything the audit log left unsent. */
function ordersTick() {
  try { recalcAll_(); } catch (e) { audit_('', 'tick', '', 'error', 'system', String(e.message)); }
  try { retryFailedEmails_(); } catch (e) {}
}

/* ------------------------------ reading orders ---------------------------- */

function myOrders_(p) {
  var who = verifyCustomer_(p.idToken);
  if (!who) return { ok: false, error: 'sign_in_required' };
  var sh = ordersSheet_();
  var idx = headerIndex_(sh);
  var last = sh.getLastRow();
  if (last < 2) return { ok: true, orders: [] };
  var values = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    // Matched on the verified email, never on anything the browser claimed.
    if (normEmail_(values[i][idx['Customer Email']]) !== who.email) continue;
    out.push(buildView_(sh, i + 2, idx, values[i]));
  }
  out.sort(function (a, b) { return (b.placedAtMs || 0) - (a.placedAtMs || 0); });
  return { ok: true, orders: out };
}

function oneOrder_(p) {
  var who = verifyCustomer_(p.idToken);
  if (!who) return { ok: false, error: 'sign_in_required' };
  var sh = ordersSheet_();
  var idx = headerIndex_(sh);
  var f = findRow_(sh, idx, clip_(p.orderId, 32));
  if (!f) return { ok: false, error: 'not_found' };
  // Somebody else's order id is simply "not found" — the answer must not
  // reveal that an order exists for another customer.
  if (normEmail_(f.values[idx['Customer Email']]) !== who.email) {
    return { ok: false, error: 'not_found' };
  }
  return { ok: true, order: buildView_(sh, f.row, idx, f.values) };
}

/** What the website is given about an order. No payment credentials, ever. */
function buildView_(sh, row, idx, values) {
  var v = values || sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
  var meta = getMeta_(sh, row);
  var status = String(v[idx['Order Status']] || 'Payment Pending');
  var placed = v[idx['Order Date']];
  var est = v[idx['Estimated Delivery Date']];
  var payAt = v[idx['Payment Confirmation Date']];
  return {
    orderId: String(v[idx['Order ID']] || ''),
    placedAt: isoOf_(placed),
    placedAtMs: (placed instanceof Date) ? placed.getTime() : 0,
    customerName: String(v[idx['Customer Name']] || ''),
    phone: String(v[idx['Phone Number']] || ''),
    address: String(v[idx['Shipping Address']] || ''),
    items: (meta && meta.items) || [],
    total: Number(v[idx['Total Amount']] || 0),
    paymentMethod: String(v[idx['Payment Method']] || ''),
    paymentStatus: String(v[idx['Payment Status']] || 'Pending'),
    paidAt: isoOf_(payAt),
    queuePosition: Number(v[idx['Queue Position']] || 0) || null,
    status: status,
    stage: Math.max(0, TRACKER.indexOf(status)),
    stages: TRACKER,
    cancelled: status === 'Cancelled',
    estimatedDelivery: isoOf_(est),
    courier: String(v[idx['Courier']] || ''),
    tracking: String(v[idx['Tracking Number']] || ''),
    trackingUrl: trackingUrl_(String(v[idx['Courier']] || ''), String(v[idx['Tracking Number']] || '')),
    lastUpdated: isoOf_(v[idx['Last Updated']])
  };
}

function trackingUrl_(courier, number) {
  if (!courier || !number) return '';
  var c = courier.toLowerCase();
  if (c.indexOf('bluedart') !== -1) return 'https://www.bluedart.com/tracking?trackFor=0&trackNo=' + encodeURIComponent(number);
  if (c.indexOf('delhivery') !== -1) return 'https://www.delhivery.com/track/package/' + encodeURIComponent(number);
  if (c.indexOf('dtdc') !== -1) return 'https://www.dtdc.in/tracking.asp?strCnno=' + encodeURIComponent(number);
  if (c.indexOf('india post') !== -1 || c.indexOf('speed post') !== -1) return 'https://www.indiapost.gov.in/_layouts/15/dop.portal.tracking/trackconsignment.aspx';
  if (c.indexOf('fedex') !== -1) return 'https://www.fedex.com/fedextrack/?trknbr=' + encodeURIComponent(number);
  if (c.indexOf('dhl') !== -1) return 'https://www.dhl.com/in-en/home/tracking.html?tracking-id=' + encodeURIComponent(number);
  return '';
}

/* --------------------------------- owner view ----------------------------- */

function listOrders_() {
  var sh = ordersSheet_();
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
  var sh = ordersSheet_();
  var idx = headerIndex_(sh);
  var s = { total: 0, awaitingPayment: 0, paid: 0, inQueue: 0, inProduction: 0,
            shipped: 0, delivered: 0, cancelled: 0, revenue: 0, pendingValue: 0,
            serverNow: new Date().toISOString() };
  var last = sh.getLastRow();
  if (last < 2) return s;
  var values = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  values.forEach(function (v) {
    if (!String(v[idx['Order ID']] || '')) return;
    s.total++;
    var pay = String(v[idx['Payment Status']]);
    var st = String(v[idx['Order Status']]);
    var amt = Number(v[idx['Total Amount']] || 0);
    if (pay === 'Paid') { s.paid++; s.revenue += amt; } else if (pay === 'Pending') { s.awaitingPayment++; s.pendingValue += amt; }
    if (ACTIVE_IN_QUEUE.indexOf(st) !== -1) s.inQueue++;
    if (st === 'Production Started' || st === 'Quality Check') s.inProduction++;
    if (st === 'Shipped') s.shipped++;
    if (st === 'Delivered') s.delivered++;
    if (st === 'Cancelled') s.cancelled++;
  });
  return s;
}

/* ------------------------------ row-level helpers ------------------------- */

function ordersSheet_() { return sheetFor_(SHEET_ORDERS, COLS); }

function findRow_(sh, idx, orderId) {
  orderId = String(orderId || '').trim();
  if (!orderId) return null;
  var last = sh.getLastRow();
  if (last < 2) return null;
  var ids = sh.getRange(2, idx['Order ID'] + 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === orderId) {
      return { row: i + 2, values: sh.getRange(i + 2, 1, 1, sh.getLastColumn()).getValues()[0] };
    }
  }
  return null;
}

function setFieldByOrder_(orderId, patch) {
  var sh = ordersSheet_();
  var idx = headerIndex_(sh);
  var f = findRow_(sh, idx, orderId);
  if (!f) return false;
  setCells_(sh, f.row, idx, patch);
  return true;
}

function findByClientRef_(ref) {
  var sh = ordersSheet_();
  var idx = headerIndex_(sh);
  var last = sh.getLastRow();
  if (last < 2 || idx['Order Data'] === undefined) return null;
  var col = sh.getRange(2, idx['Order Data'] + 1, last - 1, 1).getValues();
  // Newest first: a repeated submission is almost always the most recent row.
  for (var i = col.length - 1; i >= 0; i--) {
    if (!col[i][0]) continue;
    try {
      var m = JSON.parse(col[i][0]);
      if (m && m.clientRef && m.clientRef === ref) {
        return { orderId: m.orderId, view: buildView_(sh, i + 2, idx) };
      }
    } catch (e) {}
  }
  return null;
}

/* The structured order rides along in a hidden column on its own row, so it
 * survives sorting and filtering and needs no second API call to read. */
function setMeta_(sh, row, obj) {
  // Never fatal: an order already written to the sheet must not be rejected
  // because its index entry failed, or the customer would be told the order
  // did not go through while the row sits there.
  try {
    var idx = headerIndex_(sh);
    if (idx['Order Data'] === undefined) return false;
    sh.getRange(row, idx['Order Data'] + 1).setValue(JSON.stringify(obj));
    return true;
  } catch (e) {
    audit_((obj && obj.orderId) || '', 'Order Data', '', 'failed', 'system', String(e && e.message));
    return false;
  }
}
function getMeta_(sh, row) {
  try {
    var idx = headerIndex_(sh);
    if (idx['Order Data'] === undefined) return null;
    var raw = sh.getRange(row, idx['Order Data'] + 1).getValue();
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
function markManualEstimate_(sh, row) {
  try {
    var idx = headerIndex_(sh);
    if (idx['ETA Source'] !== undefined) {
      sh.getRange(row, idx['ETA Source'] + 1).setValue('manual');
    }
  } catch (e) {}
}
function isManualEstimate_(sh, row) {
  try {
    var idx = headerIndex_(sh);
    if (idx['ETA Source'] === undefined) return false;
    return String(sh.getRange(row, idx['ETA Source'] + 1).getValue()) === 'manual';
  } catch (e) { return false; }
}

/* --------------------------------- audit ---------------------------------- */

function audit_(orderId, field, from, to, by, note) {
  try {
    var sh = sheetFor_(SHEET_AUDIT, AUDIT_COLS);
    sh.appendRow([new Date(), safeCell_(orderId), safeCell_(field), safeCell_(clip_(from, 200)),
                  safeCell_(clip_(to, 200)), safeCell_(by), safeCell_(clip_(note, 300))]);
    var last = sh.getLastRow();
    if (last > 10001) sh.deleteRows(2, last - 10001);
  } catch (e) {}
}

/* ------------------------------- plumbing --------------------------------- */

function sheetFor_(name, cols) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.appendRow(cols);
    sh.getRange(1, 1, 1, cols.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  } else {
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

function setCells_(sh, row, idx, patch) {
  Object.keys(patch).forEach(function (name) {
    if (idx[name] === undefined) return;
    var v = patch[name];
    sh.getRange(row, idx[name] + 1).setValue(typeof v === 'string' ? safeCell_(v) : v);
  });
}

function parseBody_(e) {
  var p = {};
  if (e && e.parameter) for (var k in e.parameter) p[k] = e.parameter[k];
  var raw = e && e.postData && e.postData.contents;
  if (raw && raw.charAt(0) === '{') {
    try { var j = JSON.parse(raw); for (var k2 in j) p[k2] = j[k2]; } catch (err) {}
  }
  return p;
}

function tokenOk_(given) {
  var want = PropertiesService.getScriptProperties().getProperty('ADMIN_TOKEN') || '';
  return constantEquals_(want, String(given || ''));
}
function constantEquals_(a, b) {
  if (!a || a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function sha256Hex_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function clip_(v, n) { return String(v == null ? '' : v).trim().slice(0, n); }
function normEmail_(v) { return clip_(v, MAX.email).toLowerCase(); }
function isoOf_(v) { return v instanceof Date ? v.toISOString() : (v ? String(v) : ''); }
function inr_(n) { return '₹' + Number(n || 0).toLocaleString('en-IN'); }
function esc_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
/** Sheets reads a leading =, +, - or @ as a formula; an apostrophe forces
 *  text and is stripped again on read. Same guard as the waitlist script. */
function safeCell_(v) {
  var s = String(v == null ? '' : v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}
function randomToken_(n) {
  var a = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', out = '';
  for (var i = 0; i < n; i++) out += a.charAt(Math.floor(Math.random() * a.length));
  return out;
}

/* ===========================================================================
 * THE CATALOGUE — the authoritative price list
 * ---------------------------------------------------------------------------
 * Prices live here, on the server, and the browser's numbers are ignored.
 * A customer who edits the page can change what they SEE but not what they
 * are charged, because placeOrder_ prices every line from this table.
 *
 * Keep in step with the catalogue in admin.html and the collection pages.
 * ========================================================================= */
var CATALOG = {
  // Early-bird pricing: half of the full price while the first collection
  // opens. Full prices were Lāsya ₹13,000, Kānti ₹8,000, Lāvaṇya ₹8,000.
  'srngara-lasya':   { name: 'The Lāsya Dress',   collection: 'Śṛṅgāra · The First Collection', price: 6500 },
  'srngara-kanti':   { name: 'The Kānti Skirt',   collection: 'Śṛṅgāra · The First Collection', price: 4000 },
  'srngara-lavanya': { name: 'The Lāvaṇya Top',   collection: 'Śṛṅgāra · The First Collection', price: 4000 }
};

/* ===========================================================================
 * EMAILS
 * ---------------------------------------------------------------------------
 * Every message is triggered by an order EVENT, never by a spreadsheet edit
 * as such — onOrdersEdit only calls in here when a watched field actually
 * changed value. On top of that, each (order, event) pair is remembered, so
 * a status nudged back and forth cannot email the same person twice.
 * ========================================================================= */

function emailKey_(orderId, event) { return 'sent::' + orderId + '::' + event; }

function alreadySent_(orderId, event) {
  return PropertiesService.getScriptProperties().getProperty(emailKey_(orderId, event)) !== null;
}
function markSent_(orderId, event) {
  PropertiesService.getScriptProperties().setProperty(emailKey_(orderId, event), String(Date.now()));
}

/** One door out, so every message shares the letterhead, the logging and the
 *  retry behaviour. A failure is recorded, not swallowed. */
function sendOrderMail_(view, event, subject, innerHtml, textBody) {
  if (!view || !view.orderId) return { ok: false, error: 'no order' };
  if (alreadySent_(view.orderId, event)) return { ok: true, skipped: 'already sent' };

  var to = customerEmailFor_(view.orderId);
  if (!to) return { ok: false, error: 'no email' };

  try {
    MailApp.sendEmail({
      to: to, subject: subject, htmlBody: shell_(innerHtml, view),
      body: textBody, name: 'Vedam'
    });
    markSent_(view.orderId, event);
    audit_(view.orderId, 'Email', '', event, 'system', 'sent');
    return { ok: true };
  } catch (err) {
    // Kept, not lost: ordersTick retries it on the next run.
    queueRetry_(view.orderId, event);
    audit_(view.orderId, 'Email', '', event, 'system', 'FAILED: ' + err.message);
    return { ok: false, error: err.message };
  }
}

function customerEmailFor_(orderId) {
  var sh = ordersSheet_();
  var idx = headerIndex_(sh);
  var f = findRow_(sh, idx, orderId);
  return f ? String(f.values[idx['Customer Email']] || '') : '';
}

function queueRetry_(orderId, event) {
  var props = PropertiesService.getScriptProperties();
  var q = [];
  try { q = JSON.parse(props.getProperty('EMAIL_RETRY') || '[]'); } catch (e) {}
  q.push({ orderId: orderId, event: event, at: Date.now() });
  props.setProperty('EMAIL_RETRY', JSON.stringify(q.slice(-50)));
}

function retryFailedEmails_() {
  var props = PropertiesService.getScriptProperties();
  var q = [];
  try { q = JSON.parse(props.getProperty('EMAIL_RETRY') || '[]'); } catch (e) { return; }
  if (!q.length) return;
  var keep = [];
  var sh = ordersSheet_();
  var idx = headerIndex_(sh);
  q.forEach(function (job) {
    if (alreadySent_(job.orderId, job.event)) return;
    var f = findRow_(sh, idx, job.orderId);
    if (!f) return;
    var view = buildView_(sh, f.row, idx, f.values);
    var r = (job.event === 'placed') ? sendOrderPlaced_(view) : sendStatusEmail_(view, job.event);
    if (!r || !r.ok) keep.push(job);
  });
  props.setProperty('EMAIL_RETRY', JSON.stringify(keep));
}

/* ------------------------------ the letterhead ---------------------------- */

function shell_(innerHtml, view) {
  var site = PropertiesService.getScriptProperties().getProperty('SITE_URL') || '';
  var orderUrl = site.replace(/\/$/, '') + '/my-orders.html?order=' + encodeURIComponent(view.orderId);
  return '' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#57131A;margin:0;padding:0">' +
  '<tr><td align="center" style="padding:36px 16px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#F7ECDE;border:1px solid #C9A15C">' +
      '<tr><td align="center" style="background:#57131A;padding:34px 24px 28px">' +
        '<div style="font:34px/1 Georgia,\'Times New Roman\',serif;letter-spacing:.3em;color:#F0E1BE;margin-left:.3em">VEDAM</div>' +
        '<div style="font:italic 14px/1.6 Georgia,serif;color:rgba(240,225,190,.75);margin-top:10px">Tradition Reimagined</div>' +
      '</td></tr>' +
      '<tr><td style="padding:38px 40px 30px;font:17px/1.75 Georgia,\'Times New Roman\',serif;color:#4A0F14">' +
        innerHtml +
        orderButton_(orderUrl) +
      '</td></tr>' +
      '<tr><td style="background:#4A0F14;padding:22px 28px;font:12px/1.7 Helvetica,Arial,sans-serif;color:rgba(243,230,200,.72)" align="center">' +
        '<div>Order ' + esc_(view.orderId) + '</div>' +
        '<div style="margin-top:8px">© ' + new Date().getFullYear() + ' Vedam · Made with love in India</div>' +
      '</td></tr>' +
    '</table>' +
  '</td></tr></table>';
}

function orderButton_(url) {
  return '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:30px auto 4px"><tr>' +
    '<td align="center" style="background:#6A0F0C;border:1.5px solid #C9A15C">' +
    '<a href="' + esc_(url) + '" style="display:inline-block;padding:15px 34px;font:11px/1 Helvetica,Arial,sans-serif;' +
    'letter-spacing:.28em;text-transform:uppercase;color:#F3E6C8;text-decoration:none">View your order</a>' +
    '</td></tr></table>';
}

function itemsTable_(view) {
  if (!view.items || !view.items.length) return '';
  var rows = view.items.map(function (it) {
    return '<tr><td style="padding:7px 0;border-bottom:1px solid rgba(106,15,12,.15)">' +
      esc_(it.name) + (it.qty > 1 ? ' <span style="color:#6B4A41">× ' + it.qty + '</span>' : '') +
      '</td><td align="right" style="padding:7px 0;border-bottom:1px solid rgba(106,15,12,.15);white-space:nowrap">' +
      esc_(inr_(it.price * it.qty)) + '</td></tr>';
  }).join('');
  return '<table role="presentation" width="100%" style="margin:22px 0 6px;font:15px/1.6 Georgia,serif;color:#4A0F14">' +
    rows + '<tr><td style="padding:10px 0;font-weight:bold">Total</td>' +
    '<td align="right" style="padding:10px 0;font-weight:bold">' + esc_(inr_(view.total)) + '</td></tr></table>';
}

function firstName_(name) {
  var n = String(name || '').trim().split(/\s+/)[0];
  return n || 'there';
}
function prettyDate_(iso) {
  if (!iso) return '';
  try {
    return Utilities.formatDate(new Date(iso), 'Asia/Kolkata', 'd MMMM yyyy');
  } catch (e) { return ''; }
}

/* ------------------------------ the messages ------------------------------ */

function sendOrderPlaced_(view) {
  var paid = view.paymentStatus === 'Paid';
  var inner =
    '<p style="margin:0 0 16px">Dear ' + esc_(firstName_(view.customerName)) + ',</p>' +
    '<p style="margin:0 0 16px">We have your order — <b>' + esc_(view.orderId) + '</b>.</p>' +
    itemsTable_(view) +
    (paid
      ? '<p style="margin:18px 0 0">Your payment is confirmed and your place in the workroom queue is held.</p>'
      : '<p style="margin:18px 0 0">We are waiting on payment. Your piece joins the queue the moment it reaches us — ' +
        'every Vedam piece is cut only once an order is paid for, and the queue runs in the order payments arrive.</p>');
  var text = 'Dear ' + firstName_(view.customerName) + ',\n\nWe have your order — ' + view.orderId + '.\n' +
    'Total: ' + inr_(view.total) + '\n\n' +
    (paid ? 'Your payment is confirmed and your place in the queue is held.\n'
          : 'We are waiting on payment. Your piece joins the queue once it reaches us.\n') +
    '\n— Vedam';
  return sendOrderMail_(view, 'placed', 'Your Vedam order ' + view.orderId, inner, text);
}

function sendStatusEmail_(view, status) {
  var name = esc_(firstName_(view.customerName));
  var eta = view.estimatedDelivery ? prettyDate_(view.estimatedDelivery) : '';
  var lines = {
    'Payment Confirmed': {
      subject: 'Payment received — ' + view.orderId,
      body: '<p style="margin:0 0 16px">Dear ' + name + ',</p>' +
            '<p style="margin:0 0 16px">Your payment for <b>' + esc_(view.orderId) + '</b> is confirmed, and your order has joined the workroom queue' +
            (view.queuePosition ? ' at position <b>' + view.queuePosition + '</b>' : '') + '.</p>' +
            (eta ? '<p style="margin:0">We estimate delivery around <b>' + esc_(eta) + '</b>. It is an estimate, not a promise — handwork moves at its own pace, and we will tell you if it shifts.</p>' : '')
    },
    'Production Started': {
      subject: 'We have begun your piece — ' + view.orderId,
      body: '<p style="margin:0 0 16px">Dear ' + name + ',</p>' +
            '<p style="margin:0 0 16px">Work has started on <b>' + esc_(view.orderId) + '</b>. The cutting is done by hand, and the embroidery begins from there.</p>' +
            (eta ? '<p style="margin:0">Still looking at around <b>' + esc_(eta) + '</b> for delivery.</p>' : '')
    },
    'Quality Check': {
      subject: 'Your piece is being checked — ' + view.orderId,
      body: '<p style="margin:0 0 16px">Dear ' + name + ',</p>' +
            '<p style="margin:0">Your piece is finished and is now being gone over by hand — every bead, every seam, every length of zari — before it is allowed to leave us.</p>'
    },
    'Ready to Ship': {
      subject: 'Ready to send — ' + view.orderId,
      body: '<p style="margin:0 0 16px">Dear ' + name + ',</p>' +
            '<p style="margin:0">Your order has passed its check and is being wrapped for dispatch. The tracking details follow as soon as it is collected.</p>'
    },
    'Shipped': {
      subject: 'On its way — ' + view.orderId,
      body: '<p style="margin:0 0 16px">Dear ' + name + ',</p>' +
            '<p style="margin:0 0 16px">Your order is on its way.</p>' +
            (view.courier ? '<p style="margin:0 0 6px"><b>Courier:</b> ' + esc_(view.courier) + '</p>' : '') +
            (view.tracking ? '<p style="margin:0"><b>Tracking:</b> ' + esc_(view.tracking) +
              (view.trackingUrl ? ' — <a href="' + esc_(view.trackingUrl) + '" style="color:#6A0F0C">follow it here</a>' : '') + '</p>' : '')
    },
    'Delivered': {
      subject: 'Delivered — ' + view.orderId,
      body: '<p style="margin:0 0 16px">Dear ' + name + ',</p>' +
            '<p style="margin:0 0 16px">Your order has been delivered. We hope it is everything you pictured.</p>' +
            '<p style="margin:0;font-style:italic;color:#6B4A41">Thank you for letting us make something for you.</p>'
    }
  };
  var t = lines[status];
  if (!t) return { ok: true, skipped: 'no email for ' + status };
  var text = 'Dear ' + firstName_(view.customerName) + ',\n\n' +
    String(t.body).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() + '\n\n— Vedam';
  return sendOrderMail_(view, status, t.subject, t.body, text);
}

/** Only when the date really moves — a day either way is not worth an email. */
function sendEstimateChanged_(view, previousIso) {
  var prev = previousIso ? new Date(previousIso) : null;
  var now = view.estimatedDelivery ? new Date(view.estimatedDelivery) : null;
  if (!now) return { ok: true, skipped: 'no date' };
  if (prev && Math.abs(now.getTime() - prev.getTime()) < 3 * 864e5) {
    return { ok: true, skipped: 'change too small to be worth an email' };
  }
  // A changing estimate can legitimately be sent more than once, so this one
  // is keyed by the date itself rather than by the event alone.
  var event = 'eta::' + now.toISOString().slice(0, 10);
  var inner =
    '<p style="margin:0 0 16px">Dear ' + esc_(firstName_(view.customerName)) + ',</p>' +
    '<p style="margin:0 0 16px">The estimated delivery for <b>' + esc_(view.orderId) + '</b> has changed to <b>' +
    esc_(prettyDate_(view.estimatedDelivery)) + '</b>.</p>' +
    '<p style="margin:0">Handwork does not keep to a timetable, and we would rather tell you than let a date slide quietly. ' +
    'It remains an estimate rather than a promise.</p>';
  var text = 'Dear ' + firstName_(view.customerName) + ',\n\nThe estimated delivery for ' + view.orderId +
    ' has changed to ' + prettyDate_(view.estimatedDelivery) + '.\n\n— Vedam';
  return sendOrderMail_(view, event, 'Updated delivery estimate — ' + view.orderId, inner, text);
}
