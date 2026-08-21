/**
 * Weekly Fails → Google Sheet
 * ===========================
 *
 * Pulls every audit from last week that either died on an invalid genie, or was
 * STILL failing after a human reviewed it.
 *
 * It writes onto THE SHEET THE BUTTON IS ON. That tab is wiped first, so every
 * pull is a clean replacement rather than rows piling up. Your button survives
 * the wipe — buttons float above the grid, they are not cell contents.
 *
 * NOTE ON THIS FILE: Google Apps Script runs JavaScript, not TypeScript. The
 * code below is plain Apps Script JS — paste it in exactly as-is. (The .ts name
 * is just what the file was asked to be called; there is nothing to compile.)
 *
 * ── Setup, one time ────────────────────────────────────────────────────────
 *  1. Open your spreadsheet → Extensions → Apps Script.
 *  2. Delete whatever is in Code.gs, paste this whole file in, click Save.
 *  3. Reload the spreadsheet. A "Audits" menu appears next to Help.
 *
 * ── To put it on a button ──────────────────────────────────────────────────
 *  1. In the sheet: Insert → Drawing → draw a box, type "Pull Last Week",
 *     click Save and Close.
 *  2. Click the new button, then the three dots on its corner →
 *     "Assign script".
 *  3. Type exactly:  pullWeeklyFails
 *  4. Click the button. The first time, Google asks you to allow the script —
 *     that is expected, it needs permission to write to the sheet and to call
 *     the AutoBot server.
 */

// ── Settings ────────────────────────────────────────────────────────────────

/** The AutoBot server. Change this only if the app moves to a new address. */
var BASE_URL = 'https://autobottom.thetechgoose.deno.net';

/** Normally blank, which means "write onto whichever sheet is showing" — the
 *  one the button lives on. Put a tab name here to always target that tab
 *  instead, no matter which one happens to be open. */
var TARGET_SHEET_NAME = '';

/** Pull the names of the failed questions too. Set to false to make the pull
 *  roughly twice as fast, at the cost of the "Failed Questions" column. */
var INCLUDE_QUESTIONS = true;

/** The server is doing a big scan, so give it room. Google caps this at 60s. */
var TIMEOUT_NOTE = 'This usually takes 15-30 seconds.';

// ── Menu ────────────────────────────────────────────────────────────────────

/** Adds the "Audits" menu. Runs by itself every time the sheet is opened. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Audits')
    .addItem('Pull last week', 'pullWeeklyFails')
    .addItem('Pull a custom date range...', 'pullWeeklyFailsCustomRange')
    .addToUi();
}

// ── The two things you can run ──────────────────────────────────────────────

/** Last complete Monday-Sunday week. THIS is the one to put on the button. */
function pullWeeklyFails() {
  runPull(null, null);
}

/** Asks for a start and end date, then pulls that range instead. */
function pullWeeklyFailsCustomRange() {
  var ui = SpreadsheetApp.getUi();

  var startAnswer = ui.prompt(
    'Start date',
    'First day to include, as YYYY-MM-DD (for example 2026-08-10):',
    ui.ButtonSet.OK_CANCEL
  );
  if (startAnswer.getSelectedButton() !== ui.Button.OK) return;

  var endAnswer = ui.prompt(
    'End date',
    'Last day to include, as YYYY-MM-DD. This day is included in full:',
    ui.ButtonSet.OK_CANCEL
  );
  if (endAnswer.getSelectedButton() !== ui.Button.OK) return;

  var since = parseDayStart(startAnswer.getResponseText());
  var until = parseDayEnd(endAnswer.getResponseText());

  if (since === null || until === null) {
    ui.alert('Those dates did not look like YYYY-MM-DD. Nothing was changed.');
    return;
  }
  if (until < since) {
    ui.alert('The end date is before the start date. Nothing was changed.');
    return;
  }
  runPull(since, until);
}

// ── The work ────────────────────────────────────────────────────────────────

function runPull(since, until) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.toast('Asking AutoBot for the audits... ' + TIMEOUT_NOTE, 'Working', 45);

  var data;
  try {
    data = fetchWeeklyFails(since, until);
  } catch (err) {
    SpreadsheetApp.getUi().alert(
      'Could not get the audits.\n\n' + err.message +
      '\n\nThe sheet was left exactly as it was.'
    );
    return;
  }

  var rows = data.items || [];
  // Build the whole grid in memory first, so a failure part-way through can
  // never leave the sheet half-wiped and half-written.
  var table = buildTable(rows);

  var sheet = resolveTargetSheet(ss);
  if (!confirmWipe(sheet)) {
    ss.toast('Cancelled. Nothing was changed.', 'Stopped', 5);
    return;
  }
  writeTable(sheet, table, data, since, until);

  ss.toast(
    rows.length + ' audits written (' +
    (data.counts ? data.counts.invalidGenie : '?') + ' invalid genie, ' +
    (data.counts ? data.counts.failedPostReview : '?') + ' failed after review).',
    'Done',
    8
  );
}

/** Calls the endpoint and hands back the parsed response. Throws a message that
 *  is safe to show a human. */
function fetchWeeklyFails(since, until) {
  var url = BASE_URL + '/admin/weekly-fails';
  var params = [];
  if (since !== null && since !== undefined) params.push('since=' + since);
  if (until !== null && until !== undefined) params.push('until=' + until);
  if (!INCLUDE_QUESTIONS) params.push('questions=0');
  if (params.length) url += '?' + params.join('&');

  var response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { accept: 'application/json' },
    muteHttpExceptions: true,
    followRedirects: true
  });

  var status = response.getResponseCode();
  var body = response.getContentText();

  if (status !== 200) {
    throw new Error(
      'The server answered ' + status + '.\n' +
      String(body).slice(0, 300)
    );
  }

  var data;
  try {
    data = JSON.parse(body);
  } catch (e) {
    throw new Error('The server sent something that was not readable data.');
  }
  // The endpoint reports bad input as a normal 200 with an error field.
  if (data && data.error) throw new Error(String(data.error));
  if (!data || !data.items) throw new Error('The reply had no audits in it.');

  return data;
}

var HEADERS = [
  'Settled',
  'Category',
  'Score',
  'Record ID',
  'Genie',
  'VO Name',
  'Employee ID',
  'Department',
  'Shift',
  'Appeal',
  'Failed Questions',
  'Report',
  'Finding ID'
];

/** Turns the API rows into a plain grid, newest last (same order the API sends,
 *  which is oldest-settled first). */
function buildTable(rows) {
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    out.push([
      r.doneAt ? new Date(r.doneAt) : '',
      r.category === 'invalid_genie' ? 'Invalid Genie' : 'Failed After Review',
      typeof r.score === 'number' ? r.score / 100 : '',
      r.recordId || '',
      r.recordingId || '',
      r.voName || '',
      r.employeeId || '',
      r.department || '',
      r.shift || '',
      appealLabel(r.appealStatus),
      (r.failedQuestions || []).join(', '),
      r.reportUrl || '',
      r.findingId || ''
    ]);
  }
  return out;
}

function appealLabel(status) {
  if (status === 'pending') return 'Open appeal';
  if (status === 'complete') return 'Appeal decided';
  return '';
}

/** The sheet to write on: whichever is showing, unless TARGET_SHEET_NAME
 *  names one. */
function resolveTargetSheet(ss) {
  if (TARGET_SHEET_NAME) {
    var named = ss.getSheetByName(TARGET_SHEET_NAME);
    if (named) return named;
    return ss.insertSheet(TARGET_SHEET_NAME);
  }
  return ss.getActiveSheet();
}

/** Wiping is the whole point, so do not nag on a normal refresh — but DO ask
 *  before erasing a sheet that holds something we did not put there. Returns
 *  true when it is safe to proceed. */
function confirmWipe(sheet) {
  if (sheet.getLastRow() === 0) return true;                 // empty, nothing to lose
  if (sheet.getRange(2, 1).getDisplayValue() === HEADERS[0]) return true;  // our own output

  var answer = SpreadsheetApp.getUi().alert(
    'Erase "' + sheet.getName() + '"?',
    'Everything on this tab will be replaced with the audit rows.\n\n' +
    'Buttons and drawings are kept. Cell contents are not.',
    SpreadsheetApp.getUi().ButtonSet.OK_CANCEL
  );
  return answer === SpreadsheetApp.getUi().Button.OK;
}

function writeTable(sheet, table, data, since, until) {
  // clear() wipes values and formats but leaves these two behind, and both
  // break the rewrite: a stale merge blocks the new one, a stale filter throws
  // when a second filter is created over the same range.
  var oldFilter = sheet.getFilter();
  if (oldFilter) oldFilter.remove();
  if (sheet.getLastRow() > 0) {
    sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).breakApart();
  }
  sheet.clear();

  // Row 1: what this is and when it was pulled, so nobody guesses at stale data.
  var tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  var windowText = (data.window && data.window.since)
    ? formatDay(data.window.since, tz) + ' through ' + formatDay(data.window.until, tz)
    : 'unknown range';
  var status = 'Audits ' + windowText +
    '  -  pulled ' + Utilities.formatDate(new Date(), tz, 'MMM d, yyyy h:mm a') +
    '  -  ' + table.length + ' rows' +
    '  -  times shown in ' + tz;

  sheet.getRange(1, 1).setValue(status);
  sheet.getRange(1, 1, 1, HEADERS.length).merge()
    .setFontWeight('bold').setFontSize(11)
    .setBackground('#e8eaed').setVerticalAlignment('middle');

  // Row 2: column headers.
  sheet.getRange(2, 1, 1, HEADERS.length).setValues([HEADERS])
    .setFontWeight('bold').setBackground('#f1f3f4');

  if (table.length > 0) {
    sheet.getRange(3, 1, table.length, HEADERS.length).setValues(table);

    // Dates readable, scores as whole percents.
    sheet.getRange(3, 1, table.length, 1).setNumberFormat('yyyy-mm-dd hh:mm am/pm');
    sheet.getRange(3, 3, table.length, 1).setNumberFormat('0%');

    // Tint the invalid-genie rows so the two kinds are tellable apart at a glance.
    for (var i = 0; i < table.length; i++) {
      if (table[i][1] === 'Invalid Genie') {
        sheet.getRange(3 + i, 1, 1, HEADERS.length).setBackground('#fce8e6');
      }
    }
  } else {
    sheet.getRange(3, 1).setValue('No audits matched for this range.');
  }

  // Header stays put while scrolling, and the columns get a filter.
  sheet.setFrozenRows(2);
  if (table.length > 0) {
    sheet.getRange(2, 1, table.length + 1, HEADERS.length).createFilter();
  }

  for (var c = 1; c <= HEADERS.length; c++) sheet.autoResizeColumn(c);
  // Questions and links get long; cap them so the sheet stays readable.
  sheet.setColumnWidth(11, 320);
  sheet.setColumnWidth(12, 220);
}

// ── Small helpers ───────────────────────────────────────────────────────────

/** "2026-08-10" → epoch ms at 00:00:00 Eastern that day, or null if unparseable.
 *  Eastern on purpose: the audit week is defined in Eastern, so a custom range
 *  should line up with it rather than with wherever the viewer happens to be. */
function parseDayStart(text) {
  var parts = parseYmd(text);
  if (!parts) return null;
  return easternMs(parts[0], parts[1], parts[2], 0, 0, 0, 0);
}

/** Same, but the last millisecond of that day, so the day is fully included. */
function parseDayEnd(text) {
  var parts = parseYmd(text);
  if (!parts) return null;
  return easternMs(parts[0], parts[1], parts[2], 23, 59, 59, 999);
}

function parseYmd(text) {
  var m = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})\s*$/.exec(String(text || ''));
  if (!m) return null;
  var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return [y, mo, d];
}

/** Builds an epoch-ms for a wall-clock time in New York, handling daylight
 *  saving by measuring the zone's actual offset at that moment. */
function easternMs(y, mo, d, hh, mm, ss, ms) {
  var guess = Date.UTC(y, mo - 1, d, hh, mm, ss, ms);
  // What does New York call that instant? The gap between that and the wall
  // clock we wanted IS the offset, including DST.
  var stamp = Utilities.formatDate(new Date(guess), 'America/New_York', 'yyyy-MM-dd HH:mm:ss');
  var p = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(stamp);
  if (!p) return guess;
  var seenAsUtc = Date.UTC(
    Number(p[1]), Number(p[2]) - 1, Number(p[3]),
    Number(p[4]), Number(p[5]), Number(p[6]), ms
  );
  return guess + (guess - seenAsUtc);
}

function formatDay(ms, tz) {
  return Utilities.formatDate(new Date(ms), tz, 'MMM d, yyyy');
}
