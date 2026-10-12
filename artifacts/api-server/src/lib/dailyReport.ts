import { Prisma } from "@prisma/client";
import prisma from "./prisma";
import { inferEvidenceContentType } from "./evidenceMedia";

const COMPLETE = new Set(["Done", "N/A"]);
const AREA_NAMES: Record<string, string> = {
  model_classroom: "Model Classroom",
  lab: "5.0 Lab",
  staff_room: "Staff Room",
  overall_classroom: "All Classrooms",
};
const CURRENT_REPORT_TTL_MS = 15_000;
const MAX_CONCURRENT_REPORT_GENERATIONS = 2;

type EvidenceCandidate = {
  id?: string;
  photoUrl: string;
  contentType?: string | null;
  uploadedAt: Date;
};

type ReportRow = {
  id: string;
  spaceType: string;
  spaceName: string;
  category: string;
  lineItem: string;
  createdAt: Date;
  updatedAt: Date;
  currentStatus: string;
  remarks: string | null;
  universityTimeline: string | null;
  targetTimeline: string | null;
  itemStartDate: string | null;
  itemEndDate: string | null;
  isBlocker: boolean;
  photoUrl: string | null;
  photoContentType: string | null;
  snapshotStatus: string | null;
  snapshotRemarks: string | null;
  snapshotUniversityTimeline: string | null;
  snapshotTargetTimeline: string | null;
  snapshotItemStartDate: string | null;
  snapshotItemEndDate: string | null;
  snapshotIsBlocker: boolean | null;
  snapshotChangedAt: Date | null;
  snapshotChangedByName: string | null;
  remarkChangedAt: Date | null;
  evidenceId: string | null;
  evidenceUrl: string | null;
  evidenceContentType: string | null;
  evidenceUploadedAt: Date | null;
};

type DailyReport = NonNullable<Awaited<ReturnType<typeof generateDailyReport>>>;
type BuildDailyReportOptions = {
  now?: Date;
  onQuery?: () => void;
  bypassCache?: boolean;
};
type CacheEntry = { expiresAt: number; report: DailyReport };
const currentReportCache = new Map<string, CacheEntry>();
const inFlightReports = new Map<string, Promise<DailyReport | null>>();
const reportVersions = new Map<string, number>();
const reportGenerationWaiters: Array<() => void> = [];
let activeReportGenerations = 0;

export async function withReportGenerationAdmission<T>(generate: () => Promise<T>): Promise<T> {
  if (activeReportGenerations >= MAX_CONCURRENT_REPORT_GENERATIONS) {
    await new Promise<void>(resolve => reportGenerationWaiters.push(resolve));
  } else {
    activeReportGenerations += 1;
  }
  try {
    return await generate();
  } finally {
    const next = reportGenerationWaiters.shift();
    if (next) next();
    else activeReportGenerations -= 1;
  }
}

export function selectApplicableEvidence(
  history: EvidenceCandidate[],
  current: { photoUrl?: string | null; photoContentType?: string | null; updatedAt: Date },
  reportEnd: Date,
) {
  const historical = history
    .filter(entry => entry.uploadedAt <= reportEnd)
    .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime())[0];
  if (historical) return historical;
  if (current.photoUrl && current.updatedAt <= reportEnd) {
    return {
      photoUrl: current.photoUrl,
      contentType: current.photoContentType,
      uploadedAt: current.updatedAt,
    };
  }
  return null;
}

function dayBounds(date: string) {
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(`${date}T23:59:59.999Z`);
  if (Number.isNaN(start.getTime()) || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      start.toISOString().slice(0, 10) !== date) throw new Error("INVALID_DATE");
  return { start, end };
}

function parseTimeline(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value.length === 10 ? `${value}T23:59:59.999Z` : value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
  apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
  aug: 7, august: 7, sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

function extractLatestDatedRemark(value: string | null, referenceDate: Date) {
  if (!value?.trim()) return null;
  const entries = value.split(/\r?\n/).flatMap(line => {
    const trimmed = line.trim();
    let day: number;
    let month: number;
    let year: number;
    let text: string;
    const named = trimmed.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})(?:\s+(\d{4}))?\s*[-–—:]\s*(.+)$/i);
    if (named) {
      day = Number(named[1]); month = MONTHS[named[2].toLowerCase()];
      year = named[3] ? Number(named[3]) : referenceDate.getUTCFullYear(); text = named[4].trim();
    } else {
      const numeric = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\s*[-–—:]\s*(.+)$/);
      if (!numeric) return [];
      day = Number(numeric[1]); month = Number(numeric[2]) - 1; year = Number(numeric[3]);
      if (year < 100) year += 2000;
      text = numeric[4].trim();
    }
    if (month === undefined || day < 1 || day > 31 || month < 0 || month > 11 || !text) return [];
    const parsedDate = new Date(Date.UTC(year, month, day, 12));
    if (parsedDate.getUTCDate() !== day || parsedDate.getUTCMonth() !== month) return [];
    return [{ date: parsedDate, text }];
  });
  if (!entries.length) return null;
  return entries.reduce((latest, entry) => entry.date > latest.date ? entry : latest);
}

async function generateDailyReport(
  universityId: string,
  date: string,
  { now = new Date(), onQuery }: BuildDailyReportOptions = {},
) {
  const { start, end } = dayBounds(date);
  const useLiveState = end >= now;
  const university = await prisma.university.findUnique({
    where: { id: universityId },
    select: { id: true, name: true, location: true },
  });
  onQuery?.();
  if (!university) return null;

  // LATERAL LIMIT 1 lookups use the history indexes and keep response work
  // proportional to checklist rows rather than total history/evidence volume.
  const rows = await prisma.$queryRaw<ReportRow[]>(Prisma.sql`
    SELECT scs.id, s.space_type AS "spaceType", s.name AS "spaceName",
      ci.category, ci.name AS "lineItem",
      scs.created_at AS "createdAt", scs.updated_at AS "updatedAt",
      scs.current_status AS "currentStatus", scs.remarks,
      scs.university_timeline AS "universityTimeline", scs.target_timeline AS "targetTimeline",
      scs.item_start_date AS "itemStartDate", scs.item_end_date AS "itemEndDate",
      scs.is_blocker AS "isBlocker", scs.photo_url AS "photoUrl",
      scs.photo_content_type AS "photoContentType",
      snap.current_status AS "snapshotStatus", snap.remarks AS "snapshotRemarks",
      snap.university_timeline AS "snapshotUniversityTimeline",
      snap.target_timeline AS "snapshotTargetTimeline",
      snap.item_start_date AS "snapshotItemStartDate", snap.item_end_date AS "snapshotItemEndDate",
      snap.is_blocker AS "snapshotIsBlocker", snap.changed_at AS "snapshotChangedAt",
      snap.changed_by_name AS "snapshotChangedByName",
      remark.changed_at AS "remarkChangedAt",
      evidence.id AS "evidenceId", evidence.photo_url AS "evidenceUrl",
      evidence.content_type AS "evidenceContentType", evidence.uploaded_at AS "evidenceUploadedAt"
    FROM space_checklist_status scs
    JOIN spaces s ON s.id = scs.space_id
    JOIN checklist_items ci ON ci.id = scs.checklist_item_id
    LEFT JOIN LATERAL (
      SELECT h.current_status, h.remarks, h.university_timeline, h.target_timeline,
        h.item_start_date, h.item_end_date, h.is_blocker, h.changed_at, h.changed_by_name
      FROM checklist_status_history h
      WHERE h.status_id = scs.id AND h.changed_at <= ${end}
      ORDER BY h.changed_at DESC LIMIT 1
    ) snap ON true
    LEFT JOIN LATERAL (
      SELECT h.changed_at
      FROM checklist_status_history h
      WHERE h.status_id = scs.id AND h.changed_at <= ${end}
        AND md5(CASE WHEN h.remarks IS NULL THEN '0' ELSE '1' || h.remarks END) =
          md5(CASE WHEN
            (CASE WHEN ${useLiveState} THEN scs.remarks
              WHEN snap.changed_at IS NOT NULL THEN snap.remarks ELSE scs.remarks END) IS NULL
            THEN '0' ELSE '1' || (CASE WHEN ${useLiveState} THEN scs.remarks
              WHEN snap.changed_at IS NOT NULL THEN snap.remarks ELSE scs.remarks END) END)
        AND h.remarks IS NOT DISTINCT FROM
          (CASE WHEN ${useLiveState} THEN scs.remarks
            WHEN snap.changed_at IS NOT NULL THEN snap.remarks ELSE scs.remarks END)
      ORDER BY
        CASE WHEN ${useLiveState} THEN h.changed_at END DESC,
        CASE WHEN NOT ${useLiveState} THEN h.changed_at END ASC
      LIMIT 1
    ) remark ON true
    LEFT JOIN LATERAL (
      SELECT ph.id, ph.photo_url, ph.content_type, ph.uploaded_at
      FROM photo_history ph
      WHERE ph.status_id = scs.id AND ph.uploaded_at <= ${end}
      ORDER BY ph.uploaded_at DESC LIMIT 1
    ) evidence ON true
    WHERE scs.university_id = ${universityId}
      AND s.is_deleted = false
      AND s.space_type IN (${Prisma.join(Object.keys(AREA_NAMES))})
      AND (s.space_type <> 'overall_classroom' OR EXISTS (
        SELECT 1 FROM university_classrooms uc
        WHERE uc.university_id = ${universityId} AND uc.is_deleted = false
          AND LOWER(TRIM(uc.room_id)) = LOWER(TRIM(s.name))
      ))
      AND (scs.created_at <= ${end} OR snap.changed_at IS NOT NULL)
  `);
  onQuery?.();

  const items = rows.map(row => {
    const hasSnapshot = row.snapshotChangedAt !== null;
    const remarkIsHistorical = !useLiveState && hasSnapshot;
    // Compare the persisted values before extracting a dated remark for display.
    // A historical report without a snapshot keeps the legacy live-state fallback.
    const remarkDiffersFromCurrent = remarkIsHistorical && row.snapshotRemarks !== row.remarks;
    const state = useLiveState ? {
      currentStatus: row.currentStatus, remarks: row.remarks,
      universityTimeline: row.universityTimeline, targetTimeline: row.targetTimeline,
      itemStartDate: row.itemStartDate, itemEndDate: row.itemEndDate,
      isBlocker: row.isBlocker, changedAt: row.updatedAt,
      changedByName: row.snapshotChangedByName,
    } : row.snapshotChangedAt ? {
      currentStatus: row.snapshotStatus!, remarks: row.snapshotRemarks,
      universityTimeline: row.snapshotUniversityTimeline, targetTimeline: row.snapshotTargetTimeline,
      itemStartDate: row.snapshotItemStartDate, itemEndDate: row.snapshotItemEndDate,
      isBlocker: row.snapshotIsBlocker!, changedAt: row.snapshotChangedAt,
      changedByName: row.snapshotChangedByName,
    } : {
      currentStatus: row.currentStatus, remarks: row.remarks,
      universityTimeline: row.universityTimeline, targetTimeline: row.targetTimeline,
      itemStartDate: row.itemStartDate, itemEndDate: row.itemEndDate,
      isBlocker: row.isBlocker, changedAt: row.createdAt, changedByName: null,
    };
    let remarkDate = row.remarkChangedAt || state.changedAt;
    const datedRemark = extractLatestDatedRemark(state.remarks, end);
    const remark = datedRemark?.text || state.remarks;
    if (datedRemark) remarkDate = datedRemark.date;
    const timeline = state.universityTimeline || null;
    const timelineDate = parseTimeline(timeline);
    const isComplete = COMPLETE.has(state.currentStatus);
    const isOverdue = !!timelineDate && timelineDate < end && !isComplete;
    const isUpcoming = !!timelineDate && timelineDate > end &&
      timelineDate <= new Date(end.getTime() + 14 * 86400000) && !isComplete;
    const changedToday = state.changedAt >= start && state.changedAt <= end;
    const evidence = row.evidenceUrl ? {
      id: row.evidenceId!, photoUrl: row.evidenceUrl,
      contentType: row.evidenceContentType, uploadedAt: row.evidenceUploadedAt!,
    } : selectApplicableEvidence([], row, end);
    return {
      id: row.id, area: AREA_NAMES[row.spaceType] || row.spaceName,
      classroomName: row.spaceType === "overall_classroom" ? row.spaceName : null,
      category: row.category, lineItem: row.lineItem,
      status: state.isBlocker ? "Blocker" : state.currentStatus,
      timeline, remark, remarkDate, lastUpdatedBy: state.changedByName,
      remarkIsHistorical, remarkDiffersFromCurrent,
      changedToday, isBlocker: state.isBlocker || state.currentStatus === "Blocker",
      isOverdue, isUpcoming, isComplete,
      attachments: evidence ? [{
        id: evidence.id || `${row.id}-legacy`, url: evidence.photoUrl,
        contentType: inferEvidenceContentType(evidence.photoUrl, evidence.contentType),
        uploadedAt: evidence.uploadedAt, area: AREA_NAMES[row.spaceType] || row.spaceName,
        classroomName: row.spaceType === "overall_classroom" ? row.spaceName : null,
      }] : [],
    };
  });

  const areas = Object.values(AREA_NAMES).filter(area => items.some(item => item.area === area));
  const areaSummaries = areas.map(area => {
    const areaItems = items.filter(item => item.area === area);
    const complete = areaItems.filter(item => item.isComplete).length;
    return { area, total: areaItems.length, complete,
      readiness: areaItems.length ? Math.round(complete / areaItems.length * 100) : 0,
      blockers: areaItems.filter(item => item.isBlocker).length,
      overdue: areaItems.filter(item => item.isOverdue).length };
  });
  const complete = items.filter(item => item.isComplete).length;
  const publicItems = items.map(({ isComplete: _isComplete, ...item }) => item);
  return {
    university, reportDate: date, generatedAt: now,
    summary: {
      overallReadiness: items.length ? Math.round(complete / items.length * 100) : 0,
      completedToday: items.filter(item => item.changedToday && item.isComplete).length,
      pending: items.filter(item => !item.isComplete && item.status !== "In-Progress").length,
      inProgress: items.filter(item => item.status === "In-Progress").length,
      blockers: items.filter(item => item.isBlocker).length,
      overdue: items.filter(item => item.isOverdue).length,
      upcoming: items.filter(item => item.isUpcoming).length,
    },
    areaSummaries,
    attention: {
      blockers: publicItems.filter(item => item.isBlocker),
      overdue: publicItems.filter(item => item.isOverdue),
      upcoming: publicItems.filter(item => item.isUpcoming),
    },
    items: publicItems,
  };
}

export function invalidateDailyReport(universityId: string) {
  reportVersions.set(universityId, (reportVersions.get(universityId) || 0) + 1);
  for (const key of currentReportCache.keys()) {
    if (key.startsWith(`${universityId}:`)) currentReportCache.delete(key);
  }
}

export async function buildDailyReport(
  universityId: string,
  date: string,
  options: BuildDailyReportOptions = {},
) {
  const { end } = dayBounds(date);
  const isCurrent = end >= (options.now || new Date());
  if (options.bypassCache) {
    return withReportGenerationAdmission(() => generateDailyReport(universityId, date, options));
  }
  const version = reportVersions.get(universityId) || 0;
  const key = `${universityId}:${date}:${isCurrent ? version : "historical"}`;
  const cached = isCurrent ? currentReportCache.get(key) : undefined;
  if (cached && cached.expiresAt > Date.now()) return cached.report;
  const pending = inFlightReports.get(key);
  if (pending) return pending;
  const promise = withReportGenerationAdmission(
    () => generateDailyReport(universityId, date, options),
  ).then(report => {
    if (isCurrent && report && (reportVersions.get(universityId) || 0) === version) {
      currentReportCache.set(key, { report, expiresAt: Date.now() + CURRENT_REPORT_TTL_MS });
    }
    return report;
  }).finally(() => inFlightReports.delete(key));
  inFlightReports.set(key, promise);
  return promise;
}