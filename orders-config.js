/**
 * Vedam — order system configuration
 * ===========================================================================
 * The one file to edit to point checkout and My Orders at the backend.
 * Nothing secret belongs here: this file is public, like everything else on
 * a GitHub Pages site. The admin token and the payment keys live in the
 * Apps Script's Script Properties, where a browser can never reach them.
 * ===========================================================================
 */
window.VEDAM_ORDERS = {

  /* The Orders Apps Script web app URL (ends in /exec). Paste it here after
   * deploying orders-apps-script.gs. Until it is filled in, checkout tells
   * customers to write to the house instead of silently losing their order. */
  endpoint: 'https://script.google.com/macros/s/AKfycbynQ9H2ZYRq6gKzxKFTvUhOt7-rKr6ZkgA2jN9YR_7PsDwFgqtC8PGDP8KxbTFua07T9Q/exec',

  /* Where a customer lands to see an order. */
  myOrdersUrl: './my-orders.html',

  /* The measurements asked for at checkout. Vedam is made to order, so these
   * are the numbers the workroom needs before anything is cut. Edit freely —
   * the checkout form and the order record both follow this list. */
  measurements: [
    { key: 'bust',     label: 'Bust / Chest',   unit: 'in', required: true },
    { key: 'waist',    label: 'Waist',          unit: 'in', required: true },
    { key: 'hip',      label: 'Hip',            unit: 'in', required: true },
    { key: 'shoulder', label: 'Shoulder',       unit: 'in', required: false },
    { key: 'length',   label: 'Garment length', unit: 'in', required: false },
    { key: 'sleeve',   label: 'Sleeve length',  unit: 'in', required: false },
    { key: 'height',   label: 'Your height',    unit: 'in', required: false }
  ]
};
