const MONTH_NUMBERS = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
  apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
  aug: 7, august: 7, sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

/**
 * Remarks are stored as an append-only, dated note string in some older
 * records. The report shows the latest dated note, matching the server
 * report's current-state extraction.
 */
export function latestDatedRemark(value) {
  if (!value?.trim()) return value;
  const marker = /(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})(?:\s+(\d{4}))?\s*[-–—:]\s*/gi;
  const matches = [...value.matchAll(marker)];
  if (!matches.length) return value;
  const entries = matches.flatMap((match, index) => {
    const month = MONTH_NUMBERS[match[2].toLowerCase()];
    if (month === undefined) return [];
    const day = Number(match[1]);
    const year = match[3] ? Number(match[3]) : new Date().getFullYear();
    const textStart = match.index + match[0].length;
    const textEnd = matches[index + 1]?.index ?? value.length;
    const text = value.slice(textStart, textEnd).trim();
    const date = new Date(year, month, day);
    if (!text || date.getDate() !== day || date.getMonth() !== month) return [];
    return [{ date, text }];
  });
  if (!entries.length) return value;
  return entries.reduce((latest, entry) => entry.date > latest.date ? entry : latest).text;
}

function sourceDateIsLater(candidate, current) {
  if (!candidate) return false;
  if (!current) return true;
  const candidateTime = new Date(candidate).getTime();
  const currentTime = new Date(current).getTime();
  if (!Number.isNaN(candidateTime) && !Number.isNaN(currentTime)) {
    return candidateTime > currentTime;
  }
  return String(candidate) > String(current);
}

/**
 * Return the notes that should be displayed for a grouped report row.
 *
 * Empty room records intentionally do not produce entries. Equal displayed
 * notes are merged (including their source links and latest date), while
 * different notes retain source labels so a grouped row never implies that
 * one classroom's note belongs to another.
 */
export function reportRemarkEntries(itemOrSources = {}) {
  const item = Array.isArray(itemOrSources) ? {} : (itemOrSources || {});
  const sources = Array.isArray(itemOrSources)
    ? itemOrSources
    : Array.isArray(item.remarkSources) && item.remarkSources.length
      ? item.remarkSources
      : [{
          id: item.id,
          label: item.label || item.areaLabel || item.classroomName || item.area,
          remark: item.remark ?? item.remarks,
          remarkDate: item.remarkDate,
          remarkIsHistorical: item.remarkIsHistorical,
          remarkDiffersFromCurrent: item.remarkDiffersFromCurrent,
        }];
  const entries = new Map();

  sources.forEach(source => {
    const raw = source?.remark ?? source?.remarks;
    if (!String(raw ?? '').trim()) return;
    const text = String(latestDatedRemark(String(raw)) ?? '').trim();
    if (!text) return;
    // Whitespace differences should not create duplicate visual notes.
    const key = text.replace(/\s+/g, ' ');
    const existing = entries.get(key);
    const normalizedSource = {
      ...source,
      remark: raw,
      label: source?.label || source?.areaLabel || source?.classroomName || 'Checklist source',
    };
    if (existing) {
      existing.sources.push(normalizedSource);
      if (!existing.labels.includes(normalizedSource.label)) existing.labels.push(normalizedSource.label);
      if (sourceDateIsLater(normalizedSource.remarkDate, existing.remarkDate)) {
        existing.remarkDate = normalizedSource.remarkDate;
      }
      existing.remarkIsHistorical = existing.remarkIsHistorical || Boolean(normalizedSource.remarkIsHistorical);
      existing.remarkDiffersFromCurrent =
        existing.remarkDiffersFromCurrent || Boolean(normalizedSource.remarkDiffersFromCurrent);
      return;
    }
    entries.set(key, {
      key,
      text,
      remarkDate: normalizedSource.remarkDate || null,
      labels: [normalizedSource.label],
      sources: [normalizedSource],
      remarkIsHistorical: Boolean(normalizedSource.remarkIsHistorical),
      remarkDiffersFromCurrent: Boolean(normalizedSource.remarkDiffersFromCurrent),
    });
  });

  return [...entries.values()];
}