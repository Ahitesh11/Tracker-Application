/**
 * Forma → Google Sheet receiver (Apps Script Web App).
 *
 * The backend POSTs JSON here; this script writes it into the spreadsheet.
 * Setup is described in README.md in this folder.
 */

// Your spreadsheet ID (from the sheet URL).
var SPREADSHEET_ID = '1aOKO0KZB8x40Y66pSGxAqma0hr_ar1Nin09Vu4AbpKU';

// Shared secret. Must be exactly the same as GOOGLE_APPS_SCRIPT_SECRET in backend/.env.
var SECRET = 'CHANGE-ME-to-a-long-random-text';

// Only these tabs may be written. Anything else is rejected.
var ALLOWED_TABS = ['Activity_Log', 'Products'];

/** Health check: open the web app URL in a browser to see that it is deployed. */
function doGet() {
  return json_({ ok: true, service: 'forma-sheet-receiver' });
}

/**
 * Body: { secret, action: 'append' | 'replace', tab, headers: [...], rows: [[...], ...] }
 *  - append  : adds rows at the bottom of the tab (creates the tab + header row if missing)
 *  - replace : clears the tab and writes headers + rows
 */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var body = JSON.parse(e.postData.contents);

    if (!SECRET || body.secret !== SECRET) return json_({ ok: false, error: 'Unauthorized' });

    if (ALLOWED_TABS.indexOf(body.tab) === -1) return json_({ ok: false, error: 'Tab not allowed: ' + body.tab });
    if (body.action !== 'append' && body.action !== 'replace') return json_({ ok: false, error: 'Unknown action' });

    var headers = body.headers || [];
    var rows = body.rows || [];
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(body.tab) || ss.insertSheet(body.tab);

    if (body.action === 'replace') {
      sheet.clearContents();
      write_(sheet, 1, [headers].concat(rows));
    } else {
      if (sheet.getLastRow() === 0 && headers.length) write_(sheet, 1, [headers]);
      if (rows.length) write_(sheet, sheet.getLastRow() + 1, rows);
    }
    if (headers.length) sheet.setFrozenRows(1);

    return json_({ ok: true, tab: body.tab, action: body.action, rows: rows.length });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/** Writes a 2D array starting at column A. Rows may differ in length, so pad them. */
function write_(sheet, startRow, values) {
  if (!values.length) return;
  var width = values.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
  var padded = values.map(function (r) {
    var copy = r.slice();
    while (copy.length < width) copy.push('');
    return copy;
  });
  sheet.getRange(startRow, 1, padded.length, width).setValues(padded);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
