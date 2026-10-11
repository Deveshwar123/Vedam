/**
 * Vedam — My Orders  (module, my-orders.html only)
 * ===========================================================================
 * Two views over the same data: the list of a customer's orders, and one
 * order in full with its production tracker.
 *
 * Every figure shown here comes from the backend, which checks the customer's
 * Firebase token before it answers. This file cannot be talked into showing
 * somebody else's order by editing the URL — asking for an order that is not
 * yours comes back as "not found", the same answer as an order that does not
 * exist, so the page cannot even confirm it is real.
 * ===========================================================================
 */
import { whoAmI, signInUrl, myOrders, getOrder, isConfigured,
         inr, prettyDate, prettyDateTime, esc } from './vedam-orders.js';

const $ = (id) => document.getElementById(id);
const only = (id) => ['moLoading', 'moSignIn', 'moNone', 'moError', 'moList', 'moDetail']
  .forEach((n) => { const el = $(n); if (el) el.hidden = n !== id; });

const STAGE_COPY = {
  'Payment Confirmed': 'Payment confirmed',
  'In Queue': 'In the queue',
  'Production Started': 'Being made',
  'Quality Check': 'Quality check',
  'Ready to Ship': 'Ready to send',
  'Shipped': 'On its way',
  'Delivered': 'Delivered'
};

/* ---------------------------------- start -------------------------------- */

(async function start() {
  if (!isConfigured()) {
    $('moErrorNote').textContent =
      'The order desk is not connected yet. If you have placed an order, it is safe — please write to vedavalavala08@gmail.com.';
    only('moError');
    return;
  }

  const user = await whoAmI();
  if (!user) {
    $('moSignInLink').href = signInUrl('my-orders.html');
    only('moSignIn');
    return;
  }

  const wanted = new URLSearchParams(location.search).get('order');
  if (wanted) return openOne(wanted);
  return openList();
})();

/* --------------------------------- the list ------------------------------- */

async function openList() {
  only('moLoading');
  let res;
  try { res = await myOrders(); } catch (e) { return fail(e); }
  if (!res.ok) return fail(res);

  const orders = res.orders || [];
  if (!orders.length) { only('moNone'); return; }

  $('moSub').textContent = orders.length === 1
    ? 'One order, and exactly where it has got to.'
    : orders.length + ' orders, and exactly where each has got to.';

  $('moList').innerHTML = orders.map(cardFor).join('');
  only('moList');
}

function cardFor(o) {
  const names = (o.items || []).map((it) =>
    esc(it.name) + ((it.qty || 1) > 1 ? ' × ' + it.qty : '')).join(' · ') || '—';
  return `
    <div class="card">
      <div class="ohead">
        <div>
          <div class="oid">${esc(o.orderId)}</div>
          <div class="opieces">${names}</div>
        </div>
        <div style="text-align:right">
          <div class="odate">${esc(prettyDate(o.placedAt))}</div>
          <div style="margin-top:7px">${payPill(o)}</div>
        </div>
      </div>
      ${trackerFor(o)}
      <div class="orow">
        <span>Total <b>${esc(inr(o.total))}</b></span>
        ${o.queuePosition ? `<span>Queue <b>#${o.queuePosition}</b></span>` : ''}
        ${o.estimatedDelivery ? `<span>Estimated <b>${esc(prettyDate(o.estimatedDelivery))}</b></span>` : ''}
      </div>
      <a class="open" href="?order=${encodeURIComponent(o.orderId)}">View this order</a>
    </div>`;
}

function payPill(o) {
  if (o.cancelled) return '<span class="pill cancelled">Cancelled</span>';
  const s = String(o.paymentStatus || 'Pending').toLowerCase();
  const cls = s === 'paid' ? 'paid' : s === 'failed' ? 'failed' : 'pending';
  const label = s === 'paid' ? 'Paid' : s === 'failed' ? 'Payment failed' : 'Payment pending';
  return `<span class="pill ${cls}">${label}</span>`;
}

/* -------------------------------- the tracker ----------------------------- */
/** Completed stages are filled, the current one is marked, and the stages
 *  still to come stay quiet. A cancelled order shows no tracker at all —
 *  a progress bar would be a lie. */
function trackerFor(o) {
  if (o.cancelled) {
    return '<p class="est" style="margin-top:18px">This order was cancelled. Write to us if that is a surprise.</p>';
  }
  const stages = o.stages || Object.keys(STAGE_COPY);
  const at = typeof o.stage === 'number' ? o.stage : 0;
  const reached = o.paymentStatus === 'Paid' || at > 0;
  return `
    <div class="track">
      <div class="tline">
        ${stages.map((s, i) => {
          const done = reached && i < at;
          const now = reached && i === at;
          return `<div class="tstep ${done ? 'done' : ''} ${now ? 'now' : ''}">
                    <span class="tdot" aria-hidden="true"></span>
                    <div class="tlabel">${esc(STAGE_COPY[s] || s)}</div>
                  </div>`;
        }).join('')}
      </div>
      ${!reached ? '<p class="est">The tracker begins once payment is confirmed.</p>' : ''}
    </div>`;
}

/* ------------------------------- one order -------------------------------- */

async function openOne(orderId) {
  only('moLoading');
  let res;
  try { res = await getOrder(orderId); } catch (e) { return fail(e); }
  if (!res.ok) {
    if (res.error === 'not_found') {
      $('moErrorNote').textContent = 'We cannot find that order on your account.';
      only('moError');
      return;
    }
    return fail(res);
  }

  const o = res.order;
  $('moTitle').textContent = 'Order ' + o.orderId;
  $('moSub').textContent = 'Placed ' + prettyDate(o.placedAt) + '.';

  const items = (o.items || []).map((it) => `
    <div class="item">
      <div class="n">${esc(it.name)}${(it.qty || 1) > 1 ? ' × ' + it.qty : ''}</div>
      <div class="s">${esc(it.collection || '')}</div>
      ${it.measurements ? `<div class="s"><b>Measurements:</b> ${esc(it.measurements)}</div>` : ''}
      ${it.customisation ? `<div class="s"><b>Notes:</b> ${esc(it.customisation)}</div>` : ''}
      <div class="s">${esc(inr((it.price || 0) * (it.qty || 1)))}</div>
    </div>`).join('');

  const shipping = (o.status === 'Shipped' || o.status === 'Delivered') && (o.courier || o.tracking) ? `
      <dt>Shipping</dt>
      <dd>${esc(o.courier || 'Courier to be confirmed')}${o.tracking ? '\\n' + esc(o.tracking) : ''}${
        o.trackingUrl ? `\\n<a href="${esc(o.trackingUrl)}" target="_blank" rel="noopener" style="color:var(--maroon);border-bottom:1px solid rgba(106,15,12,.3)">Track this shipment</a>` : ''}</dd>` : '';

  $('moDetail').innerHTML = `
    <a class="back" href="./my-orders.html">← All orders</a>
    <div class="card">
      <div class="ohead">
        <div class="oid">${esc(o.orderId)}</div>
        <div>${payPill(o)}</div>
      </div>
      ${trackerFor(o)}
      ${o.estimatedDelivery ? `<p class="est">Estimated delivery ${esc(prettyDate(o.estimatedDelivery))} — an estimate, not a promise. Handwork moves at its own pace and we will write if it shifts.</p>` : ''}
      ${o.queuePosition ? `<p class="est">Position ${o.queuePosition} in the workroom queue.</p>` : ''}
    </div>

    <div class="card">
      <h2 style="font-family:var(--display);font-weight:400;font-size:21px;color:var(--maroon)">Your pieces</h2>
      <div class="items">${items || '<p class="s">—</p>'}</div>
      <div class="tot"><span>Total</span><span>${esc(inr(o.total))}</span></div>
    </div>

    <div class="card">
      <dl class="detail">
        <dt>Order placed</dt><dd>${esc(prettyDateTime(o.placedAt))}</dd>
        <dt>Payment</dt><dd>${esc(o.paymentMethod || '—')} — ${esc(o.paymentStatus)}${
          o.paidAt ? ' on ' + esc(prettyDateTime(o.paidAt)) : ''}</dd>
        <dt>Delivering to</dt><dd>${esc(o.customerName)}\\n${esc(o.address)}\\n${esc(o.phone)}</dd>
        ${shipping}
        <dt>Last updated</dt><dd>${esc(prettyDateTime(o.lastUpdated))}</dd>
      </dl>
    </div>`;
  only('moDetail');
}

/* --------------------------------- failure -------------------------------- */

function fail(res) {
  const err = (res && res.error) || '';
  if (err === 'sign_in_required') {
    $('moSignInLink').href = signInUrl('my-orders.html');
    only('moSignIn');
    return;
  }
  $('moErrorNote').textContent =
    'Please try again in a moment. If it keeps happening, write to vedavalavala08@gmail.com and we will tell you exactly where your order stands.';
  only('moError');
}
