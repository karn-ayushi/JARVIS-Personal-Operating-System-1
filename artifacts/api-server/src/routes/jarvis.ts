import { Router, type IRouter } from "express";
import multer from "multer";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import {
  CreateDocumentBody,
  CreateGoalBody,
  CreateMemoryBody,
  CreateMeetingBody,
  CreateMilestoneBody,
  CreateReminderBody,
  CreateDocumentResponse,
  CreateGoalResponse,
  CreateMemoryResponse,
  CreateMeetingResponse,
  CreateMilestoneResponse,
  CreateReminderResponse,
  DeleteDocumentParams,
  DeleteGoalParams,
  DeleteMeetingParams,
  DeleteMemoryParams,
  DeleteMilestoneParams,
  DeleteReminderParams,
  QueryDocumentsBody,
  GetDocumentParams,
  GetDocumentResponse,
  GetGoalParams,
  GetGoalResponse,
  GetMeetingParams,
  GetMeetingResponse,
  ListDocumentsResponse,
  ListGoalsResponse,
  ListMeetingsResponse,
  ListMemoriesResponse,
  ListRemindersResponse,
  QueryDocumentsResponse,
  SearchKnowledgeQueryParams,
  SearchKnowledgeResponse,
  SendChatBody,
  SendChatResponse,
  UpdateGoalBody,
  UpdateGoalParams,
  UpdateMemoryBody,
  UpdateMemoryParams,
  UpdateMilestoneBody,
  UpdateMilestoneParams,
  UpdateReminderBody,
  UpdateReminderParams,
} from "@workspace/api-zod";
import {
  activityEventsTable,
  db,
  documentChunksTable,
  documentsTable,
  goalsTable,
  memoriesTable,
  meetingsTable,
  milestonesTable,
  remindersTable,
  xpEventsTable,
} from "@workspace/db";
import { requireUser, currentUser } from "../lib/auth";
import { generateGemini } from "../lib/ai";
import {
  awardXp,
  buildContext,
  levelForXp,
  logActivity,
  nextLevelXp,
  retrieveDocumentChunks,
  searchKnowledge,
  splitIntoChunks,
} from "../lib/jarvis";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
router.use(requireUser);

router.post("/chat", async (req, res): Promise<void> => {
  const parsed = SendChatBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = currentUser(res);
  const context = await buildContext(user.id, parsed.data.message);
  const prompt = [
    "You are JARVIS, a personal context assistant. Answer only from the supplied context and the user's question.",
    "If the context does not support a claim, say that you do not have enough information. Be concise and practical.",
    `User question: ${parsed.data.message}`,
    `Memories: ${JSON.stringify(context.memories.map((item) => item.content))}`,
    `Active goals: ${JSON.stringify(context.goals.map((item) => ({ title: item.title, progress: item.progress, deadline: item.deadline, priority: item.priority })))}`,
    `Open reminders: ${JSON.stringify(context.reminders.map((item) => ({ title: item.title, dueAt: item.dueAt })))}`,
    `Recent meetings: ${JSON.stringify(context.meetings.map((item) => ({ title: item.title, summary: item.summary })))}`,
    `Document excerpts: ${JSON.stringify(context.chunks.map((item) => ({ title: item.document.title, excerpt: item.chunk.content })))}`,
  ].join("\n");
  const generated = await generateGemini(prompt);
  const fallback = context.goals[0]
    ? `Your most relevant focus is “${context.goals[0].title}” at ${context.goals[0].progress}% progress${context.goals[0].deadline ? `, due ${context.goals[0].deadline}` : ""}. Start with the next visible milestone and keep your open reminders in view.`
    : "I’m still learning your context. Add a goal, memory, or document and I can make this answer more specific.";
  const sources = [
    ...context.goals.slice(0, 2).map((item) => ({ type: "goal", title: item.title, excerpt: `${item.progress}% complete` })),
    ...context.memories.slice(0, 2).map((item) => ({ type: "memory", title: "Memory", excerpt: item.content })),
    ...context.chunks.slice(0, 2).map((item) => ({ type: "document", title: item.document.title, excerpt: item.chunk.content.slice(0, 160) })),
  ];
  res.json(SendChatResponse.parse({ reply: generated ?? fallback, sources }));
});

router.get("/memories", async (_req, res): Promise<void> => {
  const items = await db.select().from(memoriesTable).where(eq(memoriesTable.userId, currentUser(res).id)).orderBy(desc(memoriesTable.updatedAt));
  res.json(ListMemoriesResponse.parse(items));
});

router.post("/memories", async (req, res): Promise<void> => {
  const parsed = CreateMemoryBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const userId = currentUser(res).id;
  const [item] = await db.insert(memoriesTable).values({ ...parsed.data, userId, source: "manual" }).returning();
  await Promise.all([awardXp(userId, `memory:${item.id}`, 5), logActivity(userId, "memory", "Memory added", item.content)]);
  res.status(201).json(CreateMemoryResponse.parse(item));
});

router.patch("/memories/:id", async (req, res): Promise<void> => {
  const params = UpdateMemoryParams.safeParse(req.params);
  const parsed = UpdateMemoryBody.safeParse(req.body);
  if (!params.success || !parsed.success) { res.status(400).json({ error: "Invalid memory update" }); return; }
  const [item] = await db.update(memoriesTable).set(parsed.data).where(and(eq(memoriesTable.id, params.data.id), eq(memoriesTable.userId, currentUser(res).id))).returning();
  if (!item) { res.status(404).json({ error: "Memory not found" }); return; }
  res.json(item);
});

router.delete("/memories/:id", async (req, res): Promise<void> => {
  const params = DeleteMemoryParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [item] = await db.delete(memoriesTable).where(and(eq(memoriesTable.id, params.data.id), eq(memoriesTable.userId, currentUser(res).id))).returning();
  if (!item) { res.status(404).json({ error: "Memory not found" }); return; }
  res.sendStatus(204);
});

router.get("/documents", async (_req, res): Promise<void> => {
  const items = await db.select().from(documentsTable).where(eq(documentsTable.userId, currentUser(res).id)).orderBy(desc(documentsTable.createdAt));
  res.json(ListDocumentsResponse.parse(items.map(toDocument)));
});

router.post("/documents", async (req, res): Promise<void> => {
  const parsed = CreateDocumentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const created = await indexDocument(currentUser(res).id, parsed.data.filename, parsed.data.title, parsed.data.content, parsed.data.fileSize ?? parsed.data.content.length);
  res.status(201).json(CreateDocumentResponse.parse(toDocument(created)));
});

router.post("/documents/upload", upload.single("file"), async (req, res): Promise<void> => {
  if (!req.file) { res.status(400).json({ error: "A PDF file is required" }); return; }
  if (req.file.mimetype !== "application/pdf" && !req.file.originalname.toLowerCase().endsWith(".pdf")) {
    res.status(400).json({ error: "Only PDF files are supported" }); return;
  }
  let text: string;
  try {
    text = await extractPdfText(req.file.buffer);
  } catch {
    res.status(422).json({ error: "The PDF could not be read" }); return;
  }
  if (!text) { res.status(422).json({ error: "The PDF does not contain readable text" }); return; }
  const title = typeof req.body.title === "string" && req.body.title.trim() ? req.body.title.trim() : req.file.originalname.replace(/\.pdf$/i, "");
  const created = await indexDocument(currentUser(res).id, req.file.originalname, title, text, req.file.size);
  res.status(201).json(CreateDocumentResponse.parse(toDocument(created)));
});

router.get("/documents/:id", async (req, res): Promise<void> => {
  const params = GetDocumentParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [document] = await db.select().from(documentsTable).where(and(eq(documentsTable.id, params.data.id), eq(documentsTable.userId, currentUser(res).id))).limit(1);
  if (!document) { res.status(404).json({ error: "Document not found" }); return; }
  res.json(GetDocumentResponse.parse({ ...toDocument(document), textPreview: document.contentText.slice(0, 1000) }));
});

router.delete("/documents/:id", async (req, res): Promise<void> => {
  const params = DeleteDocumentParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [document] = await db.delete(documentsTable).where(and(eq(documentsTable.id, params.data.id), eq(documentsTable.userId, currentUser(res).id))).returning();
  if (!document) { res.status(404).json({ error: "Document not found" }); return; }
  await db.delete(documentChunksTable).where(eq(documentChunksTable.documentId, document.id));
  res.sendStatus(204);
});

router.post("/documents/query", async (req, res): Promise<void> => {
  const parsed = QueryDocumentsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const matches = await retrieveDocumentChunks(currentUser(res).id, parsed.data.query, parsed.data.documentId);
  const context = matches.map((item) => `${item.document.title}: ${item.chunk.content}`).join("\n");
  const generated = context ? await generateGemini(`Answer the question only from these document excerpts. Cite the document title in plain language. If unsupported, say so.\nQuestion: ${parsed.data.query}\nExcerpts:\n${context}`) : null;
  const answer = generated ?? (matches[0] ? `I found this in ${matches[0].document.title}: ${matches[0].chunk.content.slice(0, 500)}` : "I couldn't find a matching passage in your indexed documents.");
  res.json(QueryDocumentsResponse.parse({
    answer,
    sources: matches.map((item) => ({ documentId: item.document.id, title: item.document.title, excerpt: item.chunk.content.slice(0, 260) })),
  }));
});

router.get("/goals", async (_req, res): Promise<void> => {
  const items = await db.select().from(goalsTable).where(eq(goalsTable.userId, currentUser(res).id)).orderBy(desc(goalsTable.updatedAt));
  res.json(ListGoalsResponse.parse(items));
});

router.post("/goals", async (req, res): Promise<void> => {
  const parsed = CreateGoalBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const userId = currentUser(res).id;
  const [goal] = await db.insert(goalsTable).values({ ...parsed.data, userId, deadline: parsed.data.deadline ? parsed.data.deadline.toISOString().slice(0, 10) : null }).returning();
  await Promise.all([awardXp(userId, `goal:${goal.id}`, 10), logActivity(userId, "goal", "Goal created", goal.title)]);
  res.status(201).json(CreateGoalResponse.parse(goal));
});

router.get("/goals/:id", async (req, res): Promise<void> => {
  const params = GetGoalParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [goal] = await db.select().from(goalsTable).where(and(eq(goalsTable.id, params.data.id), eq(goalsTable.userId, currentUser(res).id))).limit(1);
  if (!goal) { res.status(404).json({ error: "Goal not found" }); return; }
  const milestones = await db.select().from(milestonesTable).where(eq(milestonesTable.goalId, goal.id)).orderBy(milestonesTable.createdAt);
  res.json(GetGoalResponse.parse({ ...goal, milestones }));
});

router.patch("/goals/:id", async (req, res): Promise<void> => {
  const params = UpdateGoalParams.safeParse(req.params);
  const parsed = UpdateGoalBody.safeParse(req.body);
  if (!params.success || !parsed.success) { res.status(400).json({ error: "Invalid goal update" }); return; }
  const userId = currentUser(res).id;
  const { deadline, ...goalValues } = parsed.data;
  const values = deadline === undefined
    ? goalValues
    : { ...goalValues, deadline: deadline ? deadline.toISOString().slice(0, 10) : null };
  const [goal] = await db.update(goalsTable).set(values).where(and(eq(goalsTable.id, params.data.id), eq(goalsTable.userId, userId))).returning();
  if (!goal) { res.status(404).json({ error: "Goal not found" }); return; }
  if (goal.status === "completed") await awardXp(userId, `goal-completed:${goal.id}`, 50);
  res.json(goal);
});

router.delete("/goals/:id", async (req, res): Promise<void> => {
  const params = DeleteGoalParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [goal] = await db.delete(goalsTable).where(and(eq(goalsTable.id, params.data.id), eq(goalsTable.userId, currentUser(res).id))).returning();
  if (!goal) { res.status(404).json({ error: "Goal not found" }); return; }
  await db.delete(milestonesTable).where(eq(milestonesTable.goalId, goal.id));
  res.sendStatus(204);
});

router.post("/goals/:id/milestones", async (req, res): Promise<void> => {
  const params = req.params.id;
  const goalId = Number(params);
  const parsed = CreateMilestoneBody.safeParse(req.body);
  if (!Number.isInteger(goalId) || !parsed.success) { res.status(400).json({ error: "Invalid milestone" }); return; }
  const [goal] = await db.select().from(goalsTable).where(and(eq(goalsTable.id, goalId), eq(goalsTable.userId, currentUser(res).id))).limit(1);
  if (!goal) { res.status(404).json({ error: "Goal not found" }); return; }
  const [milestone] = await db.insert(milestonesTable).values({ ...parsed.data, goalId, dueDate: parsed.data.dueDate ? parsed.data.dueDate.toISOString().slice(0, 10) : null }).returning();
  res.status(201).json(CreateMilestoneResponse.parse(milestone));
});

router.patch("/milestones/:id", async (req, res): Promise<void> => {
  const params = UpdateMilestoneParams.safeParse(req.params);
  const parsed = UpdateMilestoneBody.safeParse(req.body);
  if (!params.success || !parsed.success) { res.status(400).json({ error: "Invalid milestone update" }); return; }
  const userId = currentUser(res).id;
  const [owned] = await db.select({ milestone: milestonesTable }).from(milestonesTable).innerJoin(goalsTable, eq(milestonesTable.goalId, goalsTable.id)).where(and(eq(milestonesTable.id, params.data.id), eq(goalsTable.userId, userId))).limit(1);
  if (!owned) { res.status(404).json({ error: "Milestone not found" }); return; }
  const { dueDate, ...milestoneValues } = parsed.data;
  const values = dueDate === undefined
    ? milestoneValues
    : { ...milestoneValues, dueDate: dueDate ? dueDate.toISOString().slice(0, 10) : null };
  const [milestone] = await db.update(milestonesTable).set(values).where(eq(milestonesTable.id, params.data.id)).returning();
  if (milestone.status === "completed") await awardXp(userId, `milestone-completed:${milestone.id}`, 25);
  res.json(milestone);
});

router.delete("/milestones/:id", async (req, res): Promise<void> => {
  const params = DeleteMilestoneParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const userId = currentUser(res).id;
  const [owned] = await db.select({ milestone: milestonesTable }).from(milestonesTable).innerJoin(goalsTable, eq(milestonesTable.goalId, goalsTable.id)).where(and(eq(milestonesTable.id, params.data.id), eq(goalsTable.userId, userId))).limit(1);
  if (!owned) { res.status(404).json({ error: "Milestone not found" }); return; }
  await db.delete(milestonesTable).where(eq(milestonesTable.id, params.data.id));
  res.sendStatus(204);
});

router.get("/meetings", async (_req, res): Promise<void> => {
  const items = await db.select().from(meetingsTable).where(eq(meetingsTable.userId, currentUser(res).id)).orderBy(desc(meetingsTable.createdAt));
  res.json(ListMeetingsResponse.parse(items));
});

router.post("/meetings", async (req, res): Promise<void> => {
  const parsed = CreateMeetingBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const userId = currentUser(res).id;
  const transcript = parsed.data.transcript.trim();
  const generated = await generateGemini(`Extract a concise meeting summary, decisions, action items, and participants from this transcript. Return JSON with keys summary, decisions, actionItems, participants. Do not invent details.\n${transcript}`);
  let extracted = { summary: transcript.slice(0, 280), decisions: [] as string[], actionItems: [] as string[], participants: [] as string[] };
  if (generated) {
    try { extracted = { ...extracted, ...JSON.parse(generated) }; } catch { /* keep safe fallback */ }
  }
  const [meeting] = await db.insert(meetingsTable).values({
    userId, title: parsed.data.title, transcript, meetingDate: parsed.data.meetingDate ? parsed.data.meetingDate.toISOString().slice(0, 10) : null,
    summary: extracted.summary, decisions: extracted.decisions, actionItems: extracted.actionItems, participants: extracted.participants,
  }).returning();
  await Promise.all([awardXp(userId, `meeting:${meeting.id}`, 15), logActivity(userId, "meeting", "Meeting processed", meeting.title)]);
  res.status(201).json(CreateMeetingResponse.parse(meeting));
});

router.get("/meetings/:id", async (req, res): Promise<void> => {
  const params = GetMeetingParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [meeting] = await db.select().from(meetingsTable).where(and(eq(meetingsTable.id, params.data.id), eq(meetingsTable.userId, currentUser(res).id))).limit(1);
  if (!meeting) { res.status(404).json({ error: "Meeting not found" }); return; }
  res.json(GetMeetingResponse.parse(meeting));
});

router.delete("/meetings/:id", async (req, res): Promise<void> => {
  const params = DeleteMeetingParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [meeting] = await db.delete(meetingsTable).where(and(eq(meetingsTable.id, params.data.id), eq(meetingsTable.userId, currentUser(res).id))).returning();
  if (!meeting) { res.status(404).json({ error: "Meeting not found" }); return; }
  res.sendStatus(204);
});

router.get("/reminders", async (_req, res): Promise<void> => {
  const items = await db.select().from(remindersTable).where(eq(remindersTable.userId, currentUser(res).id)).orderBy(remindersTable.dueAt);
  res.json(ListRemindersResponse.parse(items));
});

router.post("/reminders", async (req, res): Promise<void> => {
  const parsed = CreateReminderBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [reminder] = await db.insert(remindersTable).values({ ...parsed.data, userId: currentUser(res).id, dueAt: parsed.data.dueAt }).returning();
  res.status(201).json(CreateReminderResponse.parse(reminder));
});

router.patch("/reminders/:id", async (req, res): Promise<void> => {
  const params = UpdateReminderParams.safeParse(req.params);
  const parsed = UpdateReminderBody.safeParse(req.body);
  if (!params.success || !parsed.success) { res.status(400).json({ error: "Invalid reminder update" }); return; }
  const [reminder] = await db.update(remindersTable).set(parsed.data).where(and(eq(remindersTable.id, params.data.id), eq(remindersTable.userId, currentUser(res).id))).returning();
  if (!reminder) { res.status(404).json({ error: "Reminder not found" }); return; }
  res.json(reminder);
});

router.delete("/reminders/:id", async (req, res): Promise<void> => {
  const params = DeleteReminderParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [reminder] = await db.delete(remindersTable).where(and(eq(remindersTable.id, params.data.id), eq(remindersTable.userId, currentUser(res).id))).returning();
  if (!reminder) { res.status(404).json({ error: "Reminder not found" }); return; }
  res.sendStatus(204);
});

router.get("/insights/dashboard", async (_req, res): Promise<void> => {
  const userId = currentUser(res).id;
  const [goals, reminders, memories, documents, meetings, xp] = await Promise.all([
    db.select().from(goalsTable).where(eq(goalsTable.userId, userId)).orderBy(desc(goalsTable.updatedAt)),
    db.select().from(remindersTable).where(and(eq(remindersTable.userId, userId), eq(remindersTable.status, "open"))).orderBy(remindersTable.dueAt).limit(4),
    db.select().from(memoriesTable).where(eq(memoriesTable.userId, userId)).orderBy(desc(memoriesTable.updatedAt)).limit(3),
    db.select().from(documentsTable).where(eq(documentsTable.userId, userId)).orderBy(desc(documentsTable.createdAt)).limit(3),
    db.select().from(meetingsTable).where(eq(meetingsTable.userId, userId)).orderBy(desc(meetingsTable.createdAt)).limit(3),
    db.select({ total: sql<number>`coalesce(sum(${xpEventsTable.amount}), 0)` }).from(xpEventsTable).where(eq(xpEventsTable.userId, userId)),
  ]);
  const active = goals.filter((goal) => goal.status === "active");
  const xpTotal = Number(xp[0]?.total ?? 0);
  const focus = active[0] ? `${active[0].title} · ${active[0].progress}% complete` : "Add a goal to give JARVIS something meaningful to prioritize.";
  res.json({
    greeting: `Good morning, ${currentUser(res).name.split(" ")[0]}`,
    focus,
    activeGoals: active.length,
    completedGoals: goals.filter((goal) => goal.status === "completed").length,
    upcomingReminders: reminders,
    recentMemories: memories,
    recentDocuments: documents.map(toDocument),
    recentMeetings: meetings,
    xp: xpTotal,
    level: levelForXp(xpTotal),
    streak: await calculateStreak(userId),
  });
});

router.get("/insights/growth", async (_req, res): Promise<void> => {
  const userId = currentUser(res).id;
  const [goals, memories, documents, meetings, xp, activities] = await Promise.all([
    db.select().from(goalsTable).where(eq(goalsTable.userId, userId)),
    db.select().from(memoriesTable).where(eq(memoriesTable.userId, userId)),
    db.select().from(documentsTable).where(eq(documentsTable.userId, userId)),
    db.select().from(meetingsTable).where(eq(meetingsTable.userId, userId)),
    db.select({ total: sql<number>`coalesce(sum(${xpEventsTable.amount}), 0)` }).from(xpEventsTable).where(eq(xpEventsTable.userId, userId)),
    db.select().from(activityEventsTable).where(eq(activityEventsTable.userId, userId)),
  ]);
  const xpTotal = Number(xp[0]?.total ?? 0);
  const completedGoals = goals.filter((goal) => goal.status === "completed").length;
  const skills = [...new Set([
    ...goals.map((goal) => goal.category),
    ...memories.filter((item) => item.category === "interest" || item.category === "education").map((item) => item.content.split(" ").slice(0, 2).join(" ")),
  ])].filter(Boolean).slice(0, 8);
  res.json({
    xp: xpTotal, level: levelForXp(xpTotal), nextLevelXp: nextLevelXp(levelForXp(xpTotal)), streak: await calculateStreak(userId),
    activeGoals: goals.filter((goal) => goal.status === "active").length, completedGoals,
    completionRate: goals.length ? Math.round((completedGoals / goals.length) * 100) : 0,
    completedTasks: 0, memoriesCreated: memories.length, documentsUploaded: documents.length,
    meetingsProcessed: meetings.length, skills: skills.length ? skills : ["Build your first goal to reveal skills"],
  });
});

router.get("/insights/timeline", async (_req, res): Promise<void> => {
  const items = await db.select().from(activityEventsTable).where(eq(activityEventsTable.userId, currentUser(res).id)).orderBy(desc(activityEventsTable.occurredAt)).limit(80);
  res.json(items.map((item) => ({ id: String(item.id), kind: item.kind, title: item.title, description: item.description, occurredAt: item.occurredAt })));
});

router.get("/insights/knowledge", async (req, res): Promise<void> => {
  const parsed = SearchKnowledgeQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  res.json(SearchKnowledgeResponse.parse(await searchKnowledge(currentUser(res).id, parsed.data.q)));
});

async function indexDocument(userId: number, filename: string, title: string, content: string, fileSize: number) {
  const chunks = splitIntoChunks(content);
  const [document] = await db.insert(documentsTable).values({
    userId, filename, title, fileSize, contentText: content, chunkCount: chunks.length, processingStatus: "ready",
  }).returning();
  if (chunks.length) await db.insert(documentChunksTable).values(chunks.map((chunk, index) => ({ documentId: document.id, chunkIndex: index, content: chunk })));
  await Promise.all([awardXp(userId, `document:${document.id}`, 10), logActivity(userId, "document", "Document indexed", title)]);
  return document;
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await getDocument({ data: new Uint8Array(buffer) }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
  }
  return pages.join("\n").replace(/\s+/g, " ").trim();
}

function toDocument(document: typeof documentsTable.$inferSelect) {
  return {
    id: document.id,
    filename: document.filename,
    title: document.title,
    fileSize: document.fileSize,
    processingStatus: document.processingStatus,
    chunkCount: document.chunkCount,
    createdAt: document.createdAt,
  };
}

async function calculateStreak(userId: number): Promise<number> {
  const items = await db.select({ occurredAt: activityEventsTable.occurredAt }).from(activityEventsTable).where(eq(activityEventsTable.userId, userId)).orderBy(desc(activityEventsTable.occurredAt)).limit(30);
  const days = new Set(items.map((item) => item.occurredAt.toISOString().slice(0, 10)));
  let streak = 0;
  const cursor = new Date();
  while (days.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

export default router;