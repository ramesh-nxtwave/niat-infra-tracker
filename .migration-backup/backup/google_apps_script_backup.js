/**
 * B2B Infrastructure Tracker — Supabase → Google Sheets Backup
 * ─────────────────────────────────────────────────────────────
 * Paste this entire file into Google Apps Script (Extensions > Apps Script)
 * then follow the setup instructions at the bottom.
 *
 * What it backs up (4 sheets):
 *   1. Universities      — core university records
 *   2. Status Updates    — every checklist item row (denormalized, photo URL included)
 *   3. Spaces            — university → space mapping
 *   4. Backup Log        — timestamp of every successful/failed run
 */

// ─── CONFIG ────────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://dxwrhbxnunubmtfgnghv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4d3JoYnhudW51Ym10ZmduZ2h2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3MDkzNzYsImV4cCI6MjA5MzI4NTM3Nn0.jF57Dz_oC7dtlCfN41hE44hw6xE_D8JJ4UC-hxl9fGc';

// ─── MAIN ENTRY POINT ──────────────────────────────────────────────────────
function runBackup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const startTime = new Date();
  let status = 'SUCCESS';
  let errorMsg = '';

  try {
    Logger.log('🚀 Starting B2B Infra backup at ' + startTime.toISOString());

    backupUniversities(ss);
    backupSpaces(ss);
    backupStatusUpdates(ss);

    Logger.log('✅ Backup complete.');
  } catch (e) {
    status = 'FAILED';
    errorMsg = e.message;
    Logger.log('❌ Backup failed: ' + e.message);
  } finally {
    writeBackupLog(ss, startTime, status, errorMsg);
  }
}

// ─── SUPABASE FETCH HELPER ─────────────────────────────────────────────────
function supabaseFetch(path) {
  const url = SUPABASE_URL + '/rest/v1/' + path;
  const options = {
    method: 'GET',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
    },
    muteHttpExceptions: true,
  };
  const response = UrlFetchApp.fetch(url, options);
  const code = response.getResponseCode();
  if (code !== 200) {
    throw new Error('Supabase returned HTTP ' + code + ' for ' + path + ': ' + response.getContentText().substring(0, 200));
  }
  return JSON.parse(response.getContentText());
}

// ─── SHEET HELPER ──────────────────────────────────────────────────────────
function getOrCreateSheet(ss, name) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  sheet.clearContents();
  return sheet;
}

function styleHeaderRow(sheet, numCols) {
  const headerRange = sheet.getRange(1, 1, 1, numCols);
  headerRange.setBackground('#1e3a5f');
  headerRange.setFontColor('#ffffff');
  headerRange.setFontWeight('bold');
  headerRange.setFontSize(10);
  sheet.setFrozenRows(1);
}

function writeRows(sheet, headers, rows) {
  if (rows.length === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    styleHeaderRow(sheet, headers.length);
    return;
  }
  const allData = [headers, ...rows];
  sheet.getRange(1, 1, allData.length, headers.length).setValues(allData);
  styleHeaderRow(sheet, headers.length);
  // Auto-resize columns for readability
  for (let i = 1; i <= headers.length; i++) {
    sheet.autoResizeColumn(i);
  }
}

// ─── 1. UNIVERSITIES ───────────────────────────────────────────────────────
function backupUniversities(ss) {
  const data = supabaseFetch('universities?select=*&order=name.asc');
  const sheet = getOrCreateSheet(ss, '1_Universities');

  const headers = [
    'ID', 'UUID', 'Code', 'Name', 'Location',
    'POC Name', 'POC Phone', 'Target Date',
    'Risk Status', 'Days Delayed', 'Created At', 'Updated At'
  ];

  const rows = data.map(u => [
    u.id ?? '',
    u.uuid_id ?? '',
    u.code ?? '',
    u.name ?? '',
    u.location ?? '',
    u.poc_name ?? '',
    u.poc_phone ?? '',
    u.target_date ?? '',
    u.risk_status ?? 'GREEN',
    u.days_delayed ?? 0,
    u.created_at ?? '',
    u.updated_at ?? '',
  ]);

  writeRows(sheet, headers, rows);
  Logger.log('  ✔ Universities: ' + rows.length + ' rows');
}

// ─── 2. SPACES ─────────────────────────────────────────────────────────────
function backupSpaces(ss) {
  const data = supabaseFetch('spaces?select=*,universities(id,name,code)&order=university_uuid.asc');
  const sheet = getOrCreateSheet(ss, '2_Spaces');

  const headers = [
    'Space ID', 'Space Name', 'Space Type',
    'University ID', 'University Name', 'University Code',
    'Created At'
  ];

  const rows = data.map(s => [
    s.id ?? '',
    s.name ?? '',
    s.space_type ?? '',
    s.universities?.id ?? '',
    s.universities?.name ?? '',
    s.universities?.code ?? '',
    s.created_at ?? '',
  ]);

  writeRows(sheet, headers, rows);
  Logger.log('  ✔ Spaces: ' + rows.length + ' rows');
}

// ─── 3. STATUS UPDATES (main checklist data) ───────────────────────────────
function backupStatusUpdates(ss) {
  // Fetch denormalized: status_update → checklist_item → space → university
  const data = supabaseFetch(
    'status_updates' +
    '?select=id,status,remarks,photo_url,vendor_suggestion,actual_date,updated_at,' +
    'checklist_items(name,category,specification,module),' +
    'spaces(name,space_type,universities(id,name,code))' +
    '&order=updated_at.desc'
  );

  const sheet = getOrCreateSheet(ss, '3_StatusUpdates');

  const headers = [
    'Update ID',
    'University ID', 'University Name', 'University Code',
    'Space Name', 'Space Type',
    'Category', 'Checklist Item', 'Specification', 'Module',
    'Status', 'Blocker Reason / Remarks',
    'Photo URL', 'Vendor Suggestion', 'Actual Date',
    'Last Updated At'
  ];

  const rows = data.map(u => {
    const uni = u.spaces?.universities ?? {};
    return [
      u.id ?? '',
      uni.id ?? '',
      uni.name ?? '',
      uni.code ?? '',
      u.spaces?.name ?? '',
      u.spaces?.space_type ?? '',
      u.checklist_items?.category ?? '',
      u.checklist_items?.name ?? '',
      u.checklist_items?.specification ?? '',
      u.checklist_items?.module ?? '',
      u.status ?? '',
      u.remarks ?? '',
      u.photo_url ?? '',
      u.vendor_suggestion ?? '',
      u.actual_date ?? '',
      u.updated_at ?? '',
    ];
  });

  writeRows(sheet, headers, rows);

  // Make the Photo URL column clickable (column 13)
  const photoColIndex = 13;
  if (rows.length > 0) {
    for (let i = 0; i < rows.length; i++) {
      const url = rows[i][photoColIndex - 1];
      if (url && url.startsWith('http')) {
        const cell = sheet.getRange(i + 2, photoColIndex);
        cell.setFormula('=HYPERLINK("' + url + '","📷 View Photo")');
      }
    }
  }

  // Color-code the Status column (column 11)
  const statusColIndex = 11;
  if (rows.length > 0) {
    for (let i = 0; i < rows.length; i++) {
      const statusCell = sheet.getRange(i + 2, statusColIndex);
      switch (rows[i][statusColIndex - 1]) {
        case 'Done':         statusCell.setBackground('#c6efce').setFontColor('#276221'); break;
        case 'In-Progress':  statusCell.setBackground('#ffeb9c').setFontColor('#9c5700'); break;
        case 'Blocked':      statusCell.setBackground('#ffc7ce').setFontColor('#9c0006'); break;
        case 'Yet to start': statusCell.setBackground('#e8e8e8').setFontColor('#444444'); break;
      }
    }
  }

  Logger.log('  ✔ Status Updates: ' + rows.length + ' rows');
}

// ─── 4. BACKUP LOG ─────────────────────────────────────────────────────────
function writeBackupLog(ss, startTime, status, errorMsg) {
  let logSheet = ss.getSheetByName('📋 Backup Log');
  if (!logSheet) {
    logSheet = ss.insertSheet('📋 Backup Log');
    const headers = ['Timestamp (IST)', 'Status', 'Duration (s)', 'Error'];
    logSheet.getRange(1, 1, 1, 4).setValues([headers]);
    styleHeaderRow(logSheet, 4);
    logSheet.setFrozenRows(1);
  }

  const endTime = new Date();
  const duration = ((endTime - startTime) / 1000).toFixed(1);

  // Convert to IST (UTC+5:30)
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(startTime.getTime() + istOffset);
  const istString = Utilities.formatDate(istTime, 'UTC', 'dd-MMM-yyyy HH:mm:ss') + ' IST';

  logSheet.appendRow([istString, status, duration, errorMsg]);

  // Color-code log status
  const lastRow = logSheet.getLastRow();
  const statusCell = logSheet.getRange(lastRow, 2);
  if (status === 'SUCCESS') {
    statusCell.setBackground('#c6efce').setFontColor('#276221').setFontWeight('bold');
  } else {
    statusCell.setBackground('#ffc7ce').setFontColor('#9c0006').setFontWeight('bold');
  }
}

// ─── SETUP: CREATE 12-HOUR TRIGGER ────────────────────────────────────────
/**
 * Run this function ONCE manually to install the 12-hour auto-trigger.
 * After that, runBackup() fires automatically every 12 hours.
 */
function installTrigger() {
  // Remove any existing triggers first to avoid duplicates
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getHandlerFunction() === 'runBackup') ScriptApp.deleteTrigger(t);
  });

  // Create a new every-12-hours trigger
  ScriptApp.newTrigger('runBackup')
    .timeBased()
    .everyHours(12)
    .create();

  Logger.log('✅ 12-hour trigger installed successfully!');
  SpreadsheetApp.getUi().alert('✅ Auto-backup trigger installed!\n\nrunBackup() will fire automatically every 12 hours.\nNext run: ~' + new Date(Date.now() + 12 * 3600 * 1000).toLocaleString());
}

/**
 * Remove the trigger (call this if you want to stop backups)
 */
function removeTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getHandlerFunction() === 'runBackup') ScriptApp.deleteTrigger(t);
  });
  Logger.log('🛑 Backup trigger removed.');
}
