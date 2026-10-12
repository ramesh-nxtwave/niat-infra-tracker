import crypto from "node:crypto";
import prisma from "./prisma";
import { logger } from "./logger";
import { cleanupPendingReportSnapshots } from "./pendingReportRetention";
import {
  buildGmailRfc822Message,
  GmailPendingReportError,
  GmailPendingReportProvider,
  PENDING_REPORT_GMAIL_SENDER,
} from "./gmailPendingReportProvider";
import { PendingReportError } from "./pendingReportTypes";

export { PendingReportError } from "./pendingReportTypes";
export {
  buildGmailRfc822Message,
  GmailPendingReportError,
  GmailPendingReportProvider,
  PENDING_REPORT_GMAIL_SENDER,
} from "./gmailPendingReportProvider";

export const PENDING_REPORT_RECIPIENTS = [
  "karthik@nxtwave.tech",
  "Varshith@nxtwave.tech",
  "satish.jada@nxtwave.co.in",
  "srinivas.vatturi@nxtwave.tech",
  "ramesh@nxtwave.co.in",
] as const;

export type PendingReportProviderKind = "demonstration" | "resend" | "gmail";
export type PendingReportPreviewProvider = PendingReportProviderKind | "unknown";

const COMPLETE_STATUSES = new Set(["done", "n/a"]);
const SNAPSHOT_TTL_MS = 10 * 60 * 1_000;
const PROVIDER_TIMEOUT_MS = 10_000;
const DEFAULT_PUBLIC_APP_URL = "https://niatinfratracker.replit.app";
/**
 * Version 4 is the reviewed grouped email contract that shipped before the
 * dashboard-aligned table. Keep it renderable forever for existing previews;
 * version 5 is the first contract that uses the dashboard's compact CR rows;
 * version 6 adds display-only grouped remark deduplication to that table.
 */
export const PENDING_REPORT_SNAPSHOT_VERSION = 7;
const AREA_NAMES: Record<string, string> = {
  model_classroom: "Model Classroom",
  lab: "5.0 Lab",
  staff_room: "Staff Room",
  overall_classroom: "All Classrooms",
};
const ROOM_GROUP_NAMES = {
  classrooms: "Classrooms",
  lab: "Lab Room",
  staff: "Staff Room",
} as const;
const ROOM_GROUPS = Object.keys(ROOM_GROUP_NAMES) as Array<keyof typeof ROOM_GROUP_NAMES>;
export type PendingRoomGroup = keyof typeof ROOM_GROUP_NAMES;
export type PendingReportSection = PendingRoomGroup | "dailyRemarks";
export type PendingSectionSelection = PendingReportSection[];
type PendingSectionDataStates = Partial<Record<PendingRoomGroup, "available" | "missing">>;

type RawStatus = {
  id: string;
  currentStatus: string;
  remarks: string | null;
  targetTimeline: string | null;
  universityTimeline: string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
  remarkDate?: Date | string | null;
  isBlocker: boolean;
  photoUrl?: string | null;
  photoContentType?: string | null;
  photoHistory?: Array<{
    id: string;
    photoUrl: string;
    contentType: string | null;
    uploadedAt: Date | string;
  }>;
  history?: Array<{
    remarks: string | null;
    changedAt: Date | string;
  }>;
  checklistItem: { category: string; name: string };
};

type RawUniversity = {
  id: string;
  name: string;
  targetDate: string | null;
  priority?: string | null;
  isCritical?: boolean;
  updates?: Array<{
    id: string;
    content: string;
    authorName: string;
    createdAt: Date | string;
  }>;
  classrooms?: Array<{ roomId: string }>;
  spaces: Array<{
    name: string;
    spaceType: string;
    checklistStatuses: RawStatus[];
  }>;
};

export type PendingItem = {
  id: string;
  space: string;
  classroom: string | null;
  category: string;
  item: string;
  status: string;
  isBlocker: boolean;
  isOverdue: boolean;
  targetDate: string | null;
  targetDateSource: "target timeline" | "university timeline" | "university target date" | null;
  remarks: string | null;
  /**
   * Optional for legacy snapshots. New snapshots always include this stable
   * key so the application preview and email can group the same records.
   */
  roomGroup?: PendingRoomGroup;
  /**
   * Dashboard-compatible fields. They are optional so that v1-v4 snapshot
   * datasets can still be rendered byte-for-byte by their old contracts.
   */
  areaLabel?: string;
  classroomName?: string | null;
  classroomNames?: string[];
  timeline?: string | null;
  remark?: string | null;
  remarkDate?: string | null;
  sources?: Array<{ id: string; label: string }>;
  /**
   * Display-only provenance for grouped remarks. Empty sources are retained
   * here for checklist identity but are omitted from rendered note entries.
   */
  remarkSources?: Array<{
    id: string;
    label: string;
    remark: string | null;
    remarkDate?: string | null;
  }>;
  attachments?: Array<{
    id: string;
    sourceStatusId: string;
    contentType: string | null;
    uploadedAt: string | null;
    classroomName: string | null;
    fingerprint?: string;
  }>;
};

export type PendingUniversity = {
  id: string;
  name: string;
  checklistDataState: "available" | "missing";
  /**
   * Optional for v1-v3 snapshots. New datasets report data availability for
   * each selected email section, rather than making an empty section look
   * complete.
   */
  sectionDataStates?: PendingSectionDataStates;
  counts: { pending: number; blockers: number; overdue: number };
  pendingItems: PendingItem[];
  dailyRemarks?: Array<{ id: string; content: string; authorName: string; createdAt: string }>;
};

export type PendingPriority = "ALL" | "CRITICAL" | "MEDIUM" | "LOW" | "NA";
const PRIORITY_PRESENTATION: Record<PendingPriority, { label: string; color: string; background: string }> = {
  ALL: { label: "All Priorities", color: "#334155", background: "#e2e8f0" },
  CRITICAL: { label: "Critical", color: "#991b1b", background: "#fee2e2" },
  MEDIUM: { label: "Medium Priority", color: "#92400e", background: "#fef3c7" },
  LOW: { label: "Low Priority", color: "#166534", background: "#dcfce7" },
  NA: { label: "NA", color: "#475569", background: "#f1f5f9" },
};

export type PendingReportPreview = {
  previewId: string;
  expiresAt: string;
  generatedAt: string;
  scope: PendingScope;
  recipients: readonly string[];
  delivery: {
    mode: "demonstration" | "live";
    provider: PendingReportPreviewProvider;
    senderEmail: string | null;
    message: string;
  };
  /**
   * The room sections frozen into this reviewed preview. Older persisted
   * snapshots do not have this field and are treated as all sections.
   */
  sections: readonly PendingReportSection[];
  priority?: { key: PendingPriority; label: string; color: string; background: string };
  summary: { pendingItems: number; blockers: number; overdue: number; universitiesWithoutChecklistData: number };
  universities: PendingUniversity[];
  attachment: { filename: string; contentType: "text/csv"; rowCount: number };
};

export type PendingReportMessage = {
  recipients: readonly string[];
  subject: string;
  html: string;
  text: string;
  csv: string;
  filename: string;
  idempotencyKey: string;
};

export type PendingReportProvider = {
  send(message: PendingReportMessage): Promise<{ id: string }>;
  providerKind?: PendingReportProviderKind;
};

export type PendingReportDelivery = {
  mode: "demonstration" | "live";
  message: string;
  provider: PendingReportProvider;
  providerKind?: PendingReportProviderKind;
  senderEmail?: string | null;
  senderName?: string | null;
};

export type PendingReportDataSource = {
  activeUniversities(universityIds?: string[]): Promise<RawUniversity[]>;
};

export type PendingReportAuditWriter = {
  recordAccepted(input: {
    userId: string;
    userEmail: string;
    previewId: string;
    providerId: string;
    recipients: readonly string[];
    generatedAt: string;
    deliveryMode: "demonstration" | "live";
  scope: PendingReportPreview["scope"];
  }): Promise<void>;
};

export type PendingPreviewRequest = {
  recipients?: string[];
  universityIds?: string[];
  sections?: PendingReportSection[];
  priority?: PendingPriority;
};

const SECTION_ALIASES: Record<string, PendingRoomGroup> = {
  cr: "classrooms",
  classroom: "classrooms",
  classrooms: "classrooms",
  "cr (classrooms)": "classrooms",
  "all classrooms": "classrooms",
  lab: "lab",
  labs: "lab",
  "lab room": "lab",
  "5.0 lab": "lab",
  staff: "staff",
  "staff room": "staff",
};

function normalizePriority(value: unknown): PendingPriority {
  if (value === undefined || value === null || value === "") return "ALL";
  if (typeof value !== "string" || /[\r\n]/.test(value)) {
    throw new PendingReportError(400, "priority is invalid.");
  }
  const normalized = value.trim().toUpperCase().replace(/[\s-]+/g, "_");
  const aliases: Record<string, PendingPriority> = {
    ALL: "ALL", ALL_PRIORITIES: "ALL", CRITICAL: "CRITICAL",
    MEDIUM: "MEDIUM", MEDIUM_PRIORITY: "MEDIUM",
    LOW: "LOW", LOW_PRIORITY: "LOW", NA: "NA", N_A: "NA",
  };
  const priority = aliases[normalized];
  if (!priority) throw new PendingReportError(400, "priority must be Critical, Medium Priority, Low Priority, or NA.");
  return priority;
}

function normalizeSectionKey(value: string): PendingRoomGroup | null {
  const normalized = value.trim().toLocaleLowerCase().replace(/_/g, " ").replace(/[\s-]+/g, " ");
  return SECTION_ALIASES[normalized] || null;
}

function normalizeSectionSelection(value: unknown): PendingReportSection[] {
  if (!Array.isArray(value) || !value.length || value.length > ROOM_GROUPS.length + 1 ||
      !value.every(entry => typeof entry === "string")) {
    throw new PendingReportError(400, "sections must be a nonempty array containing one or more report sections.");
  }
  const selected = new Set<PendingReportSection>();
  for (const entry of value) {
    if (/[\r\n]/.test(entry)) {
      throw new PendingReportError(400, "Each sections value is invalid.");
    }
    const normalizedEntry = entry.trim().toLocaleLowerCase().replace(/[\s_-]+/g, " ");
    const section = normalizedEntry === "daily remarks" || normalizedEntry === "dailyremarks"
      ? "dailyRemarks" : normalizeSectionKey(entry);
    if (!section) {
      throw new PendingReportError(400, "Each sections value must be CR (Classrooms), Lab Room, Staff Room, or Daily Remarks.");
    }
    selected.add(section);
  }
  if (!selected.size) {
    throw new PendingReportError(400, "Select at least one report section.");
  }
  // Keep the reviewed dataset and all renderers deterministic regardless of
  // the checkbox/request order.
  return [...ROOM_GROUPS, "dailyRemarks" as const].filter(group => selected.has(group));
}

export function normalizePendingPreviewRequest(input: unknown): Required<PendingPreviewRequest> {
  if (input === undefined || input === null) {
    return { recipients: [...PENDING_REPORT_RECIPIENTS], universityIds: [], sections: [...ROOM_GROUPS], priority: "ALL" };
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new PendingReportError(400, "Preview body must be an object when provided.");
  }
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some(key => key !== "recipients" && key !== "universityIds" && key !== "sections" && key !== "priority")) {
    throw new PendingReportError(400, "Preview accepts only recipients, universityIds, sections, and priority.");
  }
  const normalizeList = (value: unknown, field: string, max: number, validator: (entry: string) => boolean) => {
    if (!Array.isArray(value) || !value.length || value.length > max || !value.every(entry => typeof entry === "string")) {
      throw new PendingReportError(400, `${field} must be a nonempty array with at most ${max} string values.`);
    }
    const unique = new Map<string, string>();
    for (const entry of value) {
      if (/[\r\n]/.test(entry)) throw new PendingReportError(400, `Each ${field} value is invalid.`);
      const trimmed = entry.trim();
      if (!validator(trimmed)) throw new PendingReportError(400, `Each ${field} value is invalid.`);
      const key = trimmed.toLowerCase();
      if (!unique.has(key)) unique.set(key, trimmed);
    }
    return [...unique.values()];
  };
  const recipients = Object.hasOwn(body, "recipients")
    ? normalizeList(body.recipients, "recipients", 50,
      email => email.length <= 254 && !/[\r\n\s]/.test(email) && /^[^@]+@[^@]+\.[^@]+$/.test(email))
    : [...PENDING_REPORT_RECIPIENTS];
  const universityIds = Object.hasOwn(body, "universityIds")
    ? normalizeList(body.universityIds, "universityIds", 500,
      id => id.length <= 191 && !/[\r\n]/.test(id))
    : [];
  const sections = Object.hasOwn(body, "sections")
    ? normalizeSectionSelection(body.sections)
    : [...ROOM_GROUPS];
  const priority = normalizePriority(body.priority);
  return { recipients, universityIds, sections, priority };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[character] || character));
}

function csvCell(value: string | null | undefined): string {
  // Quoting a CSV field does not prevent spreadsheet software from evaluating
  // it. Defuse formula-looking values even when tabs/newlines precede them.
  let safe = value ?? "";
  if (/^[\t\r\n ]*[=+\-@]/.test(safe)) safe = `'${safe}`;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, "\"\"")}"` : safe;
}

function display(value: string | null): string {
  return value?.trim() || "Not provided";
}

function dateOnly(value: string | null): string | null {
  if (!value?.trim()) return null;
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function isOverdue(targetDate: string | null, now: Date): boolean {
  if (!targetDate) return false;
  return targetDate < now.toISOString().slice(0, 10);
}

function normalizedStatusLookup(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/_/g, " ").replace(/[\s-]+/g, " ");
}

function normalizedStatusDisplay(value: string): string {
  return value.trim().replace(/\s+/g, " ") || "Unknown";
}

function pendingStatus(currentStatus: string, isBlocker: boolean): string {
  const normalized = normalizedStatusLookup(currentStatus);
  if (isBlocker || normalized === "blocker") return "Blocker";
  if (normalized === "in progress") return "In-Progress";
  if (normalized === "partially done" || normalized === "partial done") return "Partially Done";
  if (normalized === "yet to start") return "Yet to start";
  return normalizedStatusDisplay(currentStatus);
}

function roomGroupForSpaceType(spaceType: string): PendingRoomGroup | null {
  if (spaceType === "model_classroom" || spaceType === "overall_classroom") return "classrooms";
  if (spaceType === "lab") return "lab";
  if (spaceType === "staff_room") return "staff";
  return null;
}

function roomGroupForItem(item: PendingItem): PendingRoomGroup {
  if (item.roomGroup && ROOM_GROUPS.includes(item.roomGroup)) return item.roomGroup;
  if (/lab/i.test(item.space)) return "lab";
  if (/staff/i.test(item.space)) return "staff";
  return "classrooms";
}

function itemPriority(item: PendingItem): number {
  if (item.isBlocker) return 0;
  if (item.isOverdue) return 1;
  if (item.status === "In-Progress") return 2;
  if (item.status === "Partially Done") return 3;
  return 4;
}

type PendingScope =
  | { kind: "all-active-universities"; universityCount: number }
  | { kind: "selected-universities"; universityCount: number; universityIds: string[] };
type PendingDatasetOptions = {
  recipients?: readonly string[];
  universityIds?: string[];
  sections?: readonly PendingReportSection[];
  priority?: PendingPriority;
};

function selectedDatasetSections(sections?: readonly PendingReportSection[]): PendingRoomGroup[] {
  if (!sections?.length) return [...ROOM_GROUPS];
  return ROOM_GROUPS.filter(group => sections.includes(group));
}

function datasetSections(dataset: { sections?: readonly PendingReportSection[] }): PendingRoomGroup[] {
  return selectedDatasetSections(dataset.sections);
}

function datasetReportSections(dataset: { sections?: readonly PendingReportSection[] }): PendingReportSection[] {
  if (!dataset.sections?.length) return [...ROOM_GROUPS];
  return [...ROOM_GROUPS, "dailyRemarks" as const].filter(section => dataset.sections!.includes(section));
}

function scopeDescription(scope: PendingScope): string {
  return scope.kind === "selected-universities"
    ? `${scope.universityCount} selected active universities`
    : `all ${scope.universityCount} active universities`;
}

type DashboardPendingItem = PendingItem & {
  area: string;
  lineItem: string;
  classroomName: string | null;
};

function itemSourceLabel(item: DashboardPendingItem): string {
  return item.classroomName ? `${item.space} — ${item.classroomName}` : item.space;
}

function itemSources(item: DashboardPendingItem): Array<{ id: string; label: string }> {
  return item.sources?.length ? item.sources : [{ id: item.id, label: itemSourceLabel(item) }];
}

function itemRemarkSources(item: DashboardPendingItem): NonNullable<PendingItem["remarkSources"]> {
  return item.remarkSources?.length
    ? item.remarkSources
    : [{
        id: item.id,
        label: itemSourceLabel(item),
        remark: item.remark ?? item.remarks ?? null,
        remarkDate: item.remarkDate || null,
      }];
}

type DashboardRemarkEntry = {
  text: string;
  remarkDate: string | null;
  labels: string[];
  sources: NonNullable<PendingItem["remarkSources"]>;
};

function sourceDateIsLater(candidate: string | null | undefined, current: string | null): boolean {
  if (!candidate) return false;
  if (!current) return true;
  const candidateTime = new Date(candidate).getTime();
  const currentTime = new Date(current).getTime();
  if (!Number.isNaN(candidateTime) && !Number.isNaN(currentTime)) {
    return candidateTime > currentTime;
  }
  return candidate > current;
}

/**
 * Render grouped notes from available source values only. This intentionally
 * does not copy a note to any source checklist row.
 */
function dashboardRemarkEntries(item: DashboardPendingItem): DashboardRemarkEntry[] {
  const entries = new Map<string, DashboardRemarkEntry>();
  for (const source of itemRemarkSources(item)) {
    const text = source.remark?.trim();
    if (!text) continue;
    const key = text.replace(/\s+/g, " ");
    const existing = entries.get(key);
    if (existing) {
      existing.sources.push(source);
      if (!existing.labels.includes(source.label)) existing.labels.push(source.label);
      if (sourceDateIsLater(source.remarkDate, existing.remarkDate)) {
        existing.remarkDate = source.remarkDate || null;
      }
      continue;
    }
    entries.set(key, {
      text,
      remarkDate: source.remarkDate || null,
      labels: [source.label],
      sources: [source],
    });
  }
  return [...entries.values()];
}

function distinctPendingAttachments(items: DashboardPendingItem[]) {
  const seen = new Set<string>();
  return items.flatMap(item => item.attachments || []).filter(attachment => {
    // The dashboard intentionally treats the same object in different rooms
    // as distinct evidence, while suppressing duplicate copies in one room.
    const key = `${attachment.fingerprint || attachment.id}::${attachment.classroomName || itemSourceLabel(items[0])}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dashboardPendingAreaRank(item: DashboardPendingItem): number {
  if (item.area === "Model Classroom" || item.area === "All Classrooms" ||
      item.area === "Classrooms" || item.area === "CR") return 0;
  if (item.area === "5.0 Lab" || item.area === "Lab Room" || item.area === "Lab") return 1;
  if (item.area === "Staff Room") return 2;
  return 3;
}

function dashboardPendingItem(item: DashboardPendingItem): boolean {
  const status = normalizedStatusLookup(item.status);
  return status !== "done" && status !== "n/a";
}

function mergeRemarkDate(items: DashboardPendingItem[]): string | null {
  const dates = items.flatMap(item => itemRemarkSources(item))
    .filter(source => source.remark?.trim() && source.remarkDate)
    .map(source => source.remarkDate as string);
  return dates.sort().at(-1) || null;
}

function compactDashboardClassroomItems(items: DashboardPendingItem[]): DashboardPendingItem[] {
  const regularItems = items
    .filter(item => item.area !== "All Classrooms")
    .map(item => ({
      ...item,
      sources: itemSources(item),
      remarkSources: itemRemarkSources(item),
    }));
  const classroomItems = items.filter(item => item.area === "All Classrooms");
  const lineItemGroups = new Map<string, DashboardPendingItem[]>();

  classroomItems.forEach(item => {
    const key = `${item.category}::${item.lineItem}`;
    const group = lineItemGroups.get(key) || [];
    group.push(item);
    lineItemGroups.set(key, group);
  });

  const compacted: DashboardPendingItem[] = [];
  lineItemGroups.forEach(group => {
    const stateGroups = new Map<string, DashboardPendingItem[]>();
    group.forEach(item => {
      const signature = JSON.stringify([
        item.status,
        item.timeline || "",
        item.remark || "",
      ]);
      const stateGroup = stateGroups.get(signature) || [];
      stateGroup.push(item);
      stateGroups.set(signature, stateGroup);
    });

    stateGroups.forEach(stateGroup => {
      const first = stateGroup[0];
      const roomNames = stateGroup.map(item => item.classroomName).filter(Boolean) as string[];
      const allRoomsMatch = stateGroup.length === group.length;
      compacted.push({
        ...first,
        id: stateGroup.map(item => item.id).join("-"),
        sources: stateGroup.flatMap(itemSources),
        remarkSources: stateGroup.flatMap(itemRemarkSources),
        classroomName: allRoomsMatch
          ? `All classrooms (${stateGroup.length})`
          : stateGroup.length === 1
            ? roomNames[0] || null
            : `${stateGroup.length} classrooms`,
        classroomNames: roomNames,
        areaLabel: allRoomsMatch
          ? `All classrooms (${stateGroup.length})`
          : stateGroup.length === 1
            ? roomNames[0] || first.space
            : `${stateGroup.length} classrooms`,
        attachments: distinctPendingAttachments(stateGroup),
        remarkDate: mergeRemarkDate(stateGroup),
        remarks: first.remark || null,
      });
    });
  });

  return [...regularItems, ...compacted];
}

function combineDashboardModelAndClassrooms(items: DashboardPendingItem[]): DashboardPendingItem[] {
  const compacted = compactDashboardClassroomItems(items);
  const candidates = compacted.filter(item =>
    item.area === "Model Classroom" || item.area === "All Classrooms",
  );
  const untouched = compacted.filter(item =>
    item.area !== "Model Classroom" && item.area !== "All Classrooms",
  );
  const groups = new Map<string, DashboardPendingItem[]>();

  candidates.forEach(item => {
    const key = JSON.stringify([
      item.category,
      item.lineItem,
      dashboardPendingItem(item) ? "pending" : item.status,
    ]);
    const group = groups.get(key) || [];
    group.push(item);
    groups.set(key, group);
  });

  const statusPriority = [
    "Blocker", "In-Progress", "Partially Done", "Need to revamp",
    "No info as of now", "Yet to start",
  ];
  const combined: DashboardPendingItem[] = [];
  groups.forEach(group => {
    const model = group.find(item => item.area === "Model Classroom");
    const classrooms = group.filter(item => item.area === "All Classrooms");
    if (!model || !classrooms.length) {
      combined.push(...group);
      return;
    }

    const classroomNames = [...new Set(classrooms.flatMap(item =>
      item.classroomNames || (item.classroomName ? [item.classroomName] : []),
    ).filter(Boolean))];
    const preferredRemarkItem = [model, ...classrooms].find(item => item.remark?.trim());
    const preferredTimelineItem = [model, ...classrooms].find(item => item.timeline);
    const mergedStatus = statusPriority.find(status => group.some(item => item.status === status)) ||
      model.status;
    combined.push({
      ...model,
      id: group.map(item => item.id).join("-"),
      sources: group.flatMap(itemSources),
      remarkSources: group.flatMap(itemRemarkSources),
      status: mergedStatus,
      isBlocker: group.some(item => item.isBlocker || item.status === "Blocker"),
      timeline: preferredTimelineItem?.timeline || null,
      targetDate: preferredTimelineItem?.targetDate || null,
      targetDateSource: preferredTimelineItem?.targetDateSource || null,
      remark: preferredRemarkItem?.remark || null,
      remarks: preferredRemarkItem?.remark || null,
      areaLabel: classroomNames.length
        ? `Model + All Classrooms (${classroomNames.length})`
        : "Model + All Classrooms",
      classroomName: classroomNames.length
        ? `Model + All Classrooms (${classroomNames.length})`
        : "Model + All Classrooms",
      classroomNames,
      attachments: distinctPendingAttachments(group),
      remarkDate: mergeRemarkDate(group),
    });
  });

  return [...untouched, ...combined];
}

function sortDashboardPendingItems(left: DashboardPendingItem, right: DashboardPendingItem): number {
  return dashboardPendingAreaRank(left) - dashboardPendingAreaRank(right) ||
    itemPriority(left) - itemPriority(right) ||
    left.category.localeCompare(right.category) ||
    left.lineItem.localeCompare(right.lineItem) ||
    left.id.localeCompare(right.id);
}

function asIsoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function extractDatedRemark(value: string | null, referenceDate: Date): { text: string; date: string } | null {
  if (!value?.trim()) return null;
  const months: Record<string, number> = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
    apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
    aug: 7, august: 7, sep: 8, sept: 8, september: 8,
    oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
  };
  const entries = value.split(/\r?\n/).flatMap(line => {
    const trimmed = line.trim();
    const named = trimmed.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})(?:\s+(\d{4}))?\s*[-–—:]\s*(.+)$/i);
    const numeric = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\s*[-–—:]\s*(.+)$/);
    let day: number;
    let month: number;
    let year: number;
    let text: string;
    if (named) {
      day = Number(named[1]);
      month = months[named[2].toLowerCase()];
      year = named[3] ? Number(named[3]) : referenceDate.getUTCFullYear();
      text = named[4].trim();
    } else if (numeric) {
      day = Number(numeric[1]);
      month = Number(numeric[2]) - 1;
      year = Number(numeric[3]);
      if (year < 100) year += 2000;
      text = numeric[4].trim();
    } else {
      return [];
    }
    if (month === undefined || !text) return [];
    const date = new Date(Date.UTC(year, month, day, 12));
    if (date.getUTCDate() !== day || date.getUTCMonth() !== month) return [];
    return [{ text, date: date.toISOString() }];
  });
  return entries.sort((left, right) => left.date.localeCompare(right.date)).at(-1) || null;
}

function statusRemarkDate(status: RawStatus): string | null {
  const currentRemark = status.remarks;
  const historyMatch = status.history?.filter(entry =>
    entry.remarks === currentRemark,
  ).map(entry => asIsoDate(entry.changedAt)).filter(Boolean) as string[] | undefined;
  return historyMatch?.sort().at(-1) ||
    asIsoDate(status.remarkDate) ||
    asIsoDate(status.updatedAt) ||
    asIsoDate(status.createdAt) ||
    null;
}

function statusAttachments(status: RawStatus, classroomName: string | null) {
  const entries = status.photoHistory?.length
    ? status.photoHistory.slice(0, 1)
    : status.photoUrl
      ? [{
          id: `${status.id}-current`,
          photoUrl: status.photoUrl,
          contentType: status.photoContentType || null,
          uploadedAt: status.updatedAt || null,
        }]
      : [];
  return entries.map(entry => ({
    id: entry.id,
    // Deliberately retain only the status identity. Email links point to the
    // authorized checklist route rather than exposing a public object URL.
    sourceStatusId: status.id,
    contentType: entry.contentType || null,
    uploadedAt: asIsoDate(entry.uploadedAt),
    classroomName,
    fingerprint: crypto.createHash("sha256").update(entry.photoUrl).digest("hex"),
  }));
}

export function buildPendingDataset(
  universities: RawUniversity[],
  now = new Date(),
  { recipients = PENDING_REPORT_RECIPIENTS, universityIds, sections, priority = "ALL" }: PendingDatasetOptions = {},
): Omit<PendingReportPreview, "previewId" | "expiresAt" | "delivery" | "attachment"> {
  const selectedSections = selectedDatasetSections(sections);
  const includeDailyRemarks = sections?.includes("dailyRemarks") || false;
  const priorityPresentation = PRIORITY_PRESENTATION[priority];
  const result = universities
    .filter(university => {
      if (priority === "ALL") return true;
      const universityPriority = university.isCritical
        ? "CRITICAL"
        : ({ P1: "CRITICAL", P2: "MEDIUM", P3: "LOW" }[
            String(university.priority || "NA").trim().toUpperCase()
          ] || String(university.priority || "NA").trim().toUpperCase());
      return universityPriority === priority;
    })
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
    .map(university => {
      const activeClassroomNames = new Set((university.classrooms || [])
        .map(classroom => classroom.roomId.trim().toLocaleLowerCase()));
      // Match dailyReport's active report scope: known areas only, while an
      // overall-classroom space must be backed by an active classroom identity.
      const reportSpaces = university.spaces.filter(space => AREA_NAMES[space.spaceType] &&
        (space.spaceType !== "overall_classroom" || activeClassroomNames.has(space.name.trim().toLocaleLowerCase())));
      const allSectionDataStates = ROOM_GROUPS.reduce((states, group) => {
        const groupSpaces = reportSpaces.filter(space => roomGroupForSpaceType(space.spaceType) === group);
        const hasEmptyReportSpace = groupSpaces.some(space => space.checklistStatuses.length === 0);
        const hasAnyReportSpace = groupSpaces.length > 0;
        const backedActiveClassrooms = new Set(groupSpaces
          .filter(space => space.spaceType === "overall_classroom" && space.checklistStatuses.length > 0)
          .map(space => space.name.trim().toLocaleLowerCase()));
        const activeClassroomMissingBacking = group === "classrooms" &&
          [...activeClassroomNames].some(roomId => !backedActiveClassrooms.has(roomId));
        states[group] = hasAnyReportSpace && !hasEmptyReportSpace && !activeClassroomMissingBacking
          ? "available" : "missing";
        return states;
      }, {} as PendingSectionDataStates);
      const sectionDataStates = Object.fromEntries(
        selectedSections.map(group => [group, allSectionDataStates[group]]),
      ) as PendingSectionDataStates;
      const reportItems: DashboardPendingItem[] = reportSpaces.flatMap(space => space.checklistStatuses
        .map(status => {
          const datedRemark = extractDatedRemark(status.remarks, now);
          const remark = datedRemark?.text || status.remarks?.trim() || null;
          // Match the Work Status Report exactly. The line item's university
          // timeline is authoritative; target and university-level dates are
          // planning metadata and must not reappear after this timeline is cleared.
          const timelineValue = status.universityTimeline?.trim() || null;
          const universityTimeline = dateOnly(status.universityTimeline);
          const targetDate = dateOnly(timelineValue);
          const targetDateSource = universityTimeline ? "university timeline" as const : null;
          const blocker = status.isBlocker || normalizedStatusLookup(status.currentStatus) === "blocker";
          return {
            id: status.id,
            space: AREA_NAMES[space.spaceType] || space.name,
            classroom: space.spaceType === "overall_classroom" ? space.name : null,
            classroomName: space.spaceType === "overall_classroom" ? space.name : null,
            area: AREA_NAMES[space.spaceType] || space.name,
            category: status.checklistItem.category,
            item: status.checklistItem.name,
            lineItem: status.checklistItem.name,
            status: pendingStatus(status.currentStatus, blocker),
            isBlocker: blocker,
            isOverdue: isOverdue(targetDate, now),
            targetDate: targetDate || null,
            targetDateSource,
            remarks: remark,
            remark,
            remarkDate: datedRemark?.date || statusRemarkDate(status),
            timeline: timelineValue,
            roomGroup: roomGroupForSpaceType(space.spaceType)!,
            areaLabel: space.spaceType === "overall_classroom"
              ? space.name
              : AREA_NAMES[space.spaceType] || space.name,
            sources: [{ id: status.id, label: space.spaceType === "overall_classroom"
              ? `${AREA_NAMES[space.spaceType]} — ${space.name}`
              : AREA_NAMES[space.spaceType] || space.name }],
             remarkSources: [{
               id: status.id,
               label: space.spaceType === "overall_classroom"
                 ? `${AREA_NAMES[space.spaceType]} — ${space.name}`
                 : AREA_NAMES[space.spaceType] || space.name,
               remark,
               remarkDate: datedRemark?.date || statusRemarkDate(status),
             }],
            attachments: statusAttachments(
              status,
              space.spaceType === "overall_classroom" ? space.name : null,
            ),
          };
        }));
      const compactedItems = combineDashboardModelAndClassrooms(reportItems)
        .filter(dashboardPendingItem)
        .filter(item => item.roomGroup && selectedSections.includes(item.roomGroup))
        .sort(sortDashboardPendingItems);
      const pendingItems: PendingItem[] = compactedItems.map(item => ({
        ...item,
        item: item.lineItem,
        classroom: item.classroomName,
        remarks: item.remark || null,
      }));
      return {
        id: university.id,
        name: university.name,
        checklistDataState: selectedSections.some(group => allSectionDataStates[group] === "available")
          ? "available" as const
          : "missing" as const,
        sectionDataStates,
        counts: {
          pending: pendingItems.length,
          blockers: pendingItems.filter(item => item.isBlocker).length,
          overdue: pendingItems.filter(item => item.isOverdue).length,
        },
        pendingItems,
        dailyRemarks: includeDailyRemarks
          ? (university.updates || []).map(update => ({
              id: update.id,
              content: update.content.trim(),
              authorName: update.authorName.trim(),
              createdAt: new Date(update.createdAt).toISOString(),
            }))
              .filter(update => update.content)
              .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
              .slice(0, 1)
          : undefined,
      };
    });
  const generatedAt = now.toISOString();
  return {
    generatedAt,
    sections: [...selectedSections, ...(includeDailyRemarks ? ["dailyRemarks" as const] : [])],
    priority: { key: priority, ...priorityPresentation },
    scope: universityIds
      ? { kind: "selected-universities", universityCount: result.length, universityIds: [...universityIds].sort() }
      : { kind: "all-active-universities", universityCount: result.length },
    recipients: [...recipients],
    summary: {
      pendingItems: result.reduce((count, university) => count + university.counts.pending, 0),
      blockers: result.reduce((count, university) => count + university.counts.blockers, 0),
      overdue: result.reduce((count, university) => count + university.counts.overdue, 0),
      universitiesWithoutChecklistData: result.filter(university => university.checklistDataState === "missing").length,
    },
    universities: result,
  };
}

type PendingDataset = Omit<PendingReportPreview, "previewId" | "expiresAt" | "delivery" | "attachment" | "sections"> & {
  /** Absent only on pre-section-selection persisted snapshots. */
  sections?: readonly PendingReportSection[];
};

function legacyPendingCsv(dataset: PendingDataset): string {
  const header = ["University", "Report state", "Checklist data", "Space", "Classroom", "Category", "Pending item", "Status", "Blocker", "Overdue", "Target date", "Target date source", "Remarks"];
  const rows = dataset.universities.flatMap(university => {
    if (!university.pendingItems.length) {
      const reportState = university.checklistDataState === "missing"
        ? "Checklist data missing; not described as complete"
        : "No pending work reported";
      return [[university.name, reportState, university.checklistDataState, "", "", "", "", "", "", "", "", "", ""]
        .map(csvCell).join(",")];
    }
    return university.pendingItems.map(item => [
      university.name, "Pending work", university.checklistDataState, item.space, item.classroom, item.category, item.item,
      item.status, item.isBlocker ? "Yes" : "No", item.isOverdue ? "Yes" : "No", item.targetDate,
      item.targetDateSource, item.remarks,
    ].map(csvCell).join(","));
  });
  return [header.map(csvCell).join(","), ...rows].join("\r\n");
}

function modernPendingCsv(dataset: PendingDataset): string {
  const header = [
    "University", "Report state", "Checklist data", "Room group", "Section data",
    "Space", "Classroom", "Category", "Pending item", "Status", "Blocker",
    "Overdue", "Target date", "Target date source", "Remarks",
  ];
  const rows = dataset.universities.flatMap(university => {
    const missingGroups = datasetSections(dataset).filter(group =>
      sectionState(university, group, itemsForRoomGroup(university, group)) === "missing");
    const itemRows = university.pendingItems
      .filter(item => datasetSections(dataset).includes(roomGroupForItem(item)))
      .map(item => {
        const group = roomGroupForItem(item);
        const sectionStateValue = sectionState(university, group, itemsForRoomGroup(university, group));
        return [
          university.name, "Pending work", university.checklistDataState, group, sectionStateValue,
          item.space, item.classroom, item.category, item.item, item.status,
          item.isBlocker ? "Yes" : "No", item.isOverdue ? "Yes" : "No", item.targetDate,
          item.targetDateSource, item.remarks,
        ].map(csvCell).join(",");
      });
    const sectionRows = missingGroups.map(group => [
      university.name, "Checklist data missing; not described as complete",
      university.checklistDataState, group, "missing", "", "", "", "", "", "", "", "", "", "",
    ].map(csvCell).join(","));
    const baseRow = [
      university.name, "No pending work reported", university.checklistDataState,
      "", "", "", "", "", "", "", "", "", "", "", "",
    ].map(csvCell).join(",");
    return itemRows.length ? [...itemRows, ...sectionRows] : [baseRow, ...sectionRows];
  });
  return [header.map(csvCell).join(","), ...rows].join("\r\n");
}

export function buildPendingCsv(
  dataset: PendingDataset,
  snapshotVersion = PENDING_REPORT_SNAPSHOT_VERSION,
): string {
  if (snapshotVersion >= 5) return dashboardPendingCsv(dataset, snapshotVersion);
  return snapshotVersion >= 4 ? modernPendingCsv(dataset) : legacyPendingCsv(dataset);
}

function pendingCsvRowCount(
  dataset: PendingDataset,
  snapshotVersion = PENDING_REPORT_SNAPSHOT_VERSION,
): number {
  if (snapshotVersion < 4) {
    return dataset.universities.reduce((count, university) => count + Math.max(1, university.pendingItems.length), 0);
  }
  if (snapshotVersion < 5) {
    return dataset.universities.reduce((count, university) => {
      const missingGroups = datasetSections(dataset).filter(group =>
        sectionState(university, group, itemsForRoomGroup(university, group)) === "missing");
      const pendingItemCount = university.pendingItems
        .filter(item => datasetSections(dataset).includes(roomGroupForItem(item))).length;
      return count + Math.max(1, pendingItemCount) + missingGroups.length;
    }, 0);
  }
  return dataset.universities.reduce((count, university) => {
    const missingGroups = datasetSections(dataset).filter(group =>
      sectionState(university, group, dashboardItemsForSection(university, group)) === "missing");
    const pendingItemCount = university.pendingItems
      .filter(item => datasetSections(dataset).includes(dashboardItemSection(item))).length;
    return count + Math.max(1, pendingItemCount) + missingGroups.length;
  }, 0);
}

function legacyPendingText(dataset: PendingDataset): string {
  const sections = dataset.universities.map(university => {
    const heading = `${university.name} — ${university.counts.pending} pending, ${university.counts.blockers} blockers, ${university.counts.overdue} overdue`;
    if (university.checklistDataState === "missing") return `${heading}\n  Checklist data is missing; this university is not described as complete.`;
    if (!university.pendingItems.length) return `${heading}\n  No pending work reported.`;
    return `${heading}\n${university.pendingItems.map(item =>
      `  - [${item.status}${item.isOverdue ? "; overdue" : ""}] ${item.space}${item.classroom ? ` / ${item.classroom}` : ""}: ${item.item} | Target: ${display(item.targetDate)}${item.targetDateSource ? ` (${item.targetDateSource})` : ""} | Remarks: ${display(item.remarks)}`).join("\n")}`;
  });
  return `NIAT InfraTracker — University Pending Work Report
Generated: ${dataset.generatedAt}
Scope: ${scopeDescription(dataset.scope)}
Pending items: ${dataset.summary.pendingItems}; Blockers: ${dataset.summary.blockers}; Overdue: ${dataset.summary.overdue}

${sections.join("\n\n")}

The complete pending-item list is attached as CSV.`;
}

function legacyPendingHtml(dataset: PendingDataset): string {
  const universitySections = dataset.universities.map(university => {
    const heading = `<h2 style="margin:24px 0 8px;color:#111827;">${escapeHtml(university.name)}</h2>
<p style="margin:0 0 10px;color:#374151;">${university.counts.pending} pending · ${university.counts.blockers} blockers · ${university.counts.overdue} overdue</p>`;
    if (university.checklistDataState === "missing") return `${heading}<p><strong>Checklist data is missing.</strong> This university is not described as complete.</p>`;
    if (!university.pendingItems.length) return `${heading}<p>No pending work reported.</p>`;
    const rows = university.pendingItems.map(item => `<tr>
<td>${escapeHtml(item.space)}${item.classroom ? `<br><small>${escapeHtml(item.classroom)}</small>` : ""}</td>
<td>${escapeHtml(item.category)}<br><strong>${escapeHtml(item.item)}</strong></td>
<td>${escapeHtml(item.status)}${item.isOverdue ? "<br><strong>Overdue</strong>" : ""}</td>
<td>${escapeHtml(display(item.targetDate))}${item.targetDateSource ? `<br><small>${escapeHtml(item.targetDateSource)}</small>` : ""}</td>
<td>${escapeHtml(display(item.remarks))}</td></tr>`).join("");
    return `${heading}<table role="table" style="border-collapse:collapse;width:100%;margin-bottom:16px;"><thead><tr>
<th>Space / classroom</th><th>Item</th><th>Status</th><th>Target date</th><th>Remarks</th>
</tr></thead><tbody>${rows}</tbody></table>`;
  }).join("");
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#111827;line-height:1.4;">
<h1>University Pending Work Report</h1>
<p>Generated: ${escapeHtml(dataset.generatedAt)}<br>Scope: ${escapeHtml(scopeDescription(dataset.scope))}<br>
Pending items: ${dataset.summary.pendingItems}; Blockers: ${dataset.summary.blockers}; Overdue: ${dataset.summary.overdue}</p>
${universitySections}
<p>The complete pending-item list is attached as CSV.</p>
<style>th,td{border:1px solid #d1d5db;padding:7px;text-align:left;vertical-align:top}th{background:#f3f4f6}small{color:#4b5563}</style>
</body></html>`;
}

function parseUtcDate(value: string): Date | null {
  const normalized = value.length === 10 ? `${value}T00:00:00.000Z` : value;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function humanUtcDate(value: string | null, includeTime = false): string {
  if (!value?.trim()) return "Not provided";
  const parsed = parseUtcDate(value);
  if (!parsed) return "Not provided";
  const month = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ][parsed.getUTCMonth()];
  const date = `${month} ${parsed.getUTCDate()}, ${parsed.getUTCFullYear()}`;
  if (!includeTime) return date;
  return `${date}, ${String(parsed.getUTCHours()).padStart(2, "0")}:${String(parsed.getUTCMinutes()).padStart(2, "0")} UTC`;
}

function statusPresentation(item: PendingItem): {
  label: string;
  tone: "blocker" | "in-progress" | "partially-done" | "yet-to-start" | "other";
  foreground: string;
  background: string;
  border: string;
} {
  const normalized = normalizedStatusLookup(item.status);
  if (item.isBlocker || normalized === "blocker") {
    return {
      label: "Blocker", tone: "blocker", foreground: "#b91c1c",
      background: "#fef2f2", border: "#ef4444",
    };
  }
  if (normalized === "in progress") {
    return {
      label: "In-Progress", tone: "in-progress", foreground: "#1d4ed8",
      background: "#eff6ff", border: "#3b82f6",
    };
  }
  if (normalized === "partially done" || normalized === "partial done") {
    return {
      label: "Partially Done", tone: "partially-done", foreground: "#6d28d9",
      background: "#f5f3ff", border: "#8b5cf6",
    };
  }
  if (normalized === "yet to start") {
    return {
      label: "Yet to start", tone: "yet-to-start", foreground: "#92400e",
      background: "#fffbeb", border: "#d97706",
    };
  }
  return {
    label: normalizedStatusDisplay(item.status), tone: "other", foreground: "#475569",
    background: "#f1f5f9", border: "#64748b",
  };
}

function sectionState(
  university: PendingUniversity,
  group: PendingRoomGroup,
  items: PendingItem[],
): "available" | "missing" {
  const explicit = university.sectionDataStates?.[group];
  if (explicit) return explicit;
  if (items.length) return "available";
  return university.checklistDataState === "missing" ? "missing" : "available";
}

function itemsForRoomGroup(university: PendingUniversity, group: PendingRoomGroup): PendingItem[] {
  return university.pendingItems.filter(item => roomGroupForItem(item) === group);
}

function modernSectionText(university: PendingUniversity, group: PendingRoomGroup, items: PendingItem[]): string {
  const state = sectionState(university, group, items);
  const lines = [`  ${ROOM_GROUP_NAMES[group]}`];
  if (state === "missing") {
    lines.push("    Checklist data is missing for this section; it is not described as complete.");
  } else if (!items.length) {
    lines.push("    No pending items currently reported in this section.");
  }
  for (const item of items) {
    const status = statusPresentation(item);
    lines.push(
      `    - ${item.item || "Unnamed item"}`,
      `      Space: ${display(item.space)}${item.classroom ? `; Classroom: ${display(item.classroom)}` : ""}`,
      `      Category: ${display(item.category)}`,
      `      Status: ${status.label}`,
      ...(item.isOverdue ? ["      WARNING: OVERDUE"] : []),
      `      Target date: ${item.targetDate ? humanUtcDate(item.targetDate) : "No target date provided"}${item.targetDateSource ? ` (${item.targetDateSource})` : ""}`,
      `      Remarks: ${display(item.remarks)}`,
    );
  }
  return lines.join("\n");
}

function modernPendingText(dataset: PendingDataset): string {
  const universities = dataset.universities.map(university => {
    const heading = `${university.name} — ${university.counts.pending} pending, ${university.counts.blockers} blockers, ${university.counts.overdue} overdue`;
    const lines = [heading];
    if (university.checklistDataState === "missing") {
      lines.push("Checklist data is missing; this university is not described as complete.");
    }
    for (const group of datasetSections(dataset)) {
      lines.push(modernSectionText(university, group, itemsForRoomGroup(university, group)));
    }
    return lines.join("\n");
  });
  return `NIAT InfraTracker — University Pending Work Report
Generated: ${humanUtcDate(dataset.generatedAt, true)}
Scope: ${scopeDescription(dataset.scope)}
Pending items: ${dataset.summary.pendingItems}; Blockers: ${dataset.summary.blockers}; Overdue: ${dataset.summary.overdue}

${universities.join("\n\n")}

The complete pending-item list is attached as CSV.`;
}

function modernSectionHtml(university: PendingUniversity, group: PendingRoomGroup): string {
  const items = itemsForRoomGroup(university, group);
  const state = sectionState(university, group, items);
  const missingMessage = `<p style="margin:0 0 10px;padding:10px 12px;border:1px solid #f59e0b;background:#fffbeb;color:#92400e;font-size:14px;line-height:1.45;">
<strong>Checklist data missing.</strong> This section is not described as complete.</p>`;
  const emptyMessage = `<p style="margin:0 0 10px;padding:10px 12px;border:1px solid #d1d5db;background:#f9fafb;color:#374151;font-size:14px;line-height:1.45;">
No pending items currently reported in this section.</p>`;
  const statusCards = items.map(item => {
    const status = statusPresentation(item);
    const overdue = item.isOverdue
      ? `<div class="pending-overdue-warning" role="note" aria-label="Overdue warning" style="display:inline-block;margin-top:6px;padding:3px 7px;border:1px solid #f59e0b;background:#fffbeb;color:#92400e;font-size:12px;font-weight:700;letter-spacing:.03em;">WARNING: OVERDUE</div>`
      : "";
    const statusBadge = `<span class="pending-status pending-status-${status.tone}" aria-label="Status: ${escapeHtml(status.label)}" style="display:inline-block;padding:4px 8px;border:1px solid ${status.border};background:${status.background};color:${status.foreground};font-size:13px;font-weight:700;line-height:1.25;">${escapeHtml(status.label)}</span>${overdue}`;
    const location = `${escapeHtml(display(item.space))}${item.classroom
      ? `<br><span style="display:inline-block;margin-top:4px;color:#374151;font-size:13px;">Classroom: ${escapeHtml(item.classroom)}</span>`
      : ""}`;
    const target = item.targetDate
      ? escapeHtml(humanUtcDate(item.targetDate))
      : "No target date provided";
    const source = item.targetDateSource
      ? `<br><span style="color:#6b7280;font-size:12px;">Source: ${escapeHtml(item.targetDateSource)}</span>`
      : "";
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 12px;border-collapse:collapse;border:1px solid #9ca3af;table-layout:fixed;">
<tbody>
<tr><th scope="row" width="31%" style="width:31%;padding:9px 10px;border:1px solid #d1d5db;background:#f3f4f6;color:#374151;font-size:12px;line-height:1.35;text-align:left;vertical-align:top;word-break:break-word;">Space / classroom</th><td style="padding:9px 10px;border:1px solid #d1d5db;color:#111827;font-size:14px;line-height:1.4;text-align:left;vertical-align:top;word-break:break-word;">${location}</td></tr>
<tr><th scope="row" style="padding:9px 10px;border:1px solid #d1d5db;background:#f3f4f6;color:#374151;font-size:12px;line-height:1.35;text-align:left;vertical-align:top;word-break:break-word;">Category / item</th><td style="padding:9px 10px;border:1px solid #d1d5db;color:#111827;font-size:14px;line-height:1.4;text-align:left;vertical-align:top;word-break:break-word;">${escapeHtml(display(item.category))}<br><strong>${escapeHtml(display(item.item))}</strong></td></tr>
<tr><th scope="row" style="padding:9px 10px;border:1px solid #d1d5db;background:#f3f4f6;color:#374151;font-size:12px;line-height:1.35;text-align:left;vertical-align:top;word-break:break-word;">Status</th><td style="padding:9px 10px;border:1px solid #d1d5db;color:#111827;font-size:14px;line-height:1.4;text-align:left;vertical-align:top;word-break:break-word;">${statusBadge}</td></tr>
<tr><th scope="row" style="padding:9px 10px;border:1px solid #d1d5db;background:#f3f4f6;color:#374151;font-size:12px;line-height:1.35;text-align:left;vertical-align:top;word-break:break-word;">Target date</th><td style="padding:9px 10px;border:1px solid #d1d5db;color:#111827;font-size:14px;line-height:1.4;text-align:left;vertical-align:top;word-break:break-word;">${target}${source}</td></tr>
<tr><th scope="row" style="padding:9px 10px;border:1px solid #d1d5db;background:#f3f4f6;color:#374151;font-size:12px;line-height:1.35;text-align:left;vertical-align:top;word-break:break-word;">Remarks</th><td style="padding:9px 10px;border:1px solid #d1d5db;color:#111827;font-size:14px;line-height:1.4;text-align:left;vertical-align:top;word-break:break-word;">${escapeHtml(display(item.remarks))}</td></tr>
</tbody></table>`;
  }).join("");
  return `<div style="margin:18px 0 0;">
<h3 style="margin:0 0 8px;padding:9px 10px;border-bottom:2px solid #9ca3af;color:#111827;font-size:16px;line-height:1.3;">${ROOM_GROUP_NAMES[group]}</h3>
${state === "missing" ? missingMessage : !items.length ? emptyMessage : ""}${statusCards}
</div>`;
}

function modernPendingHtml(dataset: PendingDataset): string {
  const universitySections = dataset.universities.map(university => `<section style="margin:24px 0 0;padding:0 0 8px;border-top:2px solid #374151;">
<h2 style="margin:18px 0 5px;color:#111827;font-size:20px;line-height:1.3;word-break:break-word;">${escapeHtml(university.name)}</h2>
<p style="margin:0 0 9px;color:#374151;font-size:14px;line-height:1.45;">${university.counts.pending} pending &middot; ${university.counts.blockers} blockers &middot; ${university.counts.overdue} overdue</p>
${university.checklistDataState === "missing"
    ? `<p style="margin:0 0 10px;padding:10px 12px;border:1px solid #f59e0b;background:#fffbeb;color:#92400e;font-size:14px;line-height:1.45;"><strong>Checklist data missing.</strong> This university is not described as complete.</p>`
    : ""}
${datasetSections(dataset).map(group => modernSectionHtml(university, group)).join("")}
</section>`).join("");
  return `<!doctype html>
<html lang="en"><body style="margin:0;padding:0;background:#f9fafb;color:#111827;font-family:Arial,Helvetica,sans-serif;line-height:1.4;">
<div style="max-width:760px;margin:0 auto;padding:20px 16px;background:#ffffff;">
<h1 style="margin:0 0 8px;color:#111827;font-size:24px;line-height:1.25;">NIAT InfraTracker &mdash; University Pending Work Report</h1>
<p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.55;">
<strong>Generated:</strong> ${escapeHtml(humanUtcDate(dataset.generatedAt, true))}<br>
<strong>Scope:</strong> ${escapeHtml(scopeDescription(dataset.scope))}<br>
<strong>Pending items:</strong> ${dataset.summary.pendingItems} &middot; <strong>Blockers:</strong> ${dataset.summary.blockers} &middot; <strong>Overdue:</strong> ${dataset.summary.overdue}</p>
${universitySections}
<p style="margin:24px 0 0;padding-top:12px;border-top:1px solid #d1d5db;color:#4b5563;font-size:13px;line-height:1.45;">The complete pending-item list is attached as CSV.</p>
</div></body></html>`;
}

const DASHBOARD_SECTION_LABELS: Record<PendingRoomGroup, string> = {
  classrooms: "CR (Classrooms)",
  lab: "Lab Room",
  staff: "Staff Room",
};

function dashboardSectionLabel(group: PendingRoomGroup): string {
  return DASHBOARD_SECTION_LABELS[group];
}

function checklistHref(universityId: string, statusId: string): string {
  const configuredBaseUrl = process.env.PUBLIC_APP_URL?.trim();
  const baseUrl = configuredBaseUrl && /^https:\/\/[^/\s]+(?:\/.*)?$/i.test(configuredBaseUrl)
    ? configuredBaseUrl
    : DEFAULT_PUBLIC_APP_URL;
  return new URL(
    `/university/${encodeURIComponent(universityId)}?item=${encodeURIComponent(statusId)}`,
    baseUrl,
  ).toString();
}

function dashboardItemLocation(item: PendingItem): string {
  return item.areaLabel || item.classroomName ||
    (item.classroom ? `${item.space} — ${item.classroom}` : item.space);
}

function dashboardItemLineItem(item: PendingItem): string {
  return item.item || "Unnamed item";
}

function dashboardItemTimeline(item: PendingItem): string {
  if (item.timeline) {
    const parsed = parseUtcDate(item.timeline);
    return parsed ? humanUtcDate(item.timeline) : display(item.timeline);
  }
  return item.targetDate ? humanUtcDate(item.targetDate) : "Not provided";
}

function dashboardItemRemark(
  item: PendingItem,
  snapshotVersion = PENDING_REPORT_SNAPSHOT_VERSION,
): string {
  // Keep the v5 dashboard renderer byte-compatible for already reviewed
  // snapshots. New v6 snapshots use grouped display-only remark entries.
  if (snapshotVersion < PENDING_REPORT_SNAPSHOT_VERSION) {
    return display(item.remark ?? item.remarks);
  }
  const entries = dashboardRemarkEntries(item as DashboardPendingItem);
  if (!entries.length) return "—";
  return entries.map(entry => entries.length > 1
    ? `${entry.labels.join(", ")}: ${entry.text}`
    : entry.text).join(" | ");
}

function dashboardItemRemarkDate(
  item: PendingItem,
  snapshotVersion = PENDING_REPORT_SNAPSHOT_VERSION,
): string {
  if (snapshotVersion < PENDING_REPORT_SNAPSHOT_VERSION) {
    return item.remarkDate ? humanUtcDate(item.remarkDate) : "Not provided";
  }
  const entries = dashboardRemarkEntries(item as DashboardPendingItem);
  if (!entries.length) return "—";
  return entries.map(entry => {
    const date = entry.remarkDate ? humanUtcDate(entry.remarkDate) : "Not provided";
    return entries.length > 1 ? `${entry.labels.join(", ")}: ${date}` : date;
  }).join(" | ");
}

function dashboardItemSources(item: PendingItem): Array<{ id: string; label: string }> {
  return item.sources?.length
    ? item.sources
    : item.id ? [{ id: item.id, label: dashboardItemLocation(item) }] : [];
}

function dashboardItemAttachmentLinks(university: PendingUniversity, item: PendingItem): string[] {
  return (item.attachments || []).map(attachment =>
    checklistHref(university.id, attachment.sourceStatusId || attachment.id),
  );
}

function dashboardItemSourceLinks(university: PendingUniversity, item: PendingItem): Array<{ href: string; label: string }> {
  return dashboardItemSources(item).map(source => ({
    href: checklistHref(university.id, source.id),
    label: source.label,
  }));
}

function dashboardAttachmentText(university: PendingUniversity, item: PendingItem): string {
  const attachments = item.attachments || [];
  if (!attachments.length) return "None";
  return attachments.map((attachment, index) => {
    const href = checklistHref(university.id, attachment.sourceStatusId || attachment.id);
    const uploaded = attachment.uploadedAt ? ` (${humanUtcDate(attachment.uploadedAt)})` : "";
    return `Attachment ${index + 1}: ${href}${uploaded}`;
  }).join(" | ");
}

function dashboardItemSection(item: PendingItem): PendingRoomGroup {
  return roomGroupForItem(item);
}

function dashboardItemsForSection(university: PendingUniversity, group: PendingRoomGroup): PendingItem[] {
  return university.pendingItems.filter(item => dashboardItemSection(item) === group);
}

function dashboardPendingCsv(
  dataset: PendingDataset,
  snapshotVersion = PENDING_REPORT_SNAPSHOT_VERSION,
): string {
  const header = [
    "University", "Section", "Location", "Line Item", "Status", "Timeline",
    "Line Item Remark", "Remark Date", "Attachment",
  ];
  const rows = dataset.universities.flatMap(university => {
    const itemRows = university.pendingItems
      .filter(item => datasetSections(dataset).includes(dashboardItemSection(item)))
      .map(item => [
        university.name,
        dashboardSectionLabel(dashboardItemSection(item)),
        dashboardItemLocation(item),
        dashboardItemLineItem(item),
        statusPresentation(item).label + (item.isOverdue ? " (Overdue)" : ""),
        dashboardItemTimeline(item),
         dashboardItemRemark(item, snapshotVersion),
         dashboardItemRemarkDate(item, snapshotVersion),
        dashboardAttachmentText(university, item),
      ].map(csvCell).join(","));
    const stateRows = datasetSections(dataset)
      .filter(group => sectionState(university, group, dashboardItemsForSection(university, group)) === "missing")
      .map(group => [
        university.name,
        dashboardSectionLabel(group),
        "Checklist data missing; not described as complete",
        "", "", "", "", "", "",
      ].map(csvCell).join(","));
    if (itemRows.length) return [...itemRows, ...stateRows];
    return [[
      university.name,
      "",
      university.checklistDataState === "missing"
        ? "Checklist data missing; not described as complete"
        : "No pending work reported",
      "", "", "", "", "", "",
    ].map(csvCell).join(","), ...stateRows];
  });
  return [header.map(csvCell).join(","), ...rows].join("\r\n");
}

function dashboardPendingText(
  dataset: PendingDataset,
  snapshotVersion = PENDING_REPORT_SNAPSHOT_VERSION,
): string {
  const universitySections = dataset.universities.map(university => {
    const lines = [
      `${university.name} — ${university.counts.pending} pending, ${university.counts.blockers} blockers, ${university.counts.overdue} overdue`,
    ];
    if (university.checklistDataState === "missing") {
      lines.push("Checklist data is missing; this university is not described as complete.");
    } else if (!university.pendingItems.length) {
      lines.push("No pending work reported for this university.");
    }
    if (dataset.sections?.includes("dailyRemarks")) {
      lines.push("\nDaily Remarks");
      if (!university.dailyRemarks?.length) lines.push("  No daily remarks reported.");
      for (const remark of university.dailyRemarks || []) {
        lines.push(`  - ${humanUtcDate(remark.createdAt)} | ${remark.authorName}: ${remark.content}`);
      }
    }
    for (const group of datasetSections(dataset)) {
      const items = dashboardItemsForSection(university, group);
      const state = sectionState(university, group, items);
      lines.push(`\n${dashboardSectionLabel(group)} (${items.length} pending item${items.length === 1 ? "" : "s"})`);
      if (state === "missing") {
        lines.push("  Checklist data is missing for this section; it is not described as complete.");
      } else if (!items.length) {
        lines.push("  No pending items currently reported in this section.");
      }
      for (const item of items) {
        const sourceLinks = dashboardItemSourceLinks(university, item);
        lines.push(
          `  - ${dashboardItemLocation(item)} | ${dashboardItemLineItem(item)} | ${statusPresentation(item).label}${item.isOverdue ? " | WARNING: OVERDUE" : ""}`,
          `    Timeline: ${dashboardItemTimeline(item)}`,
           `    Line Item Remark: ${dashboardItemRemark(item, snapshotVersion)}`,
           `    Remark Date: ${dashboardItemRemarkDate(item, snapshotVersion)}`,
          `    Attachment: ${dashboardAttachmentText(university, item)}`,
          ...(sourceLinks.length
            ? [`    Checklist source: ${sourceLinks.map(source => `${source.label}: ${source.href}`).join(" | ")}`]
            : []),
        );
      }
    }
    return lines.join("\n");
  });
  return `NIAT InfraTracker — University Pending Work Report
Generated: ${humanUtcDate(dataset.generatedAt, true)}
Scope: ${scopeDescription(dataset.scope)}
Priority: ${dataset.priority?.label || "All Priorities"}
Pending items: ${dataset.summary.pendingItems}; Blockers: ${dataset.summary.blockers}; Overdue: ${dataset.summary.overdue}

${universitySections.join("\n\n")}

The complete pending-item list is attached as CSV.`;
}

function dashboardPendingHtml(
  dataset: PendingDataset,
  snapshotVersion = PENDING_REPORT_SNAPSHOT_VERSION,
): string {
  const universitySections = dataset.universities.map(university => {
    const sections = datasetSections(dataset).map(group => {
      const items = dashboardItemsForSection(university, group);
      const state = sectionState(university, group, items);
      const rows = items.map(item => {
        const status = statusPresentation(item);
        const overdue = item.isOverdue
          ? `<div role="note" aria-label="Overdue warning" style="display:inline-block;margin-top:5px;padding:3px 6px;border:1px solid #f59e0b;background:#fffbeb;color:#92400e;font-size:11px;font-weight:700;">WARNING: OVERDUE</div>`
          : "";
        const lineItem = `<strong>${escapeHtml(dashboardItemLineItem(item))}</strong>`;
        const attachments = (item.attachments || []).map((attachment, index) => {
          const href = checklistHref(university.id, attachment.sourceStatusId || attachment.id);
          const uploaded = attachment.uploadedAt
            ? `<br><span style="color:#6b7280;font-size:11px;">${escapeHtml(humanUtcDate(attachment.uploadedAt))}</span>`
            : "";
          return `<a href="${escapeHtml(href)}" style="color:#1d4ed8;line-height:1.4;">View attachment ${index + 1}</a>${uploaded}`;
        }).join("<br>");
        return `<tr>
<td style="width:17%;padding:9px 10px;border:1px solid #9ca3af;color:#111827;font-size:13px;line-height:1.4;text-align:left;vertical-align:top;word-break:break-word;">${escapeHtml(dashboardItemLocation(item))}</td>
<td style="width:18%;padding:9px 10px;border:1px solid #9ca3af;color:#111827;font-size:13px;line-height:1.4;text-align:left;vertical-align:top;word-break:break-word;">${lineItem}</td>
<td style="width:12%;padding:9px 10px;border:1px solid #9ca3af;color:#111827;font-size:13px;line-height:1.4;text-align:left;vertical-align:top;word-break:break-word;"><span class="pending-status pending-status-${status.tone}" aria-label="Status: ${escapeHtml(status.label)}" style="display:inline-block;padding:4px 7px;border:1px solid ${status.border};background:${status.background};color:${status.foreground};font-size:12px;font-weight:700;line-height:1.25;">${escapeHtml(status.label)}</span>${overdue}</td>
<td style="width:13%;padding:9px 10px;border:1px solid #9ca3af;color:#111827;font-size:13px;line-height:1.4;text-align:left;vertical-align:top;word-break:break-word;">${escapeHtml(dashboardItemTimeline(item))}</td>
 <td style="width:17%;padding:9px 10px;border:1px solid #9ca3af;color:#111827;font-size:13px;line-height:1.4;text-align:left;vertical-align:top;word-break:break-word;">${escapeHtml(dashboardItemRemark(item, snapshotVersion))}</td>
 <td style="width:11%;padding:9px 10px;border:1px solid #9ca3af;color:#111827;font-size:13px;line-height:1.4;text-align:left;vertical-align:top;word-break:break-word;">${escapeHtml(dashboardItemRemarkDate(item, snapshotVersion))}</td>
<td style="width:12%;padding:9px 10px;border:1px solid #9ca3af;color:#111827;font-size:13px;line-height:1.4;text-align:left;vertical-align:top;word-break:break-word;">${attachments || "None"}</td>
</tr>`;
      }).join("");
      const message = state === "missing"
        ? `<p style="margin:0 0 10px;padding:10px 12px;border:1px solid #f59e0b;background:#fffbeb;color:#92400e;font-size:13px;line-height:1.45;"><strong>Checklist data missing.</strong> This section is not described as complete.</p>`
        : !items.length
          ? `<p style="margin:0 0 10px;padding:10px 12px;border:1px solid #d1d5db;background:#f9fafb;color:#374151;font-size:13px;line-height:1.45;">No pending items currently reported in this section.</p>`
          : "";
      return `<div style="margin:18px 0 0;">
<h3 style="margin:0 0 8px;padding:9px 10px;border-bottom:2px solid #9ca3af;color:#111827;font-size:16px;line-height:1.3;">${dashboardSectionLabel(group)}<span style="float:right;color:#4b5563;font-size:12px;font-weight:400;">${items.length} pending item${items.length === 1 ? "" : "s"}</span></h3>
${message}${items.length ? `<div style="width:100%;overflow-x:auto;"><table role="table" style="width:100%;min-width:720px;margin:0 0 13px;border-collapse:collapse;border:1px solid #9ca3af;table-layout:fixed;">
<thead><tr>
<th style="padding:9px 10px;border:1px solid #9ca3af;background:#e5e7eb;color:#111827;font-size:12px;line-height:1.3;text-align:left;">Location</th>
<th style="padding:9px 10px;border:1px solid #9ca3af;background:#e5e7eb;color:#111827;font-size:12px;line-height:1.3;text-align:left;">Line Item</th>
<th style="padding:9px 10px;border:1px solid #9ca3af;background:#e5e7eb;color:#111827;font-size:12px;line-height:1.3;text-align:left;">Status</th>
<th style="padding:9px 10px;border:1px solid #9ca3af;background:#e5e7eb;color:#111827;font-size:12px;line-height:1.3;text-align:left;">Timeline</th>
<th style="padding:9px 10px;border:1px solid #9ca3af;background:#e5e7eb;color:#111827;font-size:12px;line-height:1.3;text-align:left;">Line Item Remark</th>
<th style="padding:9px 10px;border:1px solid #9ca3af;background:#e5e7eb;color:#111827;font-size:12px;line-height:1.3;text-align:left;">Remark Date</th>
<th style="padding:9px 10px;border:1px solid #9ca3af;background:#e5e7eb;color:#111827;font-size:12px;line-height:1.3;text-align:left;">Attachment</th>
</tr></thead><tbody>${rows}</tbody></table></div>` : ""}
</div>`;
    }).join("");
    const dailyRemarks = dataset.sections?.includes("dailyRemarks")
      ? `<div style="margin:18px 0 0;"><h3 style="margin:0 0 8px;padding:9px 10px;border-bottom:2px solid #9ca3af;color:#111827;font-size:16px;">Daily Remarks</h3>${
          university.dailyRemarks?.length
            ? university.dailyRemarks.map(remark => `<div style="margin:0 0 8px;padding:10px 12px;border:1px solid #d1d5db;background:#f9fafb;color:#111827;font-size:13px;line-height:1.45;"><strong>${escapeHtml(humanUtcDate(remark.createdAt))}</strong> &middot; ${escapeHtml(remark.authorName)}<br>${escapeHtml(remark.content)}</div>`).join("")
            : `<p style="margin:0;padding:10px 12px;border:1px solid #d1d5db;background:#f9fafb;color:#374151;font-size:13px;">No daily remarks reported.</p>`
        }</div>`
      : "";
    return `<section style="margin:24px 0 0;padding:0 0 8px;border-top:2px solid #374151;">
<h2 style="margin:18px 0 5px;color:#111827;font-size:20px;line-height:1.3;word-break:break-word;">${escapeHtml(university.name)}</h2>
<p style="margin:0 0 9px;color:#374151;font-size:14px;line-height:1.45;">${university.counts.pending} pending &middot; ${university.counts.blockers} blockers &middot; ${university.counts.overdue} overdue</p>
${university.checklistDataState === "missing"
    ? `<p style="margin:0 0 10px;padding:10px 12px;border:1px solid #f59e0b;background:#fffbeb;color:#92400e;font-size:13px;line-height:1.45;"><strong>Checklist data missing.</strong> This university is not described as complete.</p>`
    : !university.pendingItems.length
      ? `<p style="margin:0 0 10px;padding:10px 12px;border:1px solid #d1d5db;background:#f9fafb;color:#374151;font-size:13px;line-height:1.45;">No pending work reported for this university.</p>`
      : ""}${dailyRemarks}${sections}</section>`;
  }).join("");
  return `<!doctype html>
<html lang="en"><body style="margin:0;padding:0;background:#f9fafb;color:#111827;font-family:Arial,Helvetica,sans-serif;line-height:1.4;">
<div style="max-width:920px;margin:0 auto;padding:20px 16px;background:#ffffff;">
<h1 style="margin:0 0 8px;color:#111827;font-size:24px;line-height:1.25;">NIAT InfraTracker &mdash; University Pending Work Report</h1>
${dataset.priority ? `<div style="display:inline-block;margin:0 0 12px;padding:5px 10px;border-radius:999px;background:${escapeHtml(dataset.priority.background)};color:${escapeHtml(dataset.priority.color)};font-size:13px;font-weight:700;">${escapeHtml(dataset.priority.label)}</div>` : ""}
<p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.55;"><strong>Generated:</strong> ${escapeHtml(humanUtcDate(dataset.generatedAt, true))}<br>
<strong>Scope:</strong> ${escapeHtml(scopeDescription(dataset.scope))}<br>
<strong>Pending items:</strong> ${dataset.summary.pendingItems} &middot; <strong>Blockers:</strong> ${dataset.summary.blockers} &middot; <strong>Overdue:</strong> ${dataset.summary.overdue}</p>
${universitySections}
<p style="margin:24px 0 0;padding-top:12px;border-top:1px solid #d1d5db;color:#4b5563;font-size:13px;line-height:1.45;">The complete pending-item list is attached as CSV.</p>
</div></body></html>`;
}

/**
 * v1-v3 snapshots intentionally retain the old flattened rendering. v4
 * snapshots retain the grouped, inline-only renderer introduced by the
 * previous pending-email release. v5 previews use the original
 * dashboard-aligned table and v6 adds grouped remark display. The optional
 * version keeps callers that render a reviewed snapshot from silently
 * changing its bytes.
 */
export function buildPendingText(dataset: PendingDataset, snapshotVersion = PENDING_REPORT_SNAPSHOT_VERSION): string {
  if (snapshotVersion >= 5) return dashboardPendingText(dataset, snapshotVersion);
  return snapshotVersion >= 4 ? modernPendingText(dataset) : legacyPendingText(dataset);
}

export function buildPendingHtml(dataset: PendingDataset, snapshotVersion = PENDING_REPORT_SNAPSHOT_VERSION): string {
  if (snapshotVersion >= 5) return dashboardPendingHtml(dataset, snapshotVersion);
  return snapshotVersion >= 4 ? modernPendingHtml(dataset) : legacyPendingHtml(dataset);
}

export class ResendPendingReportProvider implements PendingReportProvider {
  readonly providerKind = "resend" as const;

  constructor(
    private readonly config: { apiKey: string; from: string },
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = PROVIDER_TIMEOUT_MS,
  ) {}

  async send(message: PendingReportMessage): Promise<{ id: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": message.idempotencyKey,
        },
        signal: controller.signal,
        body: JSON.stringify({
          from: this.config.from, to: message.recipients, subject: message.subject,
          html: message.html, text: message.text,
          attachments: [{ filename: message.filename, content: Buffer.from(message.csv, "utf8").toString("base64") }],
        }),
      });
      if (!response.ok) {
        const body = (await response.text()).slice(0, 500);
        if (/verified|domain|sender|from/i.test(body)) {
          throw new PendingReportError(503, "Resend rejected the sender. Verify PENDING_REPORT_FROM_EMAIL or its domain in Resend, then keep PENDING_REPORT_VERIFIED_SENDER=true.");
        }
        throw new PendingReportError(502, `Resend did not accept the report request (HTTP ${response.status}). Please retry after checking Resend.`);
      }
      const result = await response.json() as { id?: string };
      if (!result.id) throw new PendingReportError(502, "Resend accepted an invalid response without a message ID. Please retry.");
      return { id: result.id };
    } catch (error) {
      if (error instanceof PendingReportError) throw error;
      if ((error as Error).name === "AbortError") throw new PendingReportError(504, "Resend did not respond within 10 seconds. No delivery outcome is known; retry the same confirmation.");
      throw new PendingReportError(502, "Could not contact Resend. No provider acceptance was recorded; retry the same confirmation.");
    } finally {
      clearTimeout(timer);
    }
  }
}

class DemonstrationPendingReportProvider implements PendingReportProvider {
  async send(message: PendingReportMessage): Promise<{ id: string }> {
    return { id: `demo-${message.idempotencyKey}` };
  }
}

export function assertProductionPendingSender(sender: string): void {
  const normalizedSender = sender.toLowerCase();
  const senderDomain = normalizedSender.split("@")[1] || "";
  if (normalizedSender === "onboarding@resend.dev" || senderDomain === "localhost" ||
      senderDomain.endsWith(".test") || ["example.com", "example.org", "example.net", "invalid"].includes(senderDomain)) {
    throw new PendingReportError(503, "PENDING_REPORT_FROM_EMAIL is a Resend sandbox or test address. Configure a verified production domain sender in Resend.");
  }
}

function normalizeDeliveryProvider(value: string | undefined): Exclude<PendingReportProviderKind, "demonstration"> {
  const provider = value?.trim().toLowerCase() || "resend";
  if (provider !== "resend" && provider !== "gmail") {
    throw new PendingReportError(503, "PENDING_REPORT_PROVIDER must be either \"resend\" or \"gmail\".");
  }
  return provider;
}

function normalizedSenderEmail(value: string | null | undefined): string | null {
  return value?.trim().toLowerCase() || null;
}

function currentConfiguredSender(provider: Exclude<PendingReportProviderKind, "demonstration">): {
  senderEmail: string;
  senderName: string;
} {
  const sender = process.env.PENDING_REPORT_FROM_EMAIL?.trim() ||
    (provider === "gmail" ? PENDING_REPORT_GMAIL_SENDER : "");
  if (!sender || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sender)) {
    throw new PendingReportError(503, provider === "gmail"
      ? "Gmail pending reports need PENDING_REPORT_FROM_EMAIL set to the approved Gmail sender."
      : "Live pending reports need PENDING_REPORT_FROM_EMAIL set to a Resend-verified sender address.");
  }
  const senderName = process.env.PENDING_REPORT_FROM_NAME?.trim() || "NIAT InfraTracker";
  if (/[\r\n\0]/.test(senderName)) {
    throw new PendingReportError(503, "PENDING_REPORT_FROM_NAME contains invalid header characters.");
  }
  return { senderEmail: sender, senderName };
}

function assertGmailConfiguredSender(sender: string): void {
  if (sender.trim().toLowerCase() !== PENDING_REPORT_GMAIL_SENDER) {
    throw new PendingReportError(
      503,
      `Gmail pending reports are restricted to the approved sender ${PENDING_REPORT_GMAIL_SENDER}.`,
    );
  }
}

function deliveryConfiguration(
  requestedMode?: "demonstration" | "live",
  requestedProvider?: PendingReportProviderKind,
  expectedSenderEmail?: string | null,
  expectedSenderName?: string | null,
): PendingReportDelivery {
  const mode = requestedMode || process.env.PENDING_REPORT_DELIVERY_MODE || "demonstration";
  if (mode === "demonstration") {
    if (requestedProvider && requestedProvider !== "demonstration") {
      throw new PendingReportError(409, "This report was reviewed for a different delivery provider. Generate a new preview.");
    }
    return {
      mode: "demonstration",
      message: "Demonstration mode: confirmation records mocked provider acceptance and sends no email.",
      provider: new DemonstrationPendingReportProvider(),
      providerKind: "demonstration",
      senderEmail: null,
      senderName: null,
    };
  }
  if (mode !== "live") {
    throw new PendingReportError(503, "PENDING_REPORT_DELIVERY_MODE must be either \"demonstration\" or \"live\".");
  }
  const provider = normalizeDeliveryProvider(process.env.PENDING_REPORT_PROVIDER);
  if (requestedProvider && requestedProvider !== provider) {
    throw new PendingReportError(
      409,
      `This report was reviewed for ${requestedProvider}, but pending reports are now configured for ${provider}. Do not resend it; generate a new preview.`,
    );
  }
  const { senderEmail, senderName } = currentConfiguredSender(provider);
  if (expectedSenderEmail && normalizedSenderEmail(expectedSenderEmail) !== normalizedSenderEmail(senderEmail)) {
    throw new PendingReportError(
      409,
      "The pending report sender changed after preview creation. Do not resend it; generate a new preview.",
    );
  }
  if (expectedSenderName && expectedSenderName !== senderName) {
    throw new PendingReportError(
      409,
      "The pending report sender name changed after preview creation. Do not resend it; generate a new preview.",
    );
  }
  if (provider === "gmail") {
    assertGmailConfiguredSender(senderEmail);
    return {
      mode: "live",
      message: `Live mode: confirmation submits the reviewed report to Gmail (${senderEmail}).`,
      provider: new GmailPendingReportProvider({ senderEmail, senderName }),
      providerKind: "gmail",
      senderEmail,
      senderName,
    };
  }
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new PendingReportError(503, "Live pending reports need RESEND_API_KEY. Add it in deployment secrets or use demonstration mode.");
  assertProductionPendingSender(senderEmail);
  if (process.env.PENDING_REPORT_VERIFIED_SENDER !== "true") {
    throw new PendingReportError(503, "Before live sending, verify the sender/domain in Resend and set PENDING_REPORT_VERIFIED_SENDER=true.");
  }
  return {
    mode: "live",
    message: `Live mode: confirmation submits the reviewed report to Resend (${senderEmail}).`,
    provider: new ResendPendingReportProvider({ apiKey, from: `${senderName} <${senderEmail}>` }),
    providerKind: "resend",
    senderEmail,
    senderName,
  };
}

const prismaDataSource: PendingReportDataSource = {
  activeUniversities: (universityIds) => prisma.university.findMany({
    where: { isDeleted: false, ...(universityIds ? { id: { in: universityIds } } : {}) },
    orderBy: { name: "asc" },
    select: {
      id: true, name: true, targetDate: true, priority: true, isCritical: true,
      updates: {
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, content: true, authorName: true, createdAt: true },
      },
      classrooms: {
        where: { isDeleted: false },
        select: { roomId: true },
      },
      spaces: {
        where: { isDeleted: false },
        select: {
          name: true, spaceType: true,
          checklistStatuses: {
            select: {
              id: true, currentStatus: true, remarks: true, targetTimeline: true,
              universityTimeline: true, isBlocker: true,
              createdAt: true, updatedAt: true, photoUrl: true, photoContentType: true,
              history: {
                orderBy: { changedAt: "desc" },
                select: { remarks: true, changedAt: true },
              },
              photoHistory: {
                orderBy: { uploadedAt: "desc" },
                take: 1,
                select: { id: true, photoUrl: true, contentType: true, uploadedAt: true },
              },
              checklistItem: { select: { category: true, name: true } },
            },
          },
        },
      },
    },
  }),
};

const prismaAuditWriter: PendingReportAuditWriter = {
  recordAccepted: async input => {
    await prisma.auditLog.create({
      data: {
        userId: input.userId, userEmail: input.userEmail, action: "pending_report_provider_accepted",
        module: "reports", entityId: input.previewId,
        updatedValue: {
          recipients: [...input.recipients], providerId: input.providerId,
          generatedAt: input.generatedAt, deliveryMode: input.deliveryMode, scope: input.scope,
          outcome: "provider_accepted_not_inbox_confirmed",
        },
      },
    });
  },
};

type SnapshotState = "ready" | "sending" | "unknown" | "accepted";
type StoredSnapshot = {
  id: string;
  createdByUserId: string;
  createdByEmail: string;
  snapshotVersion: number;
  deliveryMode: "demonstration" | "live";
  // Nullable for snapshots written before transport metadata was introduced.
  // Live rows without these fields are intentionally not sendable.
  deliveryProvider?: PendingReportProviderKind | null;
  senderEmail?: string | null;
  senderName?: string | null;
  dataset: PendingDataset;
  datasetPrunedAt?: Date | null;
  filename: string;
  snapshotHash: string;
  idempotencyKey: string;
  idempotencyExpiresAt: Date;
  state: SnapshotState;
  leaseToken: string | null;
  leaseExpiresAt: Date | null;
  attemptedAt: Date | null;
  attemptCount: number;
  providerId: string | null;
  providerAcceptedAt: Date | null;
  auditRecorded: boolean | null;
  expiresAt: Date;
};

type SnapshotClaim =
  | { kind: "claimed"; snapshot: StoredSnapshot }
  | { kind: "accepted"; snapshot: StoredSnapshot }
  | { kind: "busy" }
  | { kind: "expired" }
  | { kind: "unsafe" };

export type PendingReportSnapshotStore = {
  create(snapshot: StoredSnapshot): Promise<void>;
  find(id: string): Promise<StoredSnapshot | null>;
  claim(id: string, now: Date): Promise<SnapshotClaim>;
  markAccepted(id: string, leaseToken: string, providerId: string, acceptedAt: Date): Promise<StoredSnapshot>;
  markUnknown(id: string, leaseToken: string, now: Date): Promise<void>;
  release(id: string, leaseToken: string): Promise<void>;
  markAuditResult(id: string, auditRecorded: boolean): Promise<void>;
};

const LEASE_MS = 30_000;
// Resend's idempotency records are short lived. Never risk an unprovable retry
// once that window closes; an operator must inspect Resend instead.
const PROVIDER_IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1_000;

function deliveryDescription(
  mode: "demonstration" | "live",
  provider: PendingReportProviderKind | null,
  senderEmail: string | null,
) {
  if (mode === "demonstration" || provider === "demonstration") {
    return "Demonstration mode: confirmation records mocked provider acceptance and sends no email.";
  }
  if (provider === "gmail") {
    return `Live mode: confirmation submits the reviewed report to Gmail${senderEmail ? ` (${senderEmail})` : ""}.`;
  }
  if (provider === "resend") {
    return `Live mode: confirmation submits the reviewed report to Resend${senderEmail ? ` (${senderEmail})` : ""}.`;
  }
  return "Live mode: this older preview has no known delivery provider or sender and cannot be sent.";
}

function previewFromSnapshot(snapshot: StoredSnapshot): PendingReportPreview {
  const provider = snapshot.deliveryProvider ||
    (snapshot.deliveryMode === "demonstration" ? "demonstration" : null);
  return {
    ...snapshot.dataset,
    sections: datasetReportSections(snapshot.dataset),
    previewId: snapshot.id,
    expiresAt: snapshot.expiresAt.toISOString(),
    delivery: {
      mode: snapshot.deliveryMode,
      provider: provider || "unknown",
      senderEmail: snapshot.senderEmail || null,
      message: deliveryDescription(snapshot.deliveryMode, provider, snapshot.senderEmail || null),
    },
    attachment: {
      filename: snapshot.filename,
      contentType: "text/csv",
      rowCount: pendingCsvRowCount(snapshot.dataset, snapshot.snapshotVersion),
    },
  };
}

function snapshotProvider(snapshot: StoredSnapshot): PendingReportProviderKind | null {
  return snapshot.deliveryProvider ||
    (snapshot.deliveryMode === "demonstration" ? "demonstration" : null);
}

function deliveryProviderKind(delivery: PendingReportDelivery): PendingReportProviderKind {
  return delivery.providerKind || delivery.provider.providerKind ||
    (delivery.mode === "demonstration" ? "demonstration" : "resend");
}

function messageFromSnapshot(snapshot: StoredSnapshot): PendingReportMessage {
  const dataset = snapshot.dataset;
  return {
    recipients: dataset.recipients,
    subject: `NIAT InfraTracker — ${dataset.priority?.label || "All Priorities"} — Pending Work Report (${dataset.generatedAt.slice(0, 10)})`,
    html: buildPendingHtml(dataset, snapshot.snapshotVersion),
    text: buildPendingText(dataset, snapshot.snapshotVersion),
    csv: buildPendingCsv(dataset, snapshot.snapshotVersion),
    filename: snapshot.filename,
    idempotencyKey: snapshot.idempotencyKey,
  };
}

function toStoredSnapshot(row: any): StoredSnapshot {
  return {
    ...row,
    dataset: row.dataset as PendingDataset,
    deliveryMode: row.deliveryMode as "demonstration" | "live",
    deliveryProvider: row.deliveryProvider || null,
    senderEmail: row.senderEmail || null,
    senderName: row.senderName || null,
    state: row.state as SnapshotState,
    expiresAt: new Date(row.expiresAt),
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}

function snapshotPayloadHash(snapshot: Pick<StoredSnapshot,
  "snapshotVersion" | "deliveryMode" | "dataset" | "filename" | "deliveryProvider" | "senderEmail" | "senderName">): string {
  const payload: Record<string, unknown> = {
    snapshotVersion: snapshot.snapshotVersion,
    deliveryMode: snapshot.deliveryMode,
    dataset: snapshot.dataset,
    filename: snapshot.filename,
  };
  // Versions 1 and 2 deliberately retain their historical digest contract.
  // Versions 3 and later bind transport and sender metadata into the reviewed
  // payload. Versions 4 through 6 additionally freeze their grouped renderer
  // datasets while retaining the exact prior output contract.
  if (snapshot.snapshotVersion >= 3) {
    payload.deliveryProvider = snapshot.deliveryProvider ?? null;
    payload.senderEmail = snapshot.senderEmail ?? null;
    payload.senderName = snapshot.senderName ?? null;
  }
  return crypto.createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

function assertSupportedImmutableSnapshot(snapshot: StoredSnapshot) {
  if (snapshot.datasetPrunedAt) {
    throw new PendingReportError(410, "This report's detailed dataset has been retired and cannot be sent.");
  }
  if (snapshot.snapshotVersion !== 1 && snapshot.snapshotVersion !== 2 &&
      snapshot.snapshotVersion !== 3 && snapshot.snapshotVersion !== 4 &&
      snapshot.snapshotVersion !== 5 &&
      snapshot.snapshotVersion !== PENDING_REPORT_SNAPSHOT_VERSION) {
    throw new PendingReportError(409, "This report snapshot uses an unsupported version and cannot be sent. Generate a new preview.");
  }
  if (snapshot.snapshotVersion < 3 && snapshot.deliveryMode === "live") {
    throw new PendingReportError(
      409,
      "This older live report preview has no known provider or sender after the transport change and cannot be sent. Generate a new preview.",
    );
  }
  if (snapshot.snapshotVersion >= 3) {
    if (snapshot.deliveryProvider !== null && snapshot.deliveryProvider !== undefined &&
        snapshot.deliveryProvider !== "demonstration" &&
        snapshot.deliveryProvider !== "resend" &&
        snapshot.deliveryProvider !== "gmail") {
      throw new PendingReportError(409, "This report preview has an invalid delivery provider snapshot and cannot be sent. Generate a new preview.");
    }
    if (snapshot.deliveryMode === "live" &&
        (!snapshot.deliveryProvider || snapshot.deliveryProvider === "demonstration" || !snapshot.senderEmail)) {
      throw new PendingReportError(
        409,
        "This live report preview has no complete provider or sender snapshot and cannot be sent. Generate a new preview.",
      );
    }
    if (snapshot.deliveryMode === "demonstration" && snapshot.deliveryProvider !== "demonstration") {
      throw new PendingReportError(409, "This report preview has an invalid delivery snapshot and cannot be sent. Generate a new preview.");
    }
  }
  const expectedHash = snapshotPayloadHash(snapshot);
  const expected = Buffer.from(expectedHash, "utf8");
  const actual = Buffer.from(snapshot.snapshotHash, "utf8");
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw new PendingReportError(409, "This report snapshot failed its integrity check and cannot be sent. Generate a new preview.");
  }
}

const prismaSnapshotStore: PendingReportSnapshotStore = {
  async create(snapshot) {
    // Bounded maintenance on preview creation; no scheduling or send side effects.
    // A failure is surfaced rather than silently disabling retention.
    await cleanupPendingReportSnapshots(prisma, new Date());
    await prisma.pendingReportSnapshot.create({
      data: {
        id: snapshot.id, createdByUserId: snapshot.createdByUserId, createdByEmail: snapshot.createdByEmail,
        snapshotVersion: snapshot.snapshotVersion, deliveryMode: snapshot.deliveryMode,
        deliveryProvider: snapshot.deliveryProvider ?? null, senderEmail: snapshot.senderEmail ?? null, senderName: snapshot.senderName ?? null,
        dataset: snapshot.dataset,
        filename: snapshot.filename, snapshotHash: snapshot.snapshotHash, idempotencyKey: snapshot.idempotencyKey,
        expiresAt: snapshot.expiresAt,
        idempotencyExpiresAt: snapshot.idempotencyExpiresAt, state: snapshot.state,
      },
    });
  },
  async find(id) {
    const row = await prisma.pendingReportSnapshot.findUnique({ where: { id } });
    return row ? toStoredSnapshot(row) : null;
  },
  async claim(id, now) {
    const existing = await this.find(id);
    if (!existing) return { kind: "expired" };
    if (existing.state === "accepted") return { kind: "accepted", snapshot: existing };
    if (existing.state === "ready" && existing.expiresAt <= now) return { kind: "expired" };
    // Gmail messages.send has no idempotency support. An expired lease can
    // represent a still-in-flight request, so never claim a Gmail sending or
    // unknown row again, regardless of elapsed time.
    if (snapshotProvider(existing) === "gmail" &&
        (existing.state === "sending" || existing.state === "unknown")) return { kind: "unsafe" };
    if (existing.idempotencyExpiresAt <= now) return { kind: "unsafe" };
    if (existing.state === "sending" && existing.leaseExpiresAt && existing.leaseExpiresAt > now) return { kind: "busy" };
    const leaseToken = crypto.randomUUID();
    const updated = await prisma.pendingReportSnapshot.updateMany({
      where: existing.state === "ready"
        ? { id, state: "ready" }
        : { id, state: { in: ["sending", "unknown"] }, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }] },
      data: {
        state: "sending", leaseToken, leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
        attemptedAt: now, attemptCount: { increment: 1 },
      },
    });
    if (!updated.count) return { kind: "busy" };
    const claimed = await this.find(id);
    if (!claimed) throw new Error("Claimed pending report snapshot disappeared");
    return { kind: "claimed", snapshot: claimed };
  },
  async markAccepted(id, leaseToken, providerId, acceptedAt) {
    const updated = await prisma.pendingReportSnapshot.updateMany({
      where: { id, state: "sending", leaseToken },
      data: {
        state: "accepted", providerId, providerAcceptedAt: acceptedAt,
        leaseToken: null, leaseExpiresAt: null,
      },
    });
    if (!updated.count) throw new Error("Could not durably record provider acceptance");
    const snapshot = await this.find(id);
    if (!snapshot) throw new Error("Accepted pending report snapshot disappeared");
    return snapshot;
  },
  async markUnknown(id, leaseToken, now) {
    await prisma.pendingReportSnapshot.updateMany({
      where: { id, state: "sending", leaseToken },
      data: { state: "unknown", leaseToken: null, leaseExpiresAt: now },
    });
  },
  async release(id, leaseToken) {
    await prisma.pendingReportSnapshot.updateMany({
      where: { id, state: "sending", leaseToken },
      data: { state: "ready", leaseToken: null, leaseExpiresAt: null },
    });
  },
  async markAuditResult(id, auditRecorded) {
    await prisma.pendingReportSnapshot.updateMany({
      where: { id, state: "accepted" },
      data: { auditRecorded },
    });
  },
};

export class InMemoryPendingReportSnapshotStore implements PendingReportSnapshotStore {
  private readonly rows = new Map<string, StoredSnapshot>();

  async create(snapshot: StoredSnapshot) { this.rows.set(snapshot.id, structuredClone(snapshot)); }
  async find(id: string) { return this.rows.has(id) ? structuredClone(this.rows.get(id)!) : null; }
  async claim(id: string, now: Date): Promise<SnapshotClaim> {
    const existing = this.rows.get(id);
    if (!existing) return { kind: "expired" };
    if (existing.state === "accepted") return { kind: "accepted", snapshot: structuredClone(existing) };
    if (existing.state === "ready" && existing.expiresAt <= now) return { kind: "expired" };
    if (snapshotProvider(existing) === "gmail" &&
        (existing.state === "sending" || existing.state === "unknown")) return { kind: "unsafe" };
    if (existing.idempotencyExpiresAt <= now) return { kind: "unsafe" };
    if (existing.state === "sending" && existing.leaseExpiresAt && existing.leaseExpiresAt > now) return { kind: "busy" };
    existing.state = "sending";
    existing.leaseToken = crypto.randomUUID();
    existing.leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
    existing.attemptedAt = now;
    existing.attemptCount++;
    return { kind: "claimed", snapshot: structuredClone(existing) };
  }
  async markAccepted(id: string, leaseToken: string, providerId: string, acceptedAt: Date) {
    const snapshot = this.rows.get(id);
    if (!snapshot || snapshot.state !== "sending" || snapshot.leaseToken !== leaseToken) throw new Error("Could not durably record provider acceptance");
    snapshot.state = "accepted"; snapshot.providerId = providerId; snapshot.providerAcceptedAt = acceptedAt;
    snapshot.leaseToken = null; snapshot.leaseExpiresAt = null;
    return structuredClone(snapshot);
  }
  async markUnknown(id: string, leaseToken: string, now: Date) {
    const snapshot = this.rows.get(id);
    if (snapshot?.state === "sending" && snapshot.leaseToken === leaseToken) {
      snapshot.state = "unknown"; snapshot.leaseToken = null; snapshot.leaseExpiresAt = now;
    }
  }
  async release(id: string, leaseToken: string) {
    const snapshot = this.rows.get(id);
    if (snapshot?.state === "sending" && snapshot.leaseToken === leaseToken) {
      snapshot.state = "ready"; snapshot.leaseToken = null; snapshot.leaseExpiresAt = null;
    }
  }
  async markAuditResult(id: string, auditRecorded: boolean) {
    const snapshot = this.rows.get(id);
    if (snapshot?.state === "accepted") snapshot.auditRecorded = auditRecorded;
  }
}

function providerOutcomeIsUnknown(error: unknown) {
  return error instanceof PendingReportError &&
    (error.status === 504 || /Could not contact|invalid response without a message ID/.test(error.message));
}

export class PendingReportService {
  private readonly inFlight = new Map<string, ReturnType<PendingReportService["sendClaimedSnapshot"]>>();

  constructor(
    private readonly dataSource: PendingReportDataSource = prismaDataSource,
    private readonly auditWriter: PendingReportAuditWriter = prismaAuditWriter,
    private readonly getDelivery: (
      mode?: "demonstration" | "live",
      provider?: PendingReportProviderKind,
      senderEmail?: string | null,
      senderName?: string | null,
    ) => PendingReportDelivery = deliveryConfiguration,
    private readonly now = () => new Date(),
    private readonly store: PendingReportSnapshotStore = prismaSnapshotStore,
  ) {}

  async createPreview(userId: string, userEmail = "", requestInput: unknown = undefined): Promise<PendingReportPreview> {
    const delivery = this.getDelivery();
    const deliveryProvider = deliveryProviderKind(delivery);
    const senderEmail = delivery.senderEmail === undefined ? null : delivery.senderEmail;
    const senderName = delivery.senderName === undefined ? null : delivery.senderName;
    const now = this.now();
    const request = normalizePendingPreviewRequest(requestInput);
    const selectedIds = request.universityIds.length ? request.universityIds : undefined;
    const universities = await this.dataSource.activeUniversities(selectedIds);
    if (selectedIds) {
      const activeIds = new Set(universities.map(university => university.id));
      if (selectedIds.some(id => !activeIds.has(id))) {
        throw new PendingReportError(400, "One or more selected universities are missing, deleted, or inactive.");
      }
    }
    const dataset = buildPendingDataset(universities, now, {
      recipients: request.recipients,
      universityIds: selectedIds,
      sections: request.sections,
      priority: request.priority,
    });
    const id = crypto.randomUUID();
    const expiresAt = new Date(now.getTime() + SNAPSHOT_TTL_MS);
    const snapshot: StoredSnapshot = {
      id, createdByUserId: userId, createdByEmail: userEmail, snapshotVersion: PENDING_REPORT_SNAPSHOT_VERSION,
      deliveryMode: delivery.mode, deliveryProvider, senderEmail, senderName, dataset, expiresAt,
      filename: `pending-work-report-${now.toISOString().slice(0, 10)}.csv`,
      snapshotHash: "",
       idempotencyKey: `pending-report-v${PENDING_REPORT_SNAPSHOT_VERSION}-${id}`,
      idempotencyExpiresAt: new Date(now.getTime() + PROVIDER_IDEMPOTENCY_WINDOW_MS),
      state: "ready", leaseToken: null, leaseExpiresAt: null, attemptedAt: null,
      attemptCount: 0, providerId: null, providerAcceptedAt: null, auditRecorded: null,
    };
    snapshot.snapshotHash = snapshotPayloadHash(snapshot);
    await this.store.create(snapshot);
    return previewFromSnapshot(snapshot);
  }

  async confirm(input: { previewId: string; userId: string; userEmail: string; confirmed: boolean }) {
    if (input.confirmed !== true) throw new PendingReportError(400, "Set confirmed to true after reviewing the pending report preview.");
    const original = await this.store.find(input.previewId);
    if (!original || original.createdByUserId !== input.userId) {
      if (!original) throw new PendingReportError(410, "This pending report preview is unavailable. Generate and review a new preview before sending.");
      throw new PendingReportError(403, "This preview belongs to a different administrator. Generate your own preview.");
    }
    // Every accepted row is a receipt, even when its detailed dataset has
    // been compacted or it predates transport metadata. Replaying a receipt
    // must never re-render or resubmit provider content.
    if (original.state === "accepted") {
      return this.acceptedResponse(original);
    }
    assertSupportedImmutableSnapshot(original);
    const claim = await this.store.claim(input.previewId, this.now());
    if (claim.kind === "accepted") return this.acceptedResponse(claim.snapshot);
    if (claim.kind === "busy") {
      const localAttempt = this.inFlight.get(input.previewId);
      if (localAttempt) return localAttempt;
      throw new PendingReportError(409, "This report is already being submitted. Retry the same confirmation shortly; do not create a new preview.");
    }
    if (claim.kind === "expired") throw new PendingReportError(410, "This pending report preview has expired. Generate and review a new preview before sending.");
    if (claim.kind === "unsafe") {
      if (snapshotProvider(original) === "gmail") {
        throw new PendingReportError(
          409,
          "This Gmail send has an unknown or in-flight outcome. Do not resend it or create a replacement preview; an operator must reconcile the connected Gmail account.",
        );
      }
      throw new PendingReportError(409, "This prior send has an unknown provider outcome beyond the idempotency window. Do not resend; an operator must check Resend using the saved report ID.");
    }
    try {
      assertSupportedImmutableSnapshot(claim.snapshot);
    } catch (error) {
      // A row cannot normally change after the pre-claim integrity check, but
      // avoid leaving a lease behind if manual/database corruption races it.
      await this.store.release(claim.snapshot.id, claim.snapshot.leaseToken!);
      throw error;
    }
    const attempt = this.sendClaimedSnapshot(claim.snapshot, input);
    this.inFlight.set(input.previewId, attempt);
    try {
      return await attempt;
    } finally {
      this.inFlight.delete(input.previewId);
    }
  }

  private acceptedResponse(snapshot: StoredSnapshot) {
    const provider = snapshotProvider(snapshot);
    return {
      accepted: true, providerId: snapshot.providerId!, recipients: snapshot.dataset.recipients,
      message: provider === "gmail"
        ? "Gmail accepted the report request. Inbox delivery is not confirmed."
        : "Provider accepted the report request. Inbox delivery is not confirmed.",
      deliveryMode: snapshot.deliveryMode, deliveryProvider: provider,
      senderEmail: snapshot.senderEmail || null, auditRecorded: snapshot.auditRecorded === true,
    };
  }

  private async sendClaimedSnapshot(snapshot: StoredSnapshot, input: { previewId: string; userId: string; userEmail: string }) {
    let providerStarted = false;
    try {
      const expectedProvider = snapshotProvider(snapshot);
      const delivery = this.getDelivery(
        snapshot.deliveryMode,
        expectedProvider || undefined,
        snapshot.senderEmail,
        snapshot.senderName,
      );
      const configuredProvider = deliveryProviderKind(delivery);
      const configuredSender = normalizedSenderEmail(delivery.senderEmail);
      if (expectedProvider && configuredProvider !== expectedProvider) {
        throw new PendingReportError(
          409,
          `This report was reviewed for ${expectedProvider}, but pending reports are now configured for ${configuredProvider}. Do not resend it; generate a new preview.`,
        );
      }
      if (snapshot.senderEmail && configuredSender !== normalizedSenderEmail(snapshot.senderEmail)) {
        throw new PendingReportError(
          409,
          "The pending report sender changed after preview creation. Do not resend it; generate a new preview.",
        );
      }
      if (snapshot.senderName && delivery.senderName !== snapshot.senderName) {
        throw new PendingReportError(
          409,
          "The pending report sender name changed after preview creation. Do not resend it; generate a new preview.",
        );
      }
      providerStarted = true;
      const providerResult = await delivery.provider.send(messageFromSnapshot(snapshot));
      // The durable accepted outcome is committed before audit work. If this
      // write fails, the existing sending record recovers only with the same
      // idempotency key while the provider's deduplication window remains open.
      const accepted = await this.store.markAccepted(snapshot.id, snapshot.leaseToken!, providerResult.id, this.now());
      let auditRecorded = true;
      try {
        await this.auditWriter.recordAccepted({
          userId: input.userId, userEmail: input.userEmail, previewId: input.previewId,
          providerId: providerResult.id, recipients: accepted.dataset.recipients,
          generatedAt: accepted.dataset.generatedAt, deliveryMode: accepted.deliveryMode,
          scope: accepted.dataset.scope,
        });
      } catch (error) {
        auditRecorded = false;
        logger.error({ err: error, previewId: input.previewId, providerId: providerResult.id },
          "Pending report provider accepted, but audit recording failed");
      }
      try {
        await this.store.markAuditResult(snapshot.id, auditRecorded);
      } catch (error) {
        logger.error({ err: error, previewId: input.previewId },
          "Pending report acceptance was durable, but audit-result status could not be stored");
      }
      accepted.auditRecorded = auditRecorded;
      return this.acceptedResponse(accepted);
    } catch (error) {
      // Once an attempt was previously unknown, or a provider call was begun,
      // retaining unknown is safer than resetting ready: the provider may have
      // accepted it despite an absent/failed response or persistence failure.
      const gmailOutcomeUnknown = error instanceof GmailPendingReportError &&
        error.providerOutcome === "unknown";
      const shouldRetainUnknown = snapshotProvider(snapshot) === "gmail"
        ? gmailOutcomeUnknown || providerOutcomeIsUnknown(error) ||
          (!(error instanceof PendingReportError) && !(error instanceof GmailPendingReportError)) ||
          snapshot.state === "unknown"
        : providerStarted || snapshot.state === "unknown" || providerOutcomeIsUnknown(error);
      if (shouldRetainUnknown) {
        await this.store.markUnknown(snapshot.id, snapshot.leaseToken!, this.now());
      } else {
        await this.store.release(snapshot.id, snapshot.leaseToken!);
      }
      throw error;
    }
  }
}

export const pendingReportService = new PendingReportService();