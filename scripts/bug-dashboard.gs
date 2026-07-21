/**
 * Bug Dashboard — DASHBOARD RENDERING (bug-dashboards.gs)
 *
 * Builds and restores all dashboard sheets (Summary + per-product).
 * Reads only from the Weekly Data sheet — no Jira calls here.
 * Depends on CONFIG and colLetter_() defined in bug-data.gs (same project, shared scope).
 *
 * Entry point: restoreDashboard()  ← called from setup() and the menu.
 *
 * Safe to edit and re-run without touching the data pipeline.
 * Run "Restore all dashboards" from the menu after making changes.
 */

// ─── PIVOT CONSTANTS ──────────────────────────────────────────────────────────
// Each dashboard writes a hidden QUERY-aggregated pivot at row 200, col J.
// All sparklines, latest-value lookups, and pace formulas reference the pivot
// rather than the raw Weekly Data rows, so they aggregate across priorities
// automatically without complex in-cell formulas.
//
// Pivot column layout (1-based absolute column numbers):
//   J(10)=date  K(11)=Starting  L(12)=New  M(13)=Resolved
//   N(14)=Net   O(15)=Ending    P(16)…V(22)=7 aging buckets

const PIVOT_ROW  = 200;   // header row for the QUERY pivot
const PIVOT_COL  = 10;    // col J (1-based)
const PIVOT_DATA = 201;   // first data row of the pivot

// Pivot column offsets (0 = date col, used with pCol_())
const PC = { date: 0, starting: 1, new_: 2, resolved: 3, net: 4, ending: 5 };

// ─── PIVOT FORMULA HELPERS ────────────────────────────────────────────────────

function pCol_(offset) { return colLetter_(PIVOT_COL + offset); }

/** "Latest non-empty value" lookup from a pivot column (no leading =). */
function pLatest_(offset) {
  const cl = pCol_(offset);
  return (
    'IFERROR(LOOKUP(2,1/(' + cl + PIVOT_DATA + ':' + cl + '<>""),' +
    cl + PIVOT_DATA + ':' + cl + '),0)'
  );
}

/** Second-to-last value from a pivot column — for week-over-week delta (no leading =). */
function pPrev_(offset) {
  const cl = pCol_(offset);
  return (
    'IFERROR(INDEX(' + cl + PIVOT_DATA + ':' + cl + ',' +
    'MAX(1,COUNTA(' + cl + PIVOT_DATA + ':' + cl + ')-1)),0)'
  );
}

/** 4-week rolling average from a pivot column (no leading =). */
function pAvg4_(offset) {
  const cl = pCol_(offset);
  return (
    'IFERROR(AVERAGE(OFFSET(' + cl + PIVOT_DATA + ',' +
    'MAX(0,COUNTA(' + cl + PIVOT_DATA + ':' + cl + ')-4),0,' +
    'MIN(4,COUNTA(' + cl + PIVOT_DATA + ':' + cl + ')),1)),0)'
  );
}

/** SPARKLINE formula string (includes leading =). */
function pSparkLine_(offset, color) {
  const cl = pCol_(offset);
  return (
    '=IFERROR(SPARKLINE(' + cl + PIVOT_DATA + ':' + cl + ',' +
    '{"charttype","line";"color","' + color + '";"linewidth",2}),"")'
  );
}

/** ▲/▼/→ delta label comparing latest vs previous value (includes leading =). */
function pDelta_(offset) {
  const l = pLatest_(offset), pv = pPrev_(offset);
  return (
    '=IF(' + l + '=' + pv + ',"→",' +
    'IF(' + l + '>' + pv + ',"▲ "&ABS(' + l + '-' + pv + '),"▼ "&ABS(' + l + '-' + pv + ')))'
  );
}

/** SUMIFS formula fragment for current-week values from Weekly Data (no leading =). */
function sumifsNow_(resultCol, product, priorityFilter) {
  const dn = CONFIG.DATA_SHEET;
  const isSummary = (product === 'Summary');
  var criteria = "'" + dn + "'!$A:$A,MAX('" + dn + "'!$A:$A)";
  if (!isSummary) criteria += ",'" + dn + "'!$B:$B,\"" + product + "\"";
  if (priorityFilter) criteria += ",'" + dn + "'!$C:$C,\"" + priorityFilter + "\"";
  return 'SUMIFS(' + "'" + dn + "'!$" + resultCol + ':$' + resultCol + ',' + criteria + ')';
}

/** Writes the hidden QUERY pivot (row 200+, col J) that feeds sparklines and pace metrics. */
function buildPivot_(dash, product) {
  const dn = CONFIG.DATA_SHEET;
  const isSummary = (product === 'Summary');
  const where  = isSummary ? 'WHERE A IS NOT NULL' : "WHERE B='" + product + "'";
  const ageCols = 'SUM(I),SUM(J),SUM(K),SUM(L),SUM(M),SUM(N),SUM(O)';
  const query  =
    'SELECT A,SUM(D),SUM(E),SUM(F),SUM(G),SUM(H),' + ageCols + ' ' +
    where + ' GROUP BY A ORDER BY A';

  const pivotHeaders = ['Date', 'Starting', 'New', 'Resolved', 'Net', 'Ending'].concat(
    CONFIG.ageBuckets.map(function(b) { return b.label; })
  );
  dash.getRange(PIVOT_ROW, PIVOT_COL, 1, pivotHeaders.length)
      .setValues([pivotHeaders])
      .setFontColor('#dadce0').setFontSize(7).setBackground('#fafafa');

  dash.getRange(PIVOT_DATA, PIVOT_COL).setFormula(
    "=IFERROR(QUERY('" + dn + "'!$A$2:$O,\"" + query + "\",0),\"\")"
  );
  SpreadsheetApp.flush();
}

// ─── DASHBOARD ENTRY POINT ────────────────────────────────────────────────────

function restoreDashboard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let summaryTab = ss.getSheetByName(CONFIG.dashboards.Summary);
  if (!summaryTab) summaryTab = ss.insertSheet(CONFIG.dashboards.Summary, 0);
  buildSingleDashboard_(summaryTab, 'Summary');

  CONFIG.products.forEach(function(prod, i) {
    let tab = ss.getSheetByName(CONFIG.dashboards[prod]);
    if (!tab) tab = ss.insertSheet(CONFIG.dashboards[prod], i + 1);
    buildSingleDashboard_(tab, prod);
  });

  ss.setActiveSheet(summaryTab);
}

// ─── DASHBOARD BUILDER ────────────────────────────────────────────────────────

function buildSingleDashboard_(dash, product) {
  dash.clear();
  dash.setHiddenGridlines(true);

  const isSummary = (product === 'Summary');
  const title     = isSummary
    ? 'DeliveryGo — Portfolio Summary'
    : (CONFIG.productNames[product] || product) + ' Bug Dashboard';

  // ── Column widths ──────────────────────────────────────────────────────────
  dash.setColumnWidth(1, 215);  // A: metric label
  dash.setColumnWidth(2, 90);   // B: current value
  dash.setColumnWidth(3, 110);  // C: vs last week
  dash.setColumnWidth(4, 185);  // D: trend sparkline
  dash.setColumnWidth(5, 20);   // E: gap
  dash.setColumnWidth(6, 155);  // F: priority / aging label
  dash.setColumnWidth(7, 80);   // G: count

  // ── Row 1: Title + latest week context ────────────────────────────────────
  const dn = CONFIG.DATA_SHEET;
  dash.getRange('A1').setValue(title).setFontSize(16).setFontWeight('bold');
  dash.getRange('B1').setFormula(
    '=IFERROR("Week ending "' +
    '&TEXT(MAX(\'' + dn + '\'!$A:$A),"mm.dd.yy")' +
    '&"  |  "' +
    '&COUNTA(UNIQUE(FILTER(\'' + dn + '\'!$A$2:$A,\'' + dn + '\'!$A$2:$A<>"")))' +
    '&" weeks of data","No data yet")'
  ).setFontColor('#5f6368').setFontSize(10);

  // ── Row 2: 90-day aging alert banner ──────────────────────────────────────
  const aging90  = sumifsNow_('O', product, 'Highest'); // col O = Age 90+ bucket
  const endTotal = sumifsNow_('H', product, null);
  dash.getRange('A2:D2').merge();
  dash.getRange('A2').setFormula(
    '=IFERROR(IF(' + aging90 + '=0,"","⚠  "' +
    '&TEXT(' + aging90 + ',"0")' +
    '&" of "' +
    '&TEXT(' + endTotal + ',"0")' +
    '&" open bugs are 90+ days old — "' +
    '&TEXT(' + aging90 + '/' + endTotal + ',"0%")' +
    '&" of the backlog"),"")'
  ).setFontWeight('bold').setFontSize(11)
   .setBackground('#fce8e6').setFontColor('#c5221f')
   .setVerticalAlignment('middle');
  dash.setRowHeight(2, 36);

  // ── Rows 4–9: THIS WEEK KPIs ───────────────────────────────────────────────
  dash.getRange('A4').setValue('THIS WEEK')
      .setFontWeight('bold').setFontSize(10).setFontColor('#5f6368');
  dash.getRange('A5:D5')
      .setValues([['Metric', 'Value', 'vs Last Week', 'Trend (all weeks)']])
      .setFontWeight('bold').setBackground('#1a73e8').setFontColor('#ffffff');

  const kpis = [
    { label: 'Total Open Backlog', offset: PC.ending,   color: '#1a73e8' },
    { label: 'New Submitted',      offset: PC.new_,     color: '#34a853' },
    { label: 'Resolved',           offset: PC.resolved, color: '#ea4335' },
    { label: 'Net Change',         offset: PC.net,      color: '#fbbc04' },
  ];
  kpis.forEach(function(kpi, i) {
    const r = 6 + i;
    dash.getRange(r, 1).setValue(kpi.label);
    dash.getRange(r, 2).setFormula('=' + pLatest_(kpi.offset))
        .setFontSize(14).setFontWeight('bold').setHorizontalAlignment('center');
    dash.getRange(r, 3).setFormula(pDelta_(kpi.offset))
        .setFontWeight('bold').setHorizontalAlignment('center');
    dash.getRange(r, 4).setFormula(pSparkLine_(kpi.offset, kpi.color));
  });
  dash.setRowHeights(6, 4, 42);

  // ── Rows 11–16: PACE & PROJECTION ─────────────────────────────────────────
  const avgRes = pAvg4_(PC.resolved);
  const avgNew = pAvg4_(PC.new_);
  const endNow = pLatest_(PC.ending);

  dash.getRange('A11').setValue('PACE & PROJECTION (4-week rolling avg)')
      .setFontWeight('bold').setFontSize(10).setFontColor('#5f6368');
  dash.getRange('A12:B12')
      .setValues([['Metric', 'Value']])
      .setFontWeight('bold').setBackground('#1a73e8').setFontColor('#ffffff');

  const paceRows = [
    ['Avg Resolved / Week',
     '=ROUND(' + avgRes + ',1)'],
    ['Avg New / Week',
     '=ROUND(' + avgNew + ',1)'],
    ['Net Weekly Rate',
     '=IFERROR(ROUND(' + avgRes + '-(' + avgNew + '),1)&" / wk","—")'],
    ['Est. Weeks to Clear Backlog',
     '=IFERROR(IF((' + avgRes + '-(' + avgNew + '))>0,' +
     'ROUND(' + endNow + '/(' + avgRes + '-(' + avgNew + ')),0)&" wks","Growing ▲"),"—")'],
  ];
  paceRows.forEach(function(row, i) {
    dash.getRange(13 + i, 1).setValue(row[0]);
    dash.getRange(13 + i, 2).setFormula(row[1])
        .setHorizontalAlignment('center').setFontWeight('bold');
  });

  // ── Cols F–G: OPEN BACKLOG BY PRIORITY (rows 4–10) ────────────────────────
  dash.getRange(4, 6)
      .setValue(isSummary ? 'PORTFOLIO BY PRIORITY' : 'BACKLOG BY PRIORITY')
      .setFontWeight('bold').setFontSize(10).setFontColor('#5f6368');
  dash.getRange(5, 6, 1, 2)
      .setValues([['Priority', 'Current']])
      .setFontWeight('bold').setBackground('#1a73e8').setFontColor('#ffffff');
  CONFIG.priorities.forEach(function(pr, i) {
    dash.getRange(6 + i, 6).setValue(pr);
    dash.getRange(6 + i, 7).setFormula('=' + sumifsNow_('H', product, pr))
        .setFontWeight('bold').setHorizontalAlignment('center');
  });

  // ── Cols F–G: BACKLOG AGING (rows 13+) ────────────────────────────────────
  const agingStartRow = 13;
  dash.getRange(agingStartRow, 6).setValue('BACKLOG AGING — CURRENT WEEK')
      .setFontWeight('bold').setFontSize(10).setFontColor('#5f6368');
  dash.getRange(agingStartRow + 1, 6, 1, 2)
      .setValues([['Age Bucket', 'Count']])
      .setFontWeight('bold').setBackground('#1a73e8').setFontColor('#ffffff');
  CONFIG.ageBuckets.forEach(function(b, i) {
    const ageColLetter = colLetter_(9 + i); // col I = bucket 0, J = bucket 1, …
    dash.getRange(agingStartRow + 2 + i, 6).setValue(b.label);
    dash.getRange(agingStartRow + 2 + i, 7)
        .setFormula('=' + sumifsNow_(ageColLetter, product, 'Highest'))
        .setHorizontalAlignment('center');
  });

  // ── Summary-only: cross-product comparison table ───────────────────────────
  if (isSummary) {
    const cmpStartRow = agingStartRow + 2 + CONFIG.ageBuckets.length + 2;
    dash.getRange(cmpStartRow, 1).setValue('PRODUCT COMPARISON — CURRENT WEEK')
        .setFontWeight('bold').setFontSize(10).setFontColor('#5f6368');
    dash.getRange(cmpStartRow + 1, 1, 1, 4)
        .setValues([['Product', 'Open', 'New', 'Resolved']])
        .setFontWeight('bold').setBackground('#1a73e8').setFontColor('#ffffff');
    CONFIG.products.forEach(function(prod, i) {
      const r = cmpStartRow + 2 + i;
      dash.getRange(r, 1).setValue(CONFIG.productNames[prod] || prod);
      dash.getRange(r, 2).setFormula('=' + sumifsNow_('H', prod, null))
          .setHorizontalAlignment('center').setFontWeight('bold');
      dash.getRange(r, 3).setFormula('=' + sumifsNow_('E', prod, null))
          .setHorizontalAlignment('center');
      dash.getRange(r, 4).setFormula('=' + sumifsNow_('F', prod, null))
          .setHorizontalAlignment('center');
    });
  }

  // ── Conditional formatting ─────────────────────────────────────────────────
  const rules = [];
  const RED_BG = '#fce8e6', RED_FG = '#c5221f';
  const GRN_BG = '#e6f4ea', GRN_FG = '#137333';

  function arrowRule(range, upFg, upBg, downFg, downBg) {
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains('▲').setFontColor(upFg).setBackground(upBg)
      .setRanges([range]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains('▼').setFontColor(downFg).setBackground(downBg)
      .setRanges([range]).build());
  }

  arrowRule(dash.getRange(6, 3), RED_FG, RED_BG, GRN_FG, GRN_BG);     // Open: up=bad
  arrowRule(dash.getRange(7, 3), RED_FG, '#ffffff', GRN_FG, '#ffffff'); // New: text only
  arrowRule(dash.getRange(8, 3), GRN_FG, GRN_BG, RED_FG, RED_BG);     // Resolved: up=good
  arrowRule(dash.getRange(9, 3), RED_FG, RED_BG, GRN_FG, GRN_BG);     // Net: up=bad

  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenNumberGreaterThan(0).setBackground(RED_BG).setFontColor(RED_FG).setBold(true)
    .setRanges([dash.getRange(9, 2)]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenNumberLessThan(0).setBackground(GRN_BG).setFontColor(GRN_FG).setBold(true)
    .setRanges([dash.getRange(9, 2)]).build());

  // 90+ aging row highlighted red when non-zero
  const aging90Row = agingStartRow + 2 + CONFIG.ageBuckets.length - 1;
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenNumberGreaterThan(0).setBackground(RED_BG).setFontColor(RED_FG).setBold(true)
    .setRanges([dash.getRange(aging90Row, 6, 1, 2)]).build());

  dash.setConditionalFormatRules(rules);

  // ── Hidden pivot (row 200+) then charts ───────────────────────────────────
  buildPivot_(dash, product);
  buildCharts_(dash, product);
}

// ─── EMBEDDED CHARTS ──────────────────────────────────────────────────────────

function buildCharts_(dash, product) {
  dash.getCharts().forEach(function(c) { dash.removeChart(c); });

  const ss        = SpreadsheetApp.getActiveSpreadsheet();
  const dataSheet = ss.getSheetByName(CONFIG.DATA_SHEET);
  if (!dataSheet) return;

  const lastRow = dataSheet.getLastRow();
  if (lastRow < 2) return;

  const isSummary   = (product === 'Summary');
  const numDataCols = 8 + CONFIG.ageBuckets.length;
  const allData     = dataSheet.getRange(2, 1, lastRow - 1, numDataCols).getValues();

  const rows = allData.filter(function(r) {
    return r[0] && (isSummary || r[1] === product);
  });
  if (rows.length === 0) return;

  // Unique sorted week-end dates
  const dateKeys = [];
  const dateMap  = {};
  rows.forEach(function(r) {
    const d   = r[0];
    const key = d instanceof Date ? d.getTime() : new Date(d).getTime();
    if (!dateMap[key]) { dateMap[key] = d; dateKeys.push(key); }
  });
  dateKeys.sort(function(a, b) { return a - b; });

  const p = CONFIG.priorities;

  // Chart 1 data: stacked area — Ending Backlog by priority over time
  const areaTable = [['Date'].concat(p)];
  dateKeys.forEach(function(key) {
    const d       = dateMap[key];
    const dateStr = d instanceof Date
      ? Utilities.formatDate(d, CONFIG.timezone, 'MM.dd.yy') : String(d);
    const aRow = [dateStr];
    p.forEach(function(pr) {
      const match = rows.filter(function(r) {
        const k = r[0] instanceof Date ? r[0].getTime() : new Date(r[0]).getTime();
        return k === key && r[2] === pr;
      })[0];
      aRow.push(match ? (match[7] || 0) : 0); // col H (idx 7) = Ending Backlog
    });
    areaTable.push(aRow);
  });

  // Chart 2 data: line — New vs Resolved per week
  const lineTable = [['Date', 'Resolved', 'New']];
  dateKeys.forEach(function(key) {
    const d       = dateMap[key];
    const dateStr = d instanceof Date
      ? Utilities.formatDate(d, CONFIG.timezone, 'MM.dd.yy') : String(d);
    const weekRows  = rows.filter(function(r) {
      const k = r[0] instanceof Date ? r[0].getTime() : new Date(r[0]).getTime();
      return k === key;
    });
    const totalNew = weekRows.reduce(function(s, r) { return s + (r[4] || 0); }, 0);
    const totalRes = weekRows.reduce(function(s, r) { return s + (r[5] || 0); }, 0);
    lineTable.push([dateStr, totalRes, totalNew]);
  });

  // Anchor charts just below the aging table + a small gap
  const agingEnd   = 13 + 1 + CONFIG.ageBuckets.length;
  const chartStart = agingEnd + 3;

  // Write helper data to row 100 (safely below visible content, above pivot at 200)
  const HROW = 100, ACOL = 1, LCOL = p.length + 3;
  const areaRange = dash.getRange(HROW, ACOL, areaTable.length, areaTable[0].length);
  const lineRange = dash.getRange(HROW, LCOL, lineTable.length, lineTable[0].length);
  areaRange.setValues(areaTable);
  lineRange.setValues(lineTable);
  [areaRange, lineRange].forEach(function(r) {
    r.setFontColor('#dadce0').setFontSize(7).setBackground('#fafafa');
  });
  SpreadsheetApp.flush();

  const areaColors = p.map(function(pr) { return CONFIG.priorityColors[pr] || '#1a73e8'; });

  dash.insertChart(dash.newChart()
    .setChartType(Charts.ChartType.AREA)
    .addRange(areaRange)
    .setNumHeaders(1)
    .setOption('title',           'Open Backlog by Priority')
    .setOption('isStacked',       true)
    .setOption('colors',          areaColors)
    .setOption('legend',          { position: 'bottom' })
    .setOption('backgroundColor', { fill: '#ffffff' })
    .setOption('vAxis',           { title: 'Open Bugs', minValue: 0 })
    .setOption('hAxis',           { slantedText: true, slantedTextAngle: 45 })
    .setOption('chartArea',       { left: 60, top: 30, width: '72%', height: '60%' })
    .setOption('width',  520)
    .setOption('height', 300)
    .setPosition(chartStart, 1, 5, 5)
    .build());

  dash.insertChart(dash.newChart()
    .setChartType(Charts.ChartType.LINE)
    .addRange(lineRange)
    .setNumHeaders(1)
    .setOption('title',           'New vs Resolved per Week')
    .setOption('colors',          ['#ea4335', '#34a853'])
    .setOption('legend',          { position: 'bottom' })
    .setOption('backgroundColor', { fill: '#ffffff' })
    .setOption('vAxis',           { title: 'Tickets', minValue: 0 })
    .setOption('hAxis',           { slantedText: true, slantedTextAngle: 45 })
    .setOption('lineWidth',       2)
    .setOption('pointSize',       4)
    .setOption('chartArea',       { left: 60, top: 30, width: '72%', height: '60%' })
    .setOption('width',  400)
    .setOption('height', 300)
    .setPosition(chartStart, 6, 5, 5)
    .build());
}
