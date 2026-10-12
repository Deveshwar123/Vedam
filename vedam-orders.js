/**
 * Vedam — order client  (ES module, used by checkout.html and my-orders.html)
 * ===========================================================================
 * The bridge between the two new pages and the Orders backend. It owns three
 * things and nothing else:
 *
 *   1. the signed-in customer, and their Firebase ID token
 *   2. reading the cart the rest of the site already keeps
 *   3. the four calls the Orders web app answers
 *
 * The ID token matters: it is the only thing that proves to the backend who
 * is asking. It is short-lived, signed by Google, and verified server-side on
 * every single request — so nothing here decides what a customer may see.
 * This file is a messenger, not a gatekeeper.
 * ===========================================================================
 */
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, setPersistence, browserLocalPersistence }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCxZ4K17JB8ZQtcF9kD-X8HOi1XKwbKFU8",
  authDomain: "vedam-4b313.firebaseapp.com",
  projectId: "vedam-4b313",
  storageBucket: "vedam-4b313.firebasestorage.app",
  messagingSenderId: "894664816324",
  appId: "1:894664816324:web:08eeb2b56c70b6761f7b91"
};

// Re-use the app if another script on the page already made one.
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch(() => {});

const CFG = window.VEDAM_ORDERS || {};

/* ------------------------------ who is here ------------------------------- */

let currentUser = null;
let resolveReady;
const ready = new Promise((r) => { resolveReady = r; });
onAuthStateChanged(auth, (u) => { currentUser = u; resolveReady(u); });

/** Resolves with the user, or null. Always await this before deciding
 *  anything — reading auth too early reports a signed-in customer as a guest,
 *  which is the bug that used to bounce people to the login page. */
export async function whoAmI() {
  await ready;
  return currentUser;
}

export function signInUrl(returnTo) {
  return './login.html?return=' + encodeURIComponent(returnTo || 'checkout.html');
}

async function idToken() {
  const u = await whoAmI();
  if (!u) return null;
  try { return await u.getIdToken(); } catch (e) { return null; }
}

/* -------------------------------- the cart -------------------------------- */
/** The cart the collection pages and cart.html already write, read from the
 *  same place rather than kept a second time. */
export async function readCart() {
  const u = await whoAmI();
  const key = 'vedamCart::' + (u ? u.uid : 'guest');
  try {
    const raw = JSON.parse(localStorage.getItem(key));
    if (Array.isArray(raw) && raw.length) return raw;
  } catch (e) {}
  try {
    const guest = JSON.parse(localStorage.getItem('vedamCart::guest'));
    return Array.isArray(guest) ? guest : [];
  } catch (e) { return []; }
}

export async function clearCart() {
  const u = await whoAmI();
  const key = 'vedamCart::' + (u ? u.uid : 'guest');
  try { localStorage.setItem(key, '[]'); localStorage.setItem('vedamCart::guest', '[]'); } catch (e) {}
  // The site's own Firebase block owns the Firestore copy; tell it to resync.
  try { window.dispatchEvent(new CustomEvent('vedam-cart-cleared')); } catch (e) {}
  if (window.vedamFB && window.vedamFB.saveCart) {
    try { await window.vedamFB.saveCart([]); } catch (e) {}
  }
}

/** Take one piece out of the cart, everywhere the cart lives.
 *  Used when the backend rejects a piece that has since left the catalogue:
 *  retrying can only fail again, so that one piece goes rather than the
 *  customer's whole order. */
export async function dropFromCart(id) {
  const u = await whoAmI();
  const userKey = 'vedamCart::' + (u ? u.uid : 'guest');
  let kept = [];
  for (const k of [userKey, 'vedamCart::guest']) {
    try {
      const raw = JSON.parse(localStorage.getItem(k));
      if (!Array.isArray(raw)) continue;
      const next = raw.filter((it) => String(it && it.id) !== String(id));
      localStorage.setItem(k, JSON.stringify(next));
      if (k === userKey) kept = next;
    } catch (e) {}
  }
  try { window.dispatchEvent(new CustomEvent('vedam-cart-cleared')); } catch (e) {}
  if (window.vedamFB && window.vedamFB.saveCart) {
    try { await window.vedamFB.saveCart(kept); } catch (e) {}
  }
  return kept;
}

/* ------------------------------- the backend ------------------------------ */

export function isConfigured() {
  return !!(CFG.endpoint && CFG.endpoint.indexOf('script.google.com') !== -1);
}

/** text/plain keeps this a "simple" request, so the browser sends it straight
 *  through — Apps Script cannot answer a CORS preflight. */
async function post(payload) {
  if (!isConfigured()) throw new Error('not_configured');
  const res = await fetch(CFG.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); }
  catch (e) { throw new Error('bad_response'); }
  return json;
}

export async function settings() {
  if (!isConfigured()) return null;
  try {
    const res = await fetch(CFG.endpoint + '?action=settings');
    return await res.json();
  } catch (e) { return null; }
}

/**
 * Places the order. clientRef is an idempotency key kept in sessionStorage,
 * so a double-tapped button, a flaky connection or a retried request can
 * never become two orders for the same basket.
 */
export async function placeOrder({ items, name, phone, address, paymentMethod }) {
  const token = await idToken();
  if (!token) return { ok: false, error: 'sign_in_required' };

  let clientRef;
  try {
    clientRef = sessionStorage.getItem('vedamOrderRef');
    if (!clientRef) {
      clientRef = 'ref-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem('vedamOrderRef', clientRef);
    }
  } catch (e) { clientRef = ''; }

  return post({ action: 'place_order', idToken: token, clientRef,
                items, name, phone, address, paymentMethod });
}

/** Starts a fresh basket's idempotency key once an order is safely placed. */
export function finishOrder() {
  try { sessionStorage.removeItem('vedamOrderRef'); } catch (e) {}
}

export async function myOrders() {
  const token = await idToken();
  if (!token) return { ok: false, error: 'sign_in_required' };
  return post({ action: 'my_orders', idToken: token });
}

export async function getOrder(orderId) {
  const token = await idToken();
  if (!token) return { ok: false, error: 'sign_in_required' };
  return post({ action: 'order', idToken: token, orderId });
}

/* -------------------------------- helpers --------------------------------- */

export const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');

export function prettyDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function prettyDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric',
                                     hour: 'numeric', minute: '2-digit' });
}

export const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
