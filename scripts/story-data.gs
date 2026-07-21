/**
 * Story Dashboard — DATA PIPELINE (story-data.gs)
 *
 * Weekly feature-flow metrics for Stories (the bug tracker's sibling).
 * Where the bug pipeline measures BACKLOG HEALTH (size / staleness), this one
 * measures FLOW: how many features we're working on, starting, and shipping.
 *
 * Lives in the SAME Apps Script project as bug-data.gs and reuses its shared
 * globals — jiraSearch_(), getAuth_(), colLetter_(), getLastSunday_(),
 * weekStartFromSunday_(), isProductWeekRecorded_(), and CONFIG.jiraBaseUrl /
 * CONFIG.timezone. It writes to its own "Weekly Stories" sheet and never
 * touches the bug "Weekly Data" sheet.
 *
 * HOW TO USE
 * ──────────
 * 1. Paste this as a new file "story-data.gs" alongside bug-data.gs.
 * 2. Jira credentials are shared — if bug setup() has already run, you're set.
 * 3. Run setupStories() once — builds the Weekly Stories sheet + Monday trigger.
 * 4. Use the 📈 Story Dashboard menu (added by bug-data.gs onOpen).
 *
 * DATA SCHEMA (Weekly Stories sheet — one row per week × product)
 * ───────────────────────────────────────────────────────────────
 * A: Week Ending Date   B: Product Key
 * C: Created            D: Started          E: Completed     F: Net (C−E)
 * G: Open Backlog (end) H: WIP (end)        I: WIP (Active Sprint — current week only)
 * J: Points Created     K: Points Completed L: Points In Progress
 */

// ─── CONFIGURATION ────────────────────────────────────────────────────────────

const STORY_CONFIG = {
  // Products mirror the bug tracker. Jira base URL + timezone are inherited
  // from bug-data.gs CONFIG (same project) via jiraSearch_().
  products:     ['IST', 'CBAT', 'CON'],
  productNames: { IST: 'DeliveryGo', CBAT: 'BatchGo', CON: 'ConcreteGo' },

  storyIssueType: 'Story',

  // Status NAMES grouped by category. JQL's WAS/CHANGED operators match status
  // NAMES (not statusCategory), so we enumerate them. Verified against the live
  // workflow June 2026 — add any new statuses here if the workflow changes.
  //   To Do       → backlog (not started)
  //   In Progress → actively being worked (WIP)
  //   Done        → shipped / dev-complete  (GA is the most common done status)
  statuses: {
    toDo:       ['Open', 'Blocked'],
    inProgress: ['In Progress', 'Testing'],
    done:       ['GA', 'Closed', 'Resolved', 'Awaiting Release'],
  },

  // Story-point field differs per project (verified June 2026):
  //   IST  → customfield_10037 "Story Points"         (only field populated)
  //   CBAT → customfield_10037 "Story Points"         (mixed; 10037 is the default)
  //   CON  → customfield_10054 "Story point estimate" (full coverage; 10037 partial)
  // We read each product's primary field and fall back to the other when empty,
  // so a story estimated in either field still counts. If a product's primary
  // is wrong, just flip it here — no other code changes needed.
  pointsFields:  ['customfield_10037', 'customfield_10054'],
  pointsPrimary: { IST: 'customfield_10037', CBAT: 'customfield_10037', CON: 'customfield_10054' },

  // CON stories (like CON bugs) only count once triaged into a release
  // commitment — exclude any story whose Commitment field is empty. Mirrors the
  // bug pipeline's cf[11212] rule. commitmentField is the JQL clause form.
  commitmentField:       'cf[11212]',
  commitmentRequiredFor: ['CON'],

  // "Active Work" = WIP narrowed to stories in a currently-open sprint. This
  // strips out zombie/uncommitted In-Progress work. openSprints() is evaluated
  // at query time (Jira has no "open sprint AS OF a past date"), so it's only
  // meaningful for the current week — backfilled rows leave the column blank and
  // the weekly run builds a true forward history. Set false to skip the metric.
  trackActiveSprintWip: true,

  DATA_SHEET: 'Weekly Stories',
};

// ─── MENU NOTE ──────────────────────────────────────────────────────────────
// Apps Script allows only one onOpen() per project. The 📈 Story Dashboard menu
// is created inside bug-data.gs onOpen() (it calls addStoryMenu_ below) so both
// trackers share a single onOpen. Keep addStoryMenu_ here with the story code.

function addStoryMenu_() {
  SpreadsheetApp.getUi()
    .createMenu('📈 Story Dashboard')
    .addItem("Run this week's update", 'runWeeklyStoryUpdate')
    .addItem('Backfill history…',      'runStoryBackfill')
    .addSeparator()
    .addItem('Setup / reconfigure…',   'setupStories')
    .addToUi();
}

// ─── JQL HELPERS ──────────────────────────────────────────────────────────────

/** Quotes a single value for JQL: In Progress → "In Progress". */
function jqlQuote_(s) { return '"' + String(s).replace(/"/g, '\\"') + '"'; }

/** Comma-joined quoted name list for IN (...) clauses. */
function jqlNameList_(arr) { return arr.map(jqlQuote_).join(','); }

// ─── STORY-POINT EXTRACTION ─────────────────────────────────────────────────────

function toNumberOrNull_(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isNaN(v) ? null : v;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

/** Story points for one issue: product's primary field, else the other field. */
function pointFor_(issue, productKey) {
  const fields  = (issue && issue.fields) || {};
  const primary = STORY_CONFIG.pointsPrimary[productKey] || STORY_CONFIG.pointsFields[0];
  const other   = STORY_CONFIG.pointsFields.filter(function(f) { return f !== primary; })[0];

  const p = toNumberOrNull_(fields[primary]);
  if (p !== null) return p;
  const o = other ? toNumberOrNull_(fields[other]) : null;
  return o !== null ? o : 0;
}

function sumPoints_(issues, productKey) {
  return issues.reduce(function(sum, it) { return sum + pointFor_(it, productKey); }, 0);
}

// ─── WEEKLY METRICS FETCH ─────────────────────────────────────────────────────
// Snapshots (Backlog / WIP at week end) use `status WAS IN (...) ON <Sunday>` for
// exact point-in-time history (works on backfill too). Flow counts (Started /
// Completed) use `status CHANGED TO (...) DURING (...)` so they're robust to the
// multi-status Done workflow — resolutiondate is NOT used, since GA (the most
// common done status) does not reliably set one.

function fetchStoryWeekMetrics_(projectKey, weekStart, weekEnd) {
  const tz  = CONFIG.timezone;
  const fmt = function(d) { return Utilities.formatDate(d, tz, 'yyyy-MM-dd'); };

  const monDate = fmt(weekStart);
  const sunDate = fmt(weekEnd);
  const isCurrentWeek = (sunDate === fmt(getLastSunday_()));

  let base     = 'project = "' + projectKey + '" AND issuetype = ' + jqlQuote_(STORY_CONFIG.storyIssueType);
  // CON commitment gate — applies to every metric below. Excludes uncommitted
  // stories and the "Cleanup" commitment value (housekeeping, not real work) —
  // same rule as the bug pipeline.
  if (STORY_CONFIG.commitmentRequiredFor.indexOf(projectKey) !== -1) {
    base += ' AND ' + STORY_CONFIG.commitmentField + ' IS NOT EMPTY' +
            ' AND ' + STORY_CONFIG.commitmentField + ' != "Cleanup"';
  }
  const toDo   = jqlNameList_(STORY_CONFIG.statuses.toDo);
  const inProg = jqlNameList_(STORY_CONFIG.statuses.inProgress);
  const done   = jqlNameList_(STORY_CONFIG.statuses.done);

  const pointFields = STORY_CONFIG.pointsFields.slice();  // for sum queries
  const countField  = ['status'];                          // minimal for count-only

  // Created this week
  const createdIssues = jiraSearch_(
    base + ' AND created >= "' + monDate + '" AND created <= "' + sunDate + ' 23:59"',
    pointFields
  );

  // Started this week — entered any In Progress status during the window
  const startedIssues = jiraSearch_(
    base + ' AND status CHANGED TO (' + inProg + ') DURING ("' + monDate + '","' + sunDate + ' 23:59")',
    countField
  );

  // Completed this week — entered any Done status during the window
  const completedIssues = jiraSearch_(
    base + ' AND status CHANGED TO (' + done + ') DURING ("' + monDate + '","' + sunDate + ' 23:59")',
    pointFields
  );

  // Open backlog at week end — in a To Do status as of Sunday
  const backlogIssues = jiraSearch_(
    base + ' AND status WAS IN (' + toDo + ') ON "' + sunDate + '"',
    countField
  );

  // WIP at week end — in an In Progress status as of Sunday
  const wipIssues = jiraSearch_(
    base + ' AND status WAS IN (' + inProg + ') ON "' + sunDate + '"',
    pointFields
  );

  // Active-sprint WIP — same In Progress snapshot, narrowed to stories in a
  // currently-open sprint. Only the current week: openSprints() is now-relative,
  // so historical/backfill rows leave this blank (null) and the weekly run
  // accrues a true forward history. The gap (WIP − Active Sprint) = stalled or
  // uncommitted in-progress work.
  let wipActiveSprint = null;
  if (STORY_CONFIG.trackActiveSprintWip && isCurrentWeek) {
    wipActiveSprint = jiraSearch_(
      base + ' AND status WAS IN (' + inProg + ') ON "' + sunDate + '" AND sprint in openSprints()',
      ['status']
    ).length;
  }

  const created   = createdIssues.length;
  const completed  = completedIssues.length;

  return {
    created:         created,
    started:         startedIssues.length,
    completed:       completed,
    net:             created - completed,
    backlogEnd:      backlogIssues.length,
    wipEnd:          wipIssues.length,
    wipActiveSprint: wipActiveSprint,   // null on historical/backfill weeks → blank cell
    pointsCreated:   sumPoints_(createdIssues,   projectKey),
    pointsCompleted: sumPoints_(completedIssues, projectKey),
    pointsWip:       sumPoints_(wipIssues,        projectKey),
  };
}

// ─── WEEKLY STORIES SHEET ─────────────────────────────────────────────────────

function initStoryDataSheet_(sheet) {
  sheet.clear();
  const headers = [
    'Week Ending Date', 'Product Key',
    'Created', 'Started', 'Completed', 'Net Change',
    'Open Backlog', 'WIP', 'WIP (Active Sprint)',
    'Points Created', 'Points Completed', 'Points In Progress',
  ];
  sheet.getRange(1, 1, 1, headers.length)
       .setValues([headers])
       .setFontWeight('bold')
       .setBackground('#f1f3f4');
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);
}

// ─── DATA WRITER ─────────────────────────────────────────────────────────────
// One row per week × product (no priority breakdown — stories don't need it).

function writeStoryMetricsRow_(sheet, weekEnd, productKey, m) {
  const row = [
    weekEnd, productKey,
    m.created, m.started, m.completed, m.net,
    m.backlogEnd, m.wipEnd, (m.wipActiveSprint === null ? '' : m.wipActiveSprint),
    m.pointsCreated, m.pointsCompleted, m.pointsWip,
  ];
  const nextRow = sheet.getLastRow() + 1;
  sheet.getRange(nextRow, 1, 1, row.length).setValues([row]);
}

// ─── ENTRY POINTS ─────────────────────────────────────────────────────────────

/** Triggered every Monday at 6 AM. Per-product skip lets a partial run resume. */
function runWeeklyStoryUpdate() {
  const ss      = SpreadsheetApp.getActiveSpreadsheet();
  const dataTab = ss.getSheetByName(STORY_CONFIG.DATA_SHEET);
  if (!dataTab) throw new Error('Weekly Stories sheet not found — run setupStories() first.');

  const weekEnd   = getLastSunday_();
  const weekStart = weekStartFromSunday_(weekEnd);
  const dateStr   = Utilities.formatDate(weekEnd, CONFIG.timezone, 'yyyy-MM-dd');

  let anyWritten = false;
  STORY_CONFIG.products.forEach(function(productKey) {
    if (isProductWeekRecorded_(dataTab, dateStr, productKey)) {
      Logger.log('Skipping ' + productKey + ' / ' + dateStr + ' — already recorded.');
      return;
    }
    Logger.log('Fetching stories: ' + productKey + ' for week ending ' + dateStr + '…');
    const metrics = fetchStoryWeekMetrics_(productKey, weekStart, weekEnd);
    writeStoryMetricsRow_(dataTab, weekEnd, productKey, metrics);
    anyWritten = true;
    Utilities.sleep(250);
  });

  if (anyWritten) SpreadsheetApp.flush();
}

/** Prompts for a start Monday, backfills every week × every product. Re-running
 *  is safe — already-recorded (week, product) pairs are skipped. */
function runStoryBackfill() {
  const ui   = SpreadsheetApp.getUi();
  const resp = ui.prompt(
    'Backfill Story History',
    'Enter the Monday date to start from (YYYY-MM-DD).\n' +
    'All weeks through last Sunday will be loaded for: ' +
    STORY_CONFIG.products.join(', ') + '\n\n' +
    'Example: 2026-01-05',
    ui.ButtonSet.OK_CANCEL
  );
  if (resp.getSelectedButton() !== ui.Button.OK) return;

  const dateStr = resp.getResponseText().trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    ui.alert('Invalid format — use YYYY-MM-DD.');
    return;
  }

  backfillStories(dateStr);
  ui.alert('Story backfill complete!\n\nIf it timed out before finishing, run it again — already-loaded weeks are skipped.');
}

function backfillStories(startMondayStr) {
  const ss      = SpreadsheetApp.getActiveSpreadsheet();
  const dataTab = ss.getSheetByName(STORY_CONFIG.DATA_SHEET);
  if (!dataTab) throw new Error('Weekly Stories sheet not found — run setupStories() first.');

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

    STORY_CONFIG.products.forEach(function(productKey) {
      if (isProductWeekRecorded_(dataTab, loopDateStr, productKey)) {
        Logger.log('Skipping ' + productKey + ' / ' + loopDateStr);
        return;
      }
      Logger.log('Backfilling stories: ' + productKey + ' for week ending ' + loopDateStr + '…');
      const metrics = fetchStoryWeekMetrics_(productKey, weekStart, weekEnd);
      writeStoryMetricsRow_(dataTab, weekEnd, productKey, metrics);
      Utilities.sleep(400);
    });

    weekStart.setDate(weekStart.getDate() + 7);
  }

  Logger.log('Story backfill complete.');
}

// ─── SETUP ────────────────────────────────────────────────────────────────────
// Credentials are shared with bug-data.gs (same ScriptProperties). Run bug
// setup() first if Jira creds aren't stored yet; getAuth_() will tell you.

function setupStories() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  getAuth_();  // throws a clear error if Jira credentials aren't set yet

  // Only initialize Weekly Stories if it doesn't exist yet — never wipe data.
  let dataTab = ss.getSheetByName(STORY_CONFIG.DATA_SHEET);
  if (!dataTab) {
    dataTab = ss.insertSheet(STORY_CONFIG.DATA_SHEET);
    initStoryDataSheet_(dataTab);
  }

  // (Re-)create the Monday 6 AM trigger for stories.
  ScriptApp.getProjectTriggers()
    .filter(function(t) { return t.getHandlerFunction() === 'runWeeklyStoryUpdate'; })
    .forEach(function(t) { ScriptApp.deleteTrigger(t); });

  ScriptApp.newTrigger('runWeeklyStoryUpdate')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(6)
    .create();

  SpreadsheetApp.getUi().alert(
    'Story setup complete!\n\n' +
    '✓ Weekly Stories sheet ready\n' +
    '✓ Weekly trigger: every Monday at 6 AM\n\n' +
    'Next:\n' +
    "  • Run \"Run this week's update\" to load this week\n" +
    '  • Run "Backfill history…" to load earlier weeks'
  );
}
