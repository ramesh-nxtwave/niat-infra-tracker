import { Router } from "express";
import OpenAI from "openai";
import prisma from "../lib/prisma";
import { requireAuth, type AuthRequest } from "../lib/auth";
import {
  collectAuthorizationUniversityIds,
  answerEquipmentAvailabilityQuestion,
  isGroundedRecord,
  isAuthorizationProvenanceAllowed,
  MAX_ASSISTANT_SOURCE_RECORDS,
  resolveScopedUniversities,
  selectContextRecords,
  type GroundedRecord,
} from "../lib/assistantSupport";

const router = Router();
const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});

type VisibilityUser = {
  role: string;
  zoneIds: number[];
  universityIds: string[];
};

function visibilityFilter(user: VisibilityUser) {
  if (user.role === "admin") return {};
  if (user.role === "zonal_manager") {
    return user.zoneIds?.length ? { zoneId: { in: user.zoneIds } } : { id: "__NONE__" };
  }
  if (user.role === "apm") {
    return user.universityIds?.length ? { id: { in: user.universityIds } } : { id: "__NONE__" };
  }
  return { id: "__NONE__" };
}

async function loadAccessUser(userId: string) {
  return prisma.user.findFirst({
    where: { id: userId, isActive: true, isDeleted: false },
    select: { role: true, zoneIds: true, universityIds: true },
  });
}

async function loadAllowedUniversityIds(user: VisibilityUser) {
  if (user.role === "admin") return null;
  const universities = await prisma.university.findMany({
    where: { ...visibilityFilter(user), isDeleted: false },
    select: { id: true },
  });
  return new Set(universities.map(university => university.id));
}

function serializeConversation(conversation: {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messages?: Array<{
    id: string;
    role: string;
    content: string;
    records: unknown;
    authorizationUniversityIds: string[];
    authorizationComplete: boolean;
    createdAt: Date;
  }>;
}, allowedUniversityIds: Set<string> | null = null) {
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
    ...(conversation.messages ? {
      messages: conversation.messages.map(message => {
        const storedRecords = Array.isArray(message.records) ? message.records : [];
        const records = allowedUniversityIds === null
          ? storedRecords
          : storedRecords.filter(record => isGroundedRecord(record) && allowedUniversityIds.has(record.universityId));
        const accessChanged = message.role === "assistant" && (
          !isAuthorizationProvenanceAllowed(
            message.authorizationComplete,
            message.authorizationUniversityIds,
            allowedUniversityIds,
          ) ||
          records.length !== storedRecords.length
        );
        return {
          id: message.id,
          role: message.role,
          content: accessChanged
            ? "This earlier answer is no longer available because your university access has changed. Ask the question again to get a current, authorized answer."
            : message.content,
          records,
          createdAt: message.createdAt.toISOString(),
        };
      }),
    } : {}),
  };
}

router.get("/assistant/conversations", requireAuth, async (req: AuthRequest, res) => {
  const accessUser = await loadAccessUser(req.user!.userId);
  if (!accessUser) {
    res.status(403).json({ error: "Your account no longer has access to the assistant." });
    return;
  }
  const conversations = await prisma.assistantConversation.findMany({
    where: { userId: req.user!.userId },
    orderBy: { updatedAt: "desc" },
    take: 30,
  });
  res.json({ conversations: conversations.map(conversation => serializeConversation(conversation)) });
});

router.post("/assistant/conversations", requireAuth, async (req: AuthRequest, res) => {
  const accessUser = await loadAccessUser(req.user!.userId);
  if (!accessUser) {
    res.status(403).json({ error: "Your account no longer has access to the assistant." });
    return;
  }
  const conversation = await prisma.assistantConversation.create({
    data: { userId: req.user!.userId, title: "New conversation" },
  });
  res.status(201).json({ conversation: serializeConversation({ ...conversation, messages: [] }) });
});

router.get("/assistant/conversations/:id", requireAuth, async (req: AuthRequest, res) => {
  const accessUser = await loadAccessUser(req.user!.userId);
  if (!accessUser) {
    res.status(403).json({ error: "Your account no longer has access to the assistant." });
    return;
  }
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const conversation = await prisma.assistantConversation.findFirst({
    where: { id, userId: req.user!.userId },
    include: { messages: { orderBy: { sequence: "asc" } } },
  });
  if (!conversation) {
    res.status(404).json({ error: "Conversation not found." });
    return;
  }
  const allowedUniversityIds = await loadAllowedUniversityIds(accessUser);
  res.json({ conversation: serializeConversation(conversation, allowedUniversityIds) });
});

router.post("/assistant/query", requireAuth, async (req: AuthRequest, res) => {
  const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
  const conversationId = typeof req.body?.conversationId === "string" ? req.body.conversationId : null;
  if (question.length < 3 || question.length > 1000) {
    res.status(400).json({ error: "Ask a question between 3 and 1,000 characters." });
    return;
  }

  try {
    const accessUser = await loadAccessUser(req.user!.userId);
    if (!accessUser) {
      res.status(403).json({ error: "Your account no longer has access to the assistant." });
      return;
    }
    const existingConversation = conversationId
      ? await prisma.assistantConversation.findFirst({
          where: { id: conversationId, userId: req.user!.userId },
          include: { messages: { orderBy: { sequence: "desc" }, take: 20 } },
        })
      : null;
    if (conversationId && !existingConversation) {
      res.status(404).json({ error: "Conversation not found." });
      return;
    }
    const history = [...(existingConversation?.messages ?? [])].reverse();

    const universities = await prisma.university.findMany({
      where: { ...visibilityFilter(accessUser), isDeleted: false },
      select: {
        id: true,
        name: true,
        zoneId: true,
        apmName: true,
        targetDate: true,
        internalTimeline: true,
        riskStatus: true,
        overallReadiness: true,
        updatedAt: true,
        updates: { orderBy: { createdAt: "desc" }, take: 20 },
        actionItems: { orderBy: { updatedAt: "desc" }, take: 30 },
      },
      orderBy: { name: "asc" },
    });
    const allowedUniversityIds = accessUser.role === "admin"
      ? null
      : new Set(universities.map(university => university.id));
    const reusableAnswerDependencies: string[] = [];
    const conversationQuestions: string[] = [];
    const conversationContext = history.flatMap(message => {
      if (message.role === "user") {
        conversationQuestions.push(message.content);
        return [`Manager: ${message.content}`];
      }
      if (message.role !== "assistant") return [];
      const remainsAuthorized = isAuthorizationProvenanceAllowed(
        message.authorizationComplete,
        message.authorizationUniversityIds,
        allowedUniversityIds,
      );
      if (!remainsAuthorized) return [];
      reusableAnswerDependencies.push(...message.authorizationUniversityIds);
      return [`Assistant: ${message.content}`];
    }).join("\n");
    const searchText = `${conversationContext}\n${question}`;
    const scopedUniversities = resolveScopedUniversities(universities, question, conversationQuestions);
    const ids = scopedUniversities.map(university => university.id);

    const statuses = ids.length ? await prisma.spaceChecklistStatus.findMany({
      where: { universityId: { in: ids }, space: { isDeleted: false } },
      include: {
        university: { select: { name: true } },
        space: { select: { name: true, spaceType: true } },
        checklistItem: { select: { category: true, name: true, module: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 1500,
    }) : [];

    const checklistRecords: GroundedRecord[] = statuses.map(status => ({
      id: status.id,
      universityId: status.universityId,
      university: status.university.name,
      area: status.space.name || status.space.spaceType,
      category: status.checklistItem.category,
      lineItem: status.checklistItem.name,
      status: status.currentStatus,
      timeline: status.universityTimeline,
      remarks: status.remarks,
      updatedAt: status.updatedAt.toISOString(),
    }));
    const overviewRecords: GroundedRecord[] = scopedUniversities.flatMap(university => [
      {
        id: `university-${university.id}`,
        universityId: university.id,
        university: university.name,
        area: "University",
        category: "University overview",
        lineItem: `Zone ${university.zoneId ?? "unassigned"}; APM ${university.apmName || "unassigned"}; readiness ${university.overallReadiness}%`,
        status: university.riskStatus,
        timeline: university.targetDate || university.internalTimeline,
        remarks: null,
        updatedAt: university.updatedAt.toISOString(),
      },
      ...university.updates.map(update => ({
        id: `update-${update.id}`,
        universityId: university.id,
        university: university.name,
        area: "Daily updates",
        category: update.tags.join(", ") || "Update",
        lineItem: "University update",
        status: "Update",
        timeline: null,
        remarks: update.content,
        updatedAt: update.createdAt.toISOString(),
      })),
      ...university.actionItems.map(action => ({
        id: `action-${action.id}`,
        universityId: university.id,
        university: university.name,
        area: "Action items",
        category: "Action item",
        lineItem: action.content,
        status: action.status,
        timeline: action.dueDate,
        remarks: `Owner: ${action.authorName}`,
        updatedAt: action.updatedAt.toISOString(),
      })),
    ]);
    const availableRecords = [...checklistRecords, ...overviewRecords];
    const deterministicStatusAnswer = answerEquipmentAvailabilityQuestion(availableRecords, question);
    const contextRecords = deterministicStatusAnswer
      ? deterministicStatusAnswer.sourceRecords.slice(0, MAX_ASSISTANT_SOURCE_RECORDS)
      : selectContextRecords(availableRecords, searchText);
    const authorizationUniversityIds = collectAuthorizationUniversityIds(
      contextRecords,
      [
        ...reusableAnswerDependencies,
        ...(deterministicStatusAnswer ? scopedUniversities.map(university => university.id) : []),
      ],
    );

    const completion = deterministicStatusAnswer ? null : await openai.chat.completions.create({
      model: "gpt-5.4-mini",
      max_completion_tokens: 1800,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are the NIAT InfraTracker data assistant. Answer only from the supplied records for this turn.
Never invent a date, status, university, or remark. The authoritative timeline is the record's timeline field.
For questions about whether an item exists, is installed, is working, or is complete, the record's current status is authoritative. Remarks may explain a status but must never override it or independently prove availability/completion.
If the requested data is absent, clearly say it is not available. Be concise and manager-friendly.
Conversation history is provided only to understand references and follow-up intent. Do not treat facts in prior answers as authoritative; revalidate every claim against the current accessible records.
Return JSON exactly as {"answer":"...", "recordIds":["..."]}. Every answer must cite at least one supplied record ID, and only IDs that directly support the answer.`,
        },
        {
          role: "user",
          content: `Conversation so far:\n${conversationContext || "(new conversation)"}\n\nCurrent question: ${question}\n\nCurrently accessible checklist records:\n${JSON.stringify(contextRecords)}`,
        },
      ],
    });

    let parsed: { answer?: string; recordIds?: string[] } = deterministicStatusAnswer || {};
    if (completion) {
      try {
        parsed = JSON.parse(completion.choices[0]?.message?.content || "{}");
      } catch {
        parsed = {};
      }
    }
    const citedIds = new Set(Array.isArray(parsed.recordIds) ? parsed.recordIds : []);
    const citedRecords = contextRecords.filter(record => citedIds.has(record.id)).slice(0, MAX_ASSISTANT_SOURCE_RECORDS);
    const isGroundedAnswer = typeof parsed.answer === "string" &&
      parsed.answer.trim().length > 0 &&
      (deterministicStatusAnswer !== null || citedRecords.length > 0);
    const answer = isGroundedAnswer
      ? parsed.answer!
      : "I could not produce an answer with verifiable supporting records from the data you can currently access.";
    const records = isGroundedAnswer ? citedRecords : [];
    const conversation = await prisma.$transaction(async tx => {
      const title = question.length > 72 ? `${question.slice(0, 69)}...` : question;
      let current;
      if (existingConversation) {
        const updated = await tx.assistantConversation.updateMany({
          where: {
            id: existingConversation.id,
            userId: req.user!.userId,
            revision: existingConversation.revision,
          },
          data: {
            revision: { increment: 1 },
            updatedAt: new Date(),
            ...(existingConversation.title === "New conversation" ? { title } : {}),
          },
        });
        if (updated.count !== 1) {
          throw new ConcurrentTurnError();
        }
        current = existingConversation;
      } else {
        current = await tx.assistantConversation.create({
          data: { userId: req.user!.userId, title, revision: 1 },
        });
      }
      await tx.assistantMessage.create({
        data: { conversationId: current.id, role: "user", content: question },
      });
      await tx.assistantMessage.create({
        data: {
          conversationId: current.id,
          role: "assistant",
          content: answer,
          records,
          authorizationUniversityIds,
          authorizationComplete: true,
        },
      });
      return current;
    });
    res.json({
      conversationId: conversation.id,
      answer,
      records,
    });
  } catch (error) {
    if (error instanceof ConcurrentTurnError) {
      res.status(409).json({ error: "This conversation changed while the answer was being prepared. Please send your question again." });
      return;
    }
    req.log?.error({ error, userId: req.user?.userId }, "Assistant query failed");
    res.status(500).json({ error: "The AI assistant could not answer right now. Please try again." });
  }
});

class ConcurrentTurnError extends Error {}

export default router;