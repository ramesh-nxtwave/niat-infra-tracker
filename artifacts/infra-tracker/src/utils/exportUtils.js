/**
 * Client-side export utilities — generates CSV and plain-text reports from
 * checklist data without any external library dependency.
 */

const STATUS_EMOJI = {
  'Done': '✅',
  'In-Progress': '🔄',
  'Blocker': '🚫',
  'Yet to start': '⬜',
  'No info as of now': '❓',
};

function csvCell(value) {
  if (value == null || value === '') return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function csvRow(cells) {
  return cells.map(csvCell).join(',');
}

/**
 * Export a university's full checklist to a CSV file.
 * @param {object} university - Normalized university object from DataContext
 */
export function exportChecklistCSV(university) {
  const rows = [
    csvRow(['NIAT InfraTracker — Checklist Export']),
    csvRow([`University: ${university.name}`, `Location: ${university.location || 'N/A'}`, `Zone: ${university.zone_id ?? 'N/A'}`]),
    csvRow([`APM: ${university.apmName || 'N/A'}`, `Target Date: ${university.targetDate || 'N/A'}`, `Overall Readiness: ${university.overallReadiness || 0}%`]),
    csvRow([`Exported on: ${new Date().toLocaleString('en-IN')}`]),
    csvRow([]),
    csvRow(['Module', 'Category', 'Checklist Item', 'Status', 'Blocker', 'Start Date', 'University Timeline', 'Actual Completion', 'Capacity', 'Remarks']),
  ];

  const modules = [
    { label: 'Model Classroom', items: university.trackers?.modelClassroom?.items || [] },
    { label: '5.0 Lab', items: university.trackers?.lab5?.items || [] },
    { label: 'Staff Room', items: university.trackers?.staffRoom?.items || [] },
  ];

  for (const mod of modules) {
    for (const item of mod.items) {
      rows.push(csvRow([
        mod.label,
        item.category || '',
        item.name || '',
        item.status || 'Yet to start',
        item.isBlocker ? 'YES' : '',
        item.itemStartDate || '',
        item.universityTimeline || '',
        item.actualDate || '',
        item.capacity || '',
        item.remarks || '',
      ]));
    }
    if (mod.items.length > 0) rows.push(csvRow([]));
  }

  // Summary section
  const allItems = modules.flatMap(m => m.items);
  const done = allItems.filter(i => i.status === 'Done').length;
  const inProgress = allItems.filter(i => i.status === 'In-Progress').length;
  const blockers = allItems.filter(i => i.isBlocker || i.status === 'Blocker').length;
  const yetToStart = allItems.filter(i => i.status === 'Yet to start').length;

  rows.push(csvRow(['SUMMARY']));
  rows.push(csvRow(['Total Items', allItems.length]));
  rows.push(csvRow(['Done', done]));
  rows.push(csvRow(['In Progress', inProgress]));
  rows.push(csvRow(['Blockers', blockers]));
  rows.push(csvRow(['Yet to Start', yetToStart]));
  rows.push(csvRow(['Overall Readiness', `${university.overallReadiness || 0}%`]));

  const csv = rows.join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const safeName = (university.name || 'university').replace(/[^a-z0-9]/gi, '_').toLowerCase();
  link.download = `niat_checklist_${safeName}_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Export all universities' summary data to CSV (for the dashboard list view).
 * @param {object[]} universities - Array of normalized university objects
 */
export function exportUniversitiesSummaryCSV(universities) {
  const rows = [
    csvRow(['NIAT InfraTracker — Universities Summary Export']),
    csvRow([`Exported on: ${new Date().toLocaleString('en-IN')}`, `Total: ${universities.length}`]),
    csvRow([]),
    csvRow(['Code', 'University', 'Location', 'Zone', 'APM', 'Risk', 'Readiness %', 'Infra Ready Month', 'Target Date', 'Allocation Done', 'Students', 'Efforts', 'Confidence %']),
  ];

  for (const uni of universities) {
    let infraLabel = '';
    if (uni.infraReadyMonth) {
      const [yr, mo] = uni.infraReadyMonth.split('-');
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      infraLabel = `${months[parseInt(mo,10)-1]} ${yr}`;
    }
    rows.push(csvRow([
      uni.code || '',
      uni.name || '',
      uni.location || '',
      uni.zone_id ?? '',
      uni.apmName || '',
      uni.riskStatus || 'GREEN',
      `${uni.overallReadiness || 0}%`,
      infraLabel,
      uni.targetDate || '',
      uni.classroomAllocationDone ? 'YES' : 'NO',
      uni.studentsCount ?? '',
      uni.effortsRequired || '',
      uni.confidencePercentage != null ? `${uni.confidencePercentage}%` : '',
    ]));
  }

  const csv = rows.join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `niat_universities_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
