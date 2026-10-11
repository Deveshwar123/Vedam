/**
 * Vedam — checkout  (module, checkout.html only)
 * ===========================================================================
 * Turns a cart into an order. It gathers measurements, an address and a
 * payment choice, then hands all of it to the Orders backend, which is the
 * thing that actually decides anything: it prices the order from its own
 * catalogue and verifies who is asking. Nothing here is trusted.
 * ===========================================================================
 */
import { whoAmI, signInUrl, readCart, clearCart, placeOrder, finishOrder,
         settings, isConfigured, inr, esc } from './vedam-orders.js';

const $ = (id) => document.getElementById(id);
const CFG = window.VEDAM_ORDERS || {};
const FIELDS = CFG.measurements || [];

let cart = [];
let payMode = 'manual';
let sending = false;

function show(id, on) { const el = $(id); if (el) el.hidden = !on; }
function only(id) {
  ['coLoading', 'coSignIn', 'coEmpty', 'coClosed', 'coForm', 'coDone']
    .forEach((n) => show(n, n === id));
}

/* --------------------------------- start --------------------------------- */

(async function start() {
  // Ordering has to be open. The same single source of truth the collection
  // pages use, so checkout can never be the one door left unlocked.
  const open = !!(window.VedamOrdering && window.VedamOrdering.isOpen());
  if (!open) {
    const at = window.VedamOrdering && window.VedamOrdering.opensAt();
    if (at) {
      $('coClosedNote').textContent =
        'Ordering opens ' + new Date(at).toLocaleString('en-IN', {
          timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long',
          hour: 'numeric', minute: '2-digit' }) +
        ' IST. Join the waitlist and we will write to you the moment it does.';
    }
    only('coClosed');
    return;
  }

  const user = await whoAmI();
  if (!user) {
    $('coSignInLink').href = signInUrl('checkout.html');
    only('coSignIn');
    return;
  }

  cart = await readCart();
  if (!cart.length) { only('coEmpty'); return; }

  const s = await settings();
  payMode = (s && s.payProvider) || 'manual';

  buildPieces();
  buildPayment(s);
  buildSummary();
  prefill(user);
  only('coForm');
})();

/* ------------------------------- the form -------------------------------- */

function buildPieces() {
  $('coPieces').innerHTML = cart.map((it, i) => `
    <div class="piece">
      <h3>${esc(it.name || it.id)}</h3>
      <div class="meta">${esc(it.collection || '')}${(it.qty || 1) > 1 ? ' · × ' + (it.qty || 1) : ''}</div>
      <div class="mgrid">
        ${FIELDS.map((f) => `
          <label class="f">
            <span>${esc(f.label)}${f.required ? ' *' : ''} <span style="opacity:.6">(${esc(f.unit)})</span></span>
            <input data-i="${i}" data-k="${esc(f.key)}" type="text" inputmode="decimal"
                   maxlength="12" ${f.required ? 'required' : ''} placeholder="—">
          </label>`).join('')}
      </div>
      <label class="f" style="margin-top:14px">
        <span>Anything we should know</span>
        <textarea data-i="${i}" data-k="__note" maxlength="2000"
          placeholder="Colour changes, blouse style, an occasion we should work to…"></textarea>
      </label>
    </div>`).join('');
}

function buildPayment(s) {
  const online = payMode === 'phonepe';
  const opts = [];
  if (online) {
    opts.push({ v: 'phonepe', t: 'Pay online', d: 'PhonePe — UPI, card or net banking. Your order enters the queue the moment payment clears.' });
  }
  opts.push({ v: 'upi', t: 'UPI transfer',
    d: 'We send you our UPI ID with the order number. Your place in the queue is taken from the moment we confirm it.' +
       (s && s.upiId ? '' : '') });
  opts.push({ v: 'bank', t: 'Bank transfer',
    d: 'We send you the account details with the order number, and confirm by hand — usually within a day.' });

  $('coPay').innerHTML = opts.map((o, i) => `
    <label class="payopt">
      <input type="radio" name="paymentMethod" value="${o.v}" ${i === 0 ? 'checked' : ''}>
      <span><b>${esc(o.t)}</b><span class="d">${esc(o.d)}</span></span>
    </label>`).join('');
}

function buildSummary() {
  const rows = cart.map((it) => `
    <div class="sumrow">
      <span>${esc(it.name || it.id)}${(it.qty || 1) > 1 ? ' × ' + (it.qty || 1) : ''}</span>
      <span>${esc(inr((it.price || 0) * (it.qty || 1)))}</span>
    </div>`).join('');
  const total = cart.reduce((s, it) => s + (it.price || 0) * (it.qty || 1), 0);
  $('coSummary').innerHTML = rows +
    `<div class="sumrow total"><span>Total</span><span>${esc(inr(total))}</span></div>`;
}

function prefill(user) {
  const f = $('coForm');
  if (user.displayName) f.querySelector('[name="name"]').value = user.displayName;
  try {
    const saved = JSON.parse(localStorage.getItem('vedamShipTo') || 'null');
    if (saved) {
      if (saved.phone) f.querySelector('[name="phone"]').value = saved.phone;
      if (saved.address) f.querySelector('[name="address"]').value = saved.address;
      if (saved.name && !f.querySelector('[name="name"]').value) {
        f.querySelector('[name="name"]').value = saved.name;
      }
    }
  } catch (e) {}
}

/* -------------------------------- sending -------------------------------- */

function say(kind, text) {
  const m = $('coMsg');
  m.textContent = text;
  m.style.color = kind === 'err' ? '#A5341F' : '#2F5D3A';
  m.hidden = !text;
}

function collectItems() {
  const f = $('coForm');
  return cart.map((it, i) => {
    const parts = [];
    FIELDS.forEach((fl) => {
      const el = f.querySelector(`[data-i="${i}"][data-k="${fl.key}"]`);
      const v = el && el.value.trim();
      if (v) parts.push(fl.label + ' ' + v + fl.unit);
    });
    const noteEl = f.querySelector(`[data-i="${i}"][data-k="__note"]`);
    return {
      id: it.id,
      qty: it.qty || 1,
      measurements: parts.join(', '),
      customisation: noteEl ? noteEl.value.trim() : ''
    };
  });
}

function firstMissing() {
  const f = $('coForm');
  for (let i = 0; i < cart.length; i++) {
    for (const fl of FIELDS) {
      if (!fl.required) continue;
      const el = f.querySelector(`[data-i="${i}"][data-k="${fl.key}"]`);
      if (el && !el.value.trim()) return { el, why: fl.label + ' is needed for ' + (cart[i].name || 'this piece') + '.' };
      if (el && !/^\d{1,3}(\.\d{1,2})?$/.test(el.value.trim())) {
        return { el, why: fl.label + ' should be a number in inches, like 36 or 36.5.' };
      }
    }
  }
  return null;
}

$('coForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  if (sending) return;
  const f = ev.currentTarget;

  const miss = firstMissing();
  if (miss) { say('err', miss.why); try { miss.el.focus(); } catch (e) {} return; }

  const name = f.querySelector('[name="name"]').value.trim();
  const phone = f.querySelector('[name="phone"]').value.trim();
  const address = f.querySelector('[name="address"]').value.trim();
  if (!name) { say('err', 'Please tell us your name.'); return; }
  if (!phone || !/^[\d\s()+\-.]{6,30}$/.test(phone)) { say('err', 'Please add a phone number we can reach you on.'); return; }
  if (address.length < 15) { say('err', 'Please give a full delivery address, including the PIN code.'); return; }

  const methodEl = f.querySelector('[name="paymentMethod"]:checked');
  const paymentMethod = methodEl ? methodEl.value : 'upi';

  if (!isConfigured()) {
    say('err', 'The order desk is not connected yet. Nothing has been lost — please write to vedavalavala08@gmail.com and we will take your order by hand.');
    return;
  }

  sending = true;
  $('coBtn').disabled = true;
  $('coBtn').textContent = 'Placing your order…';
  say('', '');

  try {
    // Remember the address for next time; it never leaves this browser.
    try { localStorage.setItem('vedamShipTo', JSON.stringify({ name, phone, address })); } catch (e) {}

    const res = await placeOrder({ items: collectItems(), name, phone, address, paymentMethod });

    if (!res.ok) {
      sending = false;
      $('coBtn').disabled = false;
      $('coBtn').textContent = 'Place order';
      const map = {
        sign_in_required: 'Your session has expired — please sign in again.',
        empty_order: 'Your cart is empty.',
        name_required: 'Please tell us your name.',
        phone_required: 'Please add a phone number.',
        address_required: 'Please give a delivery address.',
        not_configured: 'The order desk is not connected yet.'
      };
      say('err', map[res.error] || ('Your order was not placed — please try again. (' + esc(res.error || 'unknown') + ')'));
      return;
    }

    finishOrder();
    await clearCart();
    showDone(res);
  } catch (err) {
    sending = false;
    $('coBtn').disabled = false;
    $('coBtn').textContent = 'Place order';
    say('err', 'Your order could not be sent just now. Nothing has been charged — please check your connection and try again.');
  }
});

/* ------------------------------ confirmation ------------------------------ */

function showDone(res) {
  const o = res.order || {};
  $('coDoneId').textContent = 'Order ' + (res.orderId || o.orderId || '');
  $('coDoneLink').href = './my-orders.html?order=' + encodeURIComponent(res.orderId || o.orderId || '');

  const pay = res.payment || {};
  if (pay.mode === 'manual') {
    $('coDoneNote').textContent =
      'We have written it down. Your piece joins the workroom queue as soon as payment reaches us — ' +
      'the queue runs strictly in the order payments are confirmed.';
    const dl = [];
    if (pay.upiId) dl.push(['UPI ID', pay.upiId]);
    if (pay.bankDetails) dl.push(['Bank details', pay.bankDetails]);
    dl.push(['Reference', pay.reference || res.orderId]);
    if (!pay.upiId && !pay.bankDetails) {
      dl.push(['Next', 'We will email you the payment details shortly.']);
    }
    $('coPayDetails').innerHTML = dl.map(([k, v]) =>
      `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
    show('coPayBox', true);
  } else {
    $('coDoneNote').textContent =
      'Your payment is being confirmed with the provider. The moment it clears, your order joins the queue and we will email you.';
    show('coPayBox', false);
  }
  only('coDone');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
