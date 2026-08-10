// Vedam — Book a Fitting → Google Sheet
// Setup (one time, ~5 minutes):
//   1. Create a NEW Google Sheet (e.g. "Vedam Fitting Requests").
//   2. In that sheet: Extensions → Apps Script. Delete the sample code and paste this file.
//   3. Click Deploy → New deployment → type: Web app.
//        - Execute as: Me
//        - Who has access: Anyone
//      Authorize when prompted, then copy the Web app URL (ends in /exec).
//   4. Give Claude that URL (or paste it yourself into book-a-fitting.html,
//      replacing PASTE_FITTING_SHEET_WEB_APP_URL in both places it appears).
//
// This is intentionally a SEPARATE sheet + deployment from the Contact Us form.

var HEADERS = ['Timestamp', 'Name', 'Email', 'Phone', 'Fitting Type', 'Collection', 'Preferred Date', 'Preferred Time', 'Shipping Address', 'Notes'];

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS);
      sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    }
    var p = (e && e.parameter) || {};
    var clip = function (v, n) { return String(v || '').slice(0, n); };
    sheet.appendRow([
      new Date(),
      clip(p.name, 100),
      clip(p.email, 200),
      clip(p.phone, 30),
      clip(p.fittingType, 60),
      clip(p.collection, 50),
      clip(p.date, 20),
      clip(p.time, 20),
      clip(p.address, 400),
      clip(p.notes, 4000)
    ]);
    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}
