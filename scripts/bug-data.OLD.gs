/**
 * Bug Dashboard — DATA PIPELINE (bug-data.gs)
 *
 * Handles Jira fetching, Weekly Data writes, the Monday trigger, backfill, and setup.
 * Dashboard rendering lives in bug-dashboards.gs (same Apps Script project).
 *
 * HOW TO USE
 * ──────────
 * 1. Extensions → Apps Script in your Google Sheet.
 * 2. Rename the default "Code.gs" to "bug-data.gs", paste this file.
 * 3. Create a second file "bug-dashboards.gs", paste that file.
 * 4. Run setup() once — stores credentials, builds sheets, creates the trigger.
 * 5. Use the 📊 Bug Dashboard menu for everything else.
 *
 * DATA SCHEMA (Weekly Data sheet — one row per week × product × priority)
 * ────────────────────────────────────────────────────────────────────────
 * A: Week Ending Date  B: Product Key  C: Priority
 * D: Starting Backlog  E: New Submitted  F: Resolved  G: Net Change  H: Ending Backlog
 * I–O: Aging buckets (stored on Priority="Highest" rows only; zeros on others)
 */

// ─── CONFIGURATION ────────────────────────────────────────────────────────────

const CONFIG = {
  jiraBaseUrl:  'https://sysdyne.atlassian.net',
  timezone:     'America/New_York',

  products:     ['IST', 'CBAT', 'CON'],
  productNames: { IST: 'DeliveryGo', CBAT: 'BatchGo', CON: 'ConcreteGo' },
  priorities:   ['Highest', 'High', 'Medium', 'Low', 'Lowest'],

  // Label applied to bugs mass-closed in the backlog cleanup.
  // Used to route status-history queries instead of resolutiondate.
  cleanupLabel: 'backlog-cleanup-05_27_26',

  ageBuckets: [
    { label: '0–1 day',    maxDays: 1        },
    { label: '2–5 days',   maxDays: 5        },
    { label: '6–15 days',  maxDays: 15       },
    { label: '15–30 days', maxDays: 30       },
    { label: '30–60 days', maxDays: 60       },
    { label: '60–90 days', maxDays: 90       },
    { label: '90 days+',   maxDays: Infinity },
  ],

  DATA_SHEET: 'Weekly Data',
  dashboards: {
    Summary: 'Summary Dashboard',
    IST:     'IST Dashboard',
    CBAT:    'CBAT Dashboard',
    CON:     'CON Dashboard',
  },

  priorityColors: {
    Highest: '#d93025',
    High:    '#ea8600',
    Medium:  '#1a73e8',
    Low:     '#34a853',
    Lowest:  '#5f6368',
  },
};

// ─── MENU ─────────────────────────────────────────────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📊 Bug Dashboard')
    .addItem("Run this week's update", 'runWeeklyUpdate')
    .addItem('Backfill history…',      'runBackfill')
    .addSeparator()
    .addItem('Restore all dashboards', 'restoreDashboard')
    .addItem('Setup / reconfigure…',   'setup')
    .addToUi();
}

// ─── JIRA API ─────────────────────────────────────────────────────────────────

function getAuth_() {
  const p     = PropertiesService.getScriptProperties();
  const email = p.getProperty('JIRA_EMAIL');
  const token = p.getProperty('JIRA_API_TOKEN');
  if (!email || !token) throw new Error('Jira credentials missing — run setup() first.');
  return Utilities.base64Encode(email + ':' + token);
}

function jiraSearch_(jql, fields) {
  const auth   = getAuth_();
  const issues = [];
  let nextPageToken = null;

  do {
    var params =
      '?jql='        + encodeURIComponent(jql) +
      '&fields='     + encodeURIComponent(fields.join(',')) +
      '&maxResults=100';
    if (nextPageToken) params += '&nextPageToken=' + encodeURIComponent(nextPageToken);

    const url = CONFIG.jiraBaseUrl + '/rest/api/3/search/jql' + params;
    const res = UrlFetchApp.fetch(url, {
      method:             'get',
      headers:            { Authorization: 'Basic ' + auth, Accept: 'application/json' },
      muteHttpExceptions: true,
    });

    if (res.getResponseCode() !== 200) {
      throw new Error(
        'Jira API error ' + res.getResponseCode() + ': ' +
        res.getContentText().slice(0, 300)
      );
    }

    const body = JSON.parse(res.getContentText());
    Array.prototype.push.apply(issues, body.issues);
    if (body.isLast || !body.nextPageToken) break;
    nextPageToken = body.nextPageToken;
  } while (true);

  return issues;
}

function countByPriority_(issues) {
  const counts = {};
  CONFIG.priorities.forEach(function(p) { counts[p] = 0; });
  issues.forEach(function(issue) {
    const name = issue.fields.priority && issue.fields.priority.name;
    if (name && name in counts) counts[name]++;
  });
  return counts;
}

// ─── WEEKLY METRICS FETCH ─────────────────────────────────────────────────────
// Open bugs are identified by statusCategory in ("To Do", "In Progress").
// resolutiondate is used as a backstop for historical accuracy on past weeks.
// Bugs tagged with CONFIG.cleanupLabel use status-transition history instead of
// resolutiondate, since the cleanup set their resolutiondate to the cleanup date
// rather than when they were actually addressed.

function fetchWeekMetrics_(projectKey, weekStart, weekEnd) {
  const tz  = CONFIG.timezone;
  const fmt = function(d) { return Utilities.formatDate(d, tz, 'yyyy-MM-dd'); };
  const lbl = CONFIG.cleanupLabel;
  let base = 'project = "' + projectKey + '" AND issuetype = Bug';

  // CON bugs only count once triaged into a release commitment.
  // Exclude any CON bug whose Commitment field (customfield_11212) is empty.
   if (projectKey === 'CON') base += ' AND cf[11212] IS NOT EMPTY';

  const monDate = fmt(weekStart);
  const sunDate = fmt(weekEnd);

  // Open = statusCategory To Do/In Progress (current), OR resolutiondate after
  // the cutoff (historical accuracy for bugs already closed by query time).
  const openAtStart =
    '(statusCategory in ("To Do","In Progress") OR resolutiondate >= "' + monDate + '")';
  const openAtEnd =
    '(statusCategory in ("To Do","In Progress") OR resolutiondate > "' + sunDate + ' 23:59")';

  const startingIssues = jiraSearch_(
    base + ' AND created < "' + monDate + '" AND (' +
      '(labels != "' + lbl + '" AND ' + openAtStart + ')' +
      ' OR ' +
      '(labels = "' + lbl + '" AND NOT status CHANGED TO "Resolved" BEFORE "' + monDate + '")' +
    ')',
    ['priority']
  );

  const newIssues = jiraSearch_(
    base +
    ' AND created >= "' + monDate + '"' +
    ' AND created <= "' + sunDate + ' 23:59"',
    ['priority']
  );

  const resolvedIssues = jiraSearch_(
    base + ' AND (' +
      '(labels != "' + lbl + '" AND resolutiondate >= "' + monDate + '" AND resolutiondate <= "' + sunDate + ' 23:59")' +
      ' OR ' +
      '(labels = "' + lbl + '" AND status CHANGED TO "Resolved" DURING ("' + monDate + '","' + sunDate + ' 23:59"))' +
    ')',
    ['priority']
  );

  const endingIssues = jiraSearch_(
    base + ' AND created <= "' + sunDate + ' 23:59" AND (' +
      '(labels != "' + lbl + '" AND ' + openAtEnd + ')' +
      ' OR ' +
      '(labels = "' + lbl + '" AND NOT status CHANGED TO "Resolved" BEFORE "' + sunDate + ' 23:59")' +
    ')',
    ['priority', 'created']
  );

  const agingCounts = {};
  CONFIG.ageBuckets.forEach(function(b) { agingCounts[b.label] = 0; });
  const endMs = weekEnd.getTime();
  endingIssues.forEach(function(issue) {
    const ageDays = Math.floor((endMs - new Date(issue.fields.created).getTime()) / 86400000);
    const bucket  = CONFIG.ageBuckets.filter(function(b) { return ageDays <= b.maxDays; })[0];
    if (bucket) agingCounts[bucket.label]++;
  });

  return {
    starting: countByPriority_(startingIssues),
    new:      countByPriority_(newIssues),
    resolved: countByPriority_(resolvedIssues),
    ending:   countByPriority_(endingIssues),
    aging:    agingCounts,
  };
}

// ─── WEEKLY DATA SHEET ────────────────────────────────────────────────────────

function initDataSheet_(sheet) {
  sheet.clear();
  const headers = [
    'Week Ending Date', 'Product Key', 'Priority',
    'Starting Backlog', 'New Submitted', 'Resolved', 'Net Change', 'Ending Backlog',
  ];
  CONFIG.ageBuckets.forEach(function(b) { headers.push('Age: ' + b.label); });

  sheet.getRange(1, 1, 1, headers.length)
       .setValues([headers])
       .setFontWeight('bold')
       .setBackground('#f1f3f4');
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);
}

// ─── SHARED UTILITY ───────────────────────────────────────────────────────────

/** Converts a 1-based column number to a letter (e.g. 10 → "J", 27 → "AA").
 *  Used by both the data writer and the dashboard pivot helpers. */
function colLetter_(n) {
  var s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) {
    s = String.fromCharCode(65 + (n - 1) % 26) + s;
  }
  return s;
}

// ─── DATA WRITER ─────────────────────────────────────────────────────────────

function writeMetricsToLedgerRows_(sheet, weekEnd, productKey, metrics) {
  const p    = CONFIG.priorities;
  const rows = [];

  p.forEach(function(pr) {
    const startingVal = metrics.starting[pr] || 0;
    const newVal      = metrics.new[pr]      || 0;
    const resolvedVal = metrics.resolved[pr] || 0;
    const netVal      = newVal - resolvedVal;
    const endingVal   = metrics.ending[pr]   || 0;

    const row = [weekEnd, productKey, pr, startingVal, newVal, resolvedVal, netVal, endingVal];

    // Aging stored on Highest row only; zeros on all others (avoids double-counting in SUMIFS)
    CONFIG.ageBuckets.forEach(function(b) {
      row.push(pr === 'Highest' ? (metrics.aging[b.label] || 0) : 0);
    });

    rows.push(row);
  });

  const nextRow = sheet.getLastRow() + 1;
  sheet.getRange(nextRow, 1, rows.length, rows[0].length).setValues(rows);
}

// ─── ENTRY POINTS ─────────────────────────────────────────────────────────────

/** Triggered every Monday at 6 AM. Checks each product individually so a
 *  partial run (e.g. timeout) can be resumed without losing already-written data. */
function runWeeklyUpdate() {
  const ss      = SpreadsheetApp.getActiveSpreadsheet();
  const dataTab = ss.getSheetByName(CONFIG.DATA_SHEET);
  if (!dataTab) throw new Error('Weekly Data sheet not found — run setup() first.');

  const weekEnd   = getLastSunday_();
  const weekStart = weekStartFromSunday_(weekEnd);
  const dateStr   = Utilities.formatDate(weekEnd, CONFIG.timezone, 'yyyy-MM-dd');

  let anyWritten = false;
  CONFIG.products.forEach(function(productKey) {
    if (isProductWeekRecorded_(dataTab, dateStr, productKey)) {
      Logger.log('Skipping ' + productKey + ' / ' + dateStr + ' — already recorded.');
      return;
    }
    Logger.log('Fetching ' + productKey + ' for week ending ' + dateStr + '…');
    const metrics = fetchWeekMetrics_(productKey, weekStart, weekEnd);
    writeMetricsToLedgerRows_(dataTab, weekEnd, productKey, metrics);
    anyWritten = true;
    Utilities.sleep(250);
  });

  if (anyWritten) SpreadsheetApp.flush();
}

/** Prompts for a start Monday, backfills every week × every product.
 *  Re-running is safe — already-recorded (week, product) pairs are skipped. */
function runBackfill() {
  const ui   = SpreadsheetApp.getUi();
  const resp = ui.prompt(
    'Backfill History',
    'Enter the Monday date to start from (YYYY-MM-DD).\n' +
    'All weeks through last Sunday will be loaded for: ' +
    CONFIG.products.join(', ') + '\n\n' +
    'Example: 2026-01-05',
    ui.ButtonSet.OK_CANCEL
  );
  if (resp.getSelectedButton() !== ui.Button.OK) return;

  const dateStr = resp.getResponseText().trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    ui.alert('Invalid format — use YYYY-MM-DD.');
    return;
  }

  backfill(dateStr);
  ui.alert('Backfill complete!\n\nIf it timed out before finishing, run it again — already-loaded weeks are skipped.');
}

function backfill(startMondayStr) {
  const ss      = SpreadsheetApp.getActiveSpreadsheet();
  const dataTab = ss.getSheetByName(CONFIG.DATA_SHEET);
  if (!dataTab) throw new Error('Weekly Data sheet not found — run setup() first.');

  const lastSun = getLastSunday_();
  const parts   = startMondayStr.split('-');
  const weekStart = new Date(
    parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10),
    0, 0, 0, 0
  );

  while (true) {
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 0);
    if (weekEnd > lastSun) break;

    const loopDateStr = Utilities.formatDate(weekEnd, CONFIG.timezone, 'yyyy-MM-dd');

    CONFIG.products.forEach(function(productKey) {
      if (isProductWeekRecorded_(dataTab, loopDateStr, productKey)) {
        Logger.log('Skipping ' + productKey + ' / ' + loopDateStr);
        return;
      }
      Logger.log('Backfilling ' + productKey + ' for week ending ' + loopDateStr + '…');
      const metrics = fetchWeekMetrics_(productKey, weekStart, weekEnd);
      writeMetricsToLedgerRows_(dataTab, weekEnd, productKey, metrics);
      Utilities.sleep(400);
    });

    weekStart.setDate(weekStart.getDate() + 7);
  }

  Logger.log('Backfill complete.');
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

/** Returns true if a (date, product) pair already has rows in the data sheet. */
function isProductWeekRecorded_(sheet, dateStrTarget, productKey) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  const data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  for (var i = 0; i < data.length; i++) {
    if (!(data[i][0] instanceof Date)) continue;
    const fmt = Utilities.formatDate(data[i][0], CONFIG.timezone, 'yyyy-MM-dd');
    if (fmt === dateStrTarget && data[i][1] === productKey) return true;
  }
  return false;
}

function getLastSunday_() {
  var now  = new Date();
  var day  = now.getDay();              // 0=Sun … 6=Sat
  var back = (day === 0) ? 7 : day;
  var sun  = new Date(now);
  sun.setDate(now.getDate() - back);
  sun.setHours(23, 59, 59, 0);         // match weekEnd time for correct > comparison
  return sun;
}

function weekStartFromSunday_(sun) {
  var mon = new Date(sun);
  mon.setDate(sun.getDate() - 6);
  mon.setHours(0, 0, 0, 0);
  return mon;
}

// ─── SETUP ────────────────────────────────────────────────────────────────────

function setup() {
  const ui = SpreadsheetApp.getUi();

  const emailResp = ui.prompt('Jira Setup (1/2)', 'Enter your Jira email address:', ui.ButtonSet.OK_CANCEL);
  if (emailResp.getSelectedButton() !== ui.Button.OK) return;

  const tokenResp = ui.prompt(
    'Jira Setup (2/2)',
    'Enter your Jira API token\n(generate at id.atlassian.net → Security → API tokens):',
    ui.ButtonSet.OK_CANCEL
  );
  if (tokenResp.getSelectedButton() !== ui.Button.OK) return;

  PropertiesService.getScriptProperties().setProperties({
    JIRA_EMAIL:     emailResp.getResponseText().trim(),
    JIRA_API_TOKEN: tokenResp.getResponseText().trim(),
  });

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Only initialize Weekly Data if it doesn't exist yet — never wipe existing data
  let dataTab = ss.getSheetByName(CONFIG.DATA_SHEET);
  if (!dataTab) {
    dataTab = ss.insertSheet(CONFIG.DATA_SHEET);
    initDataSheet_(dataTab);
  }

  restoreDashboard(); // defined in bug-dashboards.gs

  // (Re-)create the Monday 6 AM trigger
  ScriptApp.getProjectTriggers()
    .filter(function(t) { return t.getHandlerFunction() === 'runWeeklyUpdate'; })
    .forEach(function(t) { ScriptApp.deleteTrigger(t); });

  ScriptApp.newTrigger('runWeeklyUpdate')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(6)
    .create();

  ui.alert(
    'Setup complete!\n\n' +
    '✓ Weekly Data sheet ready\n' +
    '✓ Dashboards: Summary, ' + CONFIG.products.join(', ') + '\n' +
    '✓ Weekly trigger: every Monday at 6 AM\n\n' +
    'Next:\n' +
    "  • Run \"Run this week's update\" to load this week\n" +
    '  • Run "Backfill history…" to load earlier weeks'
  );
}
