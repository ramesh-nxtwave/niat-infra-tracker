export const MAX_ASSISTANT_SOURCE_RECORDS = 100;

export type GroundedRecord = {
  id: string;
  universityId: string;
  university: string;
  area: string;
  category: string;
  lineItem: string;
  status: string;
  timeline: string | null;
  remarks: string | null;
  updatedAt: string;
};

type ScopeUniversity = {
  id: string;
  name: string;
  zoneId: number | null;
};

const GENERIC_UNIVERSITY_WORDS = new Set(["university", "college", "institute", "campus", "school"]);

function namedUniversities<T extends ScopeUniversity>(universities: T[], text: string) {
  const normalized = text.toLowerCase();
  return universities.filter(university => {
    const name = university.name.toLowerCase();
    return normalized.includes(name) ||
      name.split(/[^a-z0-9]+/)
        .filter(part => part.length >= 3 && !GENERIC_UNIVERSITY_WORDS.has(part))
        .some(part => normalized.includes(part));
  });
}

function mentionedZones(text: string) {
  const zones = new Set<number>();
  for (const match of text.matchAll(/\bzone\s*(\d+)\b/gi)) {
    zones.add(Number(match[1]));
  }
  return zones;
}

export function resolveScopedUniversities<T extends ScopeUniversity>(
  universities: T[],
  currentQuestion: string,
  conversationQuestions: string[],
): T[] {
  const resolveExplicitScope = (text: string): T[] | null => {
    const zones = mentionedZones(text);
    if (zones.size > 0) {
      return universities.filter(university => university.zoneId !== null && zones.has(university.zoneId));
    }
    if (
      /\b(?:all|every)\s+(?:authorized\s+)?universit(?:y|ies)\b/i.test(text) ||
      /\b(?:how many|which|list(?:\s+the)?)\s+(?:authorized\s+)?universit(?:y|ies)\b/i.test(text)
    ) {
      return universities;
    }
    const named = namedUniversities(universities, text);
    return named.length > 0 ? named : null;
  };

  const currentScope = resolveExplicitScope(currentQuestion);
  if (currentScope !== null) return currentScope;

  for (const historicalQuestion of [...conversationQuestions].reverse()) {
    const historicalScope = resolveExplicitScope(historicalQuestion);
    if (historicalScope !== null) return historicalScope;
  }

  return universities.slice(0, 30);
}

export function collectAuthorizationUniversityIds(
  contextRecords: GroundedRecord[],
  reusedAnswerDependencies: string[],
) {
  return [...new Set([
    ...contextRecords.map(record => record.universityId),
    ...reusedAnswerDependencies,
  ])];
}

export function isAuthorizationProvenanceAllowed(
  authorizationComplete: boolean,
  authorizationUniversityIds: string[],
  allowedUniversityIds: Set<string> | null,
) {
  if (!authorizationComplete) return false;
  return allowedUniversityIds === null ||
    authorizationUniversityIds.every(universityId => allowedUniversityIds.has(universityId));
}

export function selectContextRecords(records: GroundedRecord[], searchText: string) {
  const availabilityItems = resolveAvailabilityItems(searchText);
  const isStatusAvailabilityQuestion = availabilityItems !== null &&
    /\b(?:have|has|without|missing|available|availability|working|installed)\b/i.test(searchText);
  const candidateRecords = isStatusAvailabilityQuestion
    ? records.filter(record =>
        !record.id.startsWith("update-") &&
        !record.id.startsWith("action-") &&
        !record.id.startsWith("university-") &&
        availabilityItems.includes(record.lineItem.trim().toLowerCase()),
      )
    : records;
  if (isStatusAvailabilityQuestion) {
    return candidateRecords.slice(0, MAX_ASSISTANT_SOURCE_RECORDS);
  }
  const keywords = searchText.toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length >= 3);
  const ranked = candidateRecords
    .map(record => {
      const searchable = `${record.university} ${record.area} ${record.category} ${record.lineItem} ${record.status} ${record.remarks || ""}`.toLowerCase();
      return {
        record,
        score: keywords.reduce((score, word) => score + (searchable.includes(word) ? 1 : 0), 0),
      };
    })
    .sort((a, b) => b.score - a.score);

  return (ranked.some(item => item.score > 0)
    ? ranked.filter(item => item.score > 0)
    : ranked
  ).slice(0, MAX_ASSISTANT_SOURCE_RECORDS).map(item => item.record);
}

function resolveAvailabilityItems(text: string): string[] | null {
  if (/\btv\b/i.test(text)) return ["tv - working"];
  if (/\bups\b/i.test(text)) return ["ups power connection"];
  return null;
}

export function answerEquipmentAvailabilityQuestion(records: GroundedRecord[], question: string) {
  const availabilityItems = resolveAvailabilityItems(question);
  const equipmentName = /\bups\b/i.test(question) ? "UPS" : "TV";
  const asksWhichUniversitiesLackEquipment = availabilityItems !== null &&
    /\b(?:universit(?:y|ies)|campuses)\b/i.test(question) &&
    /(?:don't\s+have|do\s+not\s+have|without|lack(?:ing|s)?|missing)/i.test(question);
  if (!asksWhichUniversitiesLackEquipment) return null;

  const equipmentRecords = records.filter(record =>
    availabilityItems.includes(record.lineItem.trim().toLowerCase()),
  );
  const byUniversity = new Map<string, GroundedRecord[]>();
  for (const record of equipmentRecords) {
    const existing = byUniversity.get(record.universityId) || [];
    existing.push(record);
    byUniversity.set(record.universityId, existing);
  }

  const completionStatuses = new Set(["done", "completed"]);
  const notApplicableStatuses = new Set(["n/a", "not applicable"]);
  const lacking = [...byUniversity.values()].filter(universityRecords => {
    const statuses = universityRecords.map(record => record.status.trim().toLowerCase());
    return !statuses.some(status => completionStatuses.has(status)) &&
      statuses.some(status => !notApplicableStatuses.has(status));
  });
  const names = lacking.map(universityRecords => universityRecords[0].university).sort();
  const sourceRecords = lacking
    .map(universityRecords => {
      const representative = [...universityRecords]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      const statuses = [...new Set(universityRecords.map(record => record.status))].sort();
      return {
        ...representative,
        id: `availability-${equipmentName.toLowerCase()}-${representative.universityId}`,
        area: "University-wide",
        category: `${equipmentName} availability`,
        lineItem: equipmentName === "UPS" ? "UPS Power Connection" : "TV - Working",
        status: statuses.join(" / "),
        timeline: null,
        remarks: null,
      };
    })
    .sort((a, b) => a.university.localeCompare(b.university));
  const answer = names.length
    ? `Based only on current checklist statuses, ${names.length} ${names.length === 1 ? "university does" : "universities do"} not yet have confirmed ${equipmentName} availability: ${names.join(", ")}. Remarks were not used for this result.`
    : `Based only on current checklist statuses, no universities are currently marked as lacking confirmed ${equipmentName} availability. Remarks were not used for this result.`;

  return {
    answer,
    sourceRecords,
    recordIds: sourceRecords.map(record => record.id),
  };
}

export function isGroundedRecord(record: unknown): record is GroundedRecord {
  return Boolean(record && typeof record === "object" && "universityId" in record);
}