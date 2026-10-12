import OpenAI from "openai";
import prisma from "./prisma";

const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});

export interface ReportData {
  generatedAt: string;
  totalUniversities: number;
  allocated: number;
  notAllocated: number;
  notAllocatedList: string[];
  overallReadiness: number;
  readinessBelow30: { name: string; readiness: number }[];
  timelineSummary: {
    onTrack: number;
    delayed: number;
    missing: number;
    completed: number;
  };
  delayedUniversities: { name: string; targetDate: string; daysOverdue: number }[];
  missingTimelineUniversities: string[];
  spaceReadiness: {
    modelClassroom: number;
    lab5: number;
    staffRoom: number;
    allClassrooms: number;
  };
  zoneBreakdown: { zone: string; count: number; avgReadiness: number }[];
  pendingActionItems: number;
}

export async function gatherReportData(): Promise<ReportData> {
  const universities = await prisma.university.findMany({
    include: {
      spaces: {
        include: {
          checklistStatuses: true,
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const now = new Date();

  const notAllocatedList: string[] = [];
  let allocated = 0;

  let totalModelReadiness = 0;
  let totalLabReadiness = 0;
  let totalStaffReadiness = 0;
  let totalClassroomReadiness = 0;
  let totalOverall = 0;

  let onTrack = 0;
  let delayed = 0;
  let missing = 0;
  let completed = 0;

  const delayedUniversities: { name: string; targetDate: string; daysOverdue: number }[] = [];
  const missingTimelineUniversities: string[] = [];
  const readinessBelow30: { name: string; readiness: number }[] = [];
  const zoneMap: Record<string, { count: number; totalReadiness: number }> = {};

  for (const uni of universities) {
    if (!uni.apmName || uni.apmName.trim() === "") {
      notAllocatedList.push(uni.name);
    } else {
      allocated++;
    }

    const spaceReadiness = (spaceType: string): number => {
      const space = uni.spaces.find(s => s.spaceType === spaceType);
      if (!space || space.checklistStatuses.length === 0) return 0;
      const done = space.checklistStatuses.filter(s => s.currentStatus === "Done" || s.currentStatus === "N/A").length;
      return Math.round((done / space.checklistStatuses.length) * 100);
    };

    const modelR = spaceReadiness("model_classroom");
    const labR = spaceReadiness("lab");
    const staffR = spaceReadiness("staff_room");
    const classroomR = spaceReadiness("overall_classroom");

    totalModelReadiness += modelR;
    totalLabReadiness += labR;
    totalStaffReadiness += staffR;
    totalClassroomReadiness += classroomR;

    const spaces = [modelR, labR, staffR, classroomR].filter(v => v > 0);
    const uniReadiness = spaces.length > 0 ? Math.round(spaces.reduce((a, b) => a + b, 0) / spaces.length) : 0;
    totalOverall += uniReadiness;

    if (uniReadiness < 30 && uniReadiness > 0) {
      readinessBelow30.push({ name: uni.name, readiness: uniReadiness });
    }

    const targetDate = uni.targetDate ? new Date(uni.targetDate) : null;
    if (!targetDate) {
      missing++;
      missingTimelineUniversities.push(uni.name);
    } else {
      const daysOverdue = Math.floor((now.getTime() - targetDate.getTime()) / (1000 * 60 * 60 * 24));
      if (uniReadiness >= 100) {
        completed++;
      } else if (daysOverdue > 0) {
        delayed++;
        delayedUniversities.push({
          name: uni.name,
          targetDate: targetDate.toISOString().split("T")[0],
          daysOverdue,
        });
      } else {
        onTrack++;
      }
    }

    const zone = String(uni.zoneId || "Unassigned");
    if (!zoneMap[zone]) zoneMap[zone] = { count: 0, totalReadiness: 0 };
    zoneMap[zone].count++;
    zoneMap[zone].totalReadiness += uniReadiness;
  }

  const total = universities.length;
  const zoneBreakdown = Object.entries(zoneMap).map(([zone, data]) => ({
    zone: `Zone ${zone}`,
    count: data.count,
    avgReadiness: Math.round(data.totalReadiness / data.count),
  }));

  delayedUniversities.sort((a, b) => b.daysOverdue - a.daysOverdue);

  const actionItemCount = await prisma.actionItem.count({
    where: { status: { not: "done" } },
  });

  return {
    generatedAt: now.toISOString(),
    totalUniversities: total,
    allocated,
    notAllocated: notAllocatedList.length,
    notAllocatedList,
    overallReadiness: total > 0 ? Math.round(totalOverall / total) : 0,
    readinessBelow30,
    timelineSummary: { onTrack, delayed, missing, completed },
    delayedUniversities,
    missingTimelineUniversities,
    spaceReadiness: {
      modelClassroom: total > 0 ? Math.round(totalModelReadiness / total) : 0,
      lab5: total > 0 ? Math.round(totalLabReadiness / total) : 0,
      staffRoom: total > 0 ? Math.round(totalStaffReadiness / total) : 0,
      allClassrooms: total > 0 ? Math.round(totalClassroomReadiness / total) : 0,
    },
    zoneBreakdown,
    pendingActionItems: actionItemCount,
  };
}

export async function generateAiInsights(data: ReportData): Promise<string> {
  const prompt = `You are an operations analyst for NIAT (NxtWave Institute of Advanced Technologies).
Analyze this infrastructure readiness tracker data and write a concise, professional executive summary.

Data snapshot (as of ${new Date(data.generatedAt).toDateString()}):
- Total universities: ${data.totalUniversities}
- Allocated (APM assigned): ${data.allocated} | Not allocated: ${data.notAllocated}
- Not allocated universities: ${data.notAllocatedList.join(", ") || "None"}
- Overall avg readiness: ${data.overallReadiness}%
- Space readiness — Model Classroom: ${data.spaceReadiness.modelClassroom}%, 5.0 Lab: ${data.spaceReadiness.lab5}%, Staff Room: ${data.spaceReadiness.staffRoom}%, All Classrooms: ${data.spaceReadiness.allClassrooms}%
- Timeline status — On Track: ${data.timelineSummary.onTrack}, Delayed: ${data.timelineSummary.delayed}, Missing: ${data.timelineSummary.missing}, Completed: ${data.timelineSummary.completed}
- Delayed universities: ${data.delayedUniversities.map(u => `${u.name} (${u.daysOverdue}d overdue)`).join(", ") || "None"}
- Universities with readiness < 30%: ${data.readinessBelow30.map(u => `${u.name} (${u.readiness}%)`).join(", ") || "None"}
- Pending action items across all universities: ${data.pendingActionItems}
- Missing timelines: ${data.missingTimelineUniversities.join(", ") || "None"}

Write 4–6 bullet points covering:
1. Overall health assessment
2. Critical risks or blockers needing immediate attention
3. Universities requiring urgent follow-up
4. Positive highlights (if any)
5. Recommended next actions

Be direct and specific. Use plain text bullet points starting with •. No headers or markdown.`;

  const response = await openai.chat.completions.create({
    model: "gpt-5-mini",
    max_completion_tokens: 600,
    messages: [{ role: "user", content: prompt }],
  });

  return response.choices[0]?.message?.content ?? "AI insights unavailable.";
}
