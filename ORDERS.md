# Vedam — Order Management

Customer places an order → pays → the master sheet gets a row → the queue
assigns a position → you move the status in the sheet → the customer's page
and inbox update themselves.

Your routine is four things: **confirm manual payments, move the status,
adjust a delivery date when you need to, and type in the tracking number.**
Everything else happens on its own.

---

## Where everything is

| | |
|---|---|
| **Master sheet** | "Vedam Orders" — one row per order, `Orders` tab |
| **Backend** | `orders-apps-script.gs`, bound to that sheet, deployed as a web app |
| **Checkout** | `checkout.html` + `vedam-checkout.js` |
| **Customer dashboard** | `my-orders.html` + `vedam-my-orders.js` |
| **Shared client** | `vedam-orders.js` (auth, cart, API) |
| **Config** | `orders-config.js` — endpoint + the measurements asked for |
| **Portal** | `admin.html` → Orders — **read-only**; the sheet is the control centre |

---

## Live as of 11 Oct 2026

| | |
|---|---|
| **Orders sheet** | [Vedam Orders](https://docs.google.com/spreadsheets/d/1SxSNiQuB5P9EUwnZTItZ03ltWT9C44XbxVXs2YriRuQ/edit) |
| **Apps Script** | [Vedam Orders project](https://script.google.com/u/0/home/projects/1Unm75NvvizQ9FFv7I67a6lg5lZQUzogoNpNLue9loUsU_cUGEAYbmQiz/edit) |
| **Payment** | manual — UPI `9676365420-2@ybl`, confirmed by hand |
| **Queue settings** | 3 pieces a week · 21 days a piece · 5 days shipping |

⚠️ **One step outstanding:** the deployment is on an older version. Publish a
new one so the *sheet dropdown* confirms payments — Deploy ▸ Manage
deployments ▸ pencil ▸ Version **New version** ▸ Deploy. Until then, use the
portal or ask for a confirm through the API; everything else already works.

## Setup

1. New Google Sheet called **Vedam Orders**.
2. Extensions → Apps Script, paste `orders-apps-script.gs`, save.
3. Run **`setupVedamOrders`** once and authorise it. It builds the sheet —
   headers, dropdowns, colours, frozen rows, filter, protection — and installs
   the triggers. **Copy the ADMIN TOKEN it logs.**
4. Deploy → New deployment → Web app, *Execute as* **Me**, *Access* **Anyone**.
   Copy the `/exec` URL.
5. Put that URL in `orders-config.js` → `endpoint`, commit and push.
6. Store the admin token in Firestore at `ownerSecrets/orders`, field `token`,
   so the portal can read the order list.
7. Add your payment details as Script Properties: `UPI_ID` and `BANK_DETAILS`.

**Editing the script changes nothing until you publish a new version:**
Deploy → Manage deployments → pencil → Version **New version** → Deploy.

---

## Running an order

**A customer pays by UPI or bank transfer.** The order arrives with Payment
Status *Pending* and is **not** in the queue. When the money lands, set
Payment Status to **Paid**. That one edit stamps the confirmation time, moves
the order to *Payment Confirmed*, gives it the next queue position and emails
the customer.

**Moving an order along.** Change **Order Status** in the dropdown. The
customer's tracker and inbox follow within seconds. The stages that email are
Payment Confirmed, Production Started, Quality Check, Ready to Ship, Shipped
and Delivered — *In Queue* and *Cancelled* deliberately do not.

**Shipping.** Type the **Courier** and **Tracking Number**, then set the
status to *Shipped*. The shipping email carries both, with a tracking link for
Bluedart, Delhivery, DTDC, India Post, FedEx and DHL.

**Delivery dates.** The system estimates one from the queue. Type over it and
yours wins permanently — later recalculations will not touch that row again.
A change of three days or more emails the customer; smaller drift does not.

Those settings live in Script Properties and can be changed any time:
`PROD_CAPACITY_PER_WEEK` (3), `PROD_DAYS_PER_PIECE` (21), `SHIP_DAYS` (5).

---

## The rules it keeps

- **Nothing enters the queue unpaid.** One function sets Paid, and it is the
  only way in.
- **Sorting the sheet cannot reorder the queue.** Positions are recalculated
  from payment timestamps and written back by Order ID.
- **One order is one row**, however many pieces. They are numbered `[1] [2]`
  across Products, Size, Customization and Quantity so the columns line up.
- **A customer sees only their own orders.** Their identity is a Firebase
  token the backend verifies with Google on every request. Somebody else's
  order id answers "not found".
- **Prices come from the server.** Editing the page changes what you see, not
  what you are charged.
- **Editing an unrelated cell emails nobody.** Only five columns are watched,
  and only when the value actually changes.
- **No duplicate emails.** Each order+event is remembered; a failed send is
  queued and retried every 15 minutes rather than lost.
- **No card details ever touch the sheet.**

---

## Payments

`PAY_PROVIDER` is **`manual`** today: the customer gets your UPI ID or bank
details with their order number, and you confirm by hand.

PhonePe is written and waiting. Set `PAY_PROVIDER=phonepe` plus
`PHONEPE_MERCHANT_ID`, `PHONEPE_SALT_KEY` and `PHONEPE_SALT_INDEX`, and
payment confirms itself through a signed webhook. Until the salt key exists
the webhook refuses everything, which is the safe default.
