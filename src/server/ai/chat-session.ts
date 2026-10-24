import { assistant as assistantMessage, user as userMessage, type AgentInputItem, type Session as AgentSession } from "@openai/agents";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/errors";

// Chat history for the assistant, stored in Postgres behind the Agents SDK Session interface.
// run(agent, input, { session }) reads the history before the model call and appends the new turn
// after a successful run; a failed or timed-out run writes nothing.

export interface ChatText {
  role: "user" | "assistant";
  content: string;
}

const TITLE_LENGTH = 80;

const notFound = () => new HttpError(404, "Conversation not found", "not_found");

/**
 * The plain text of a user or assistant message item, or null for anything else
 * (function calls, tool results, reasoning). Only this text is ever stored.
 */
export function chatText(item: AgentInputItem): ChatText | null {
  const m = item as { type?: string; role?: string; content?: unknown };
  if ((m.type !== undefined && m.type !== "message") || (m.role !== "user" && m.role !== "assistant")) return null;
  const content =
    typeof m.content === "string"
      ? m.content
      : Array.isArray(m.content)
        ? m.content.map((part: { text?: unknown }) => (typeof part?.text === "string" ? part.text : "")).join("")
        : "";
  return content.trim() ? { role: m.role, content: content.trim() } : null;
}

const toItem = (m: ChatText): AgentInputItem => (m.role === "user" ? userMessage(m.content) : assistantMessage(m.content));

/** One conversation of one user. Build it with openChatSession, which checks ownership. */
export class PrismaChatSession implements AgentSession {
  constructor(readonly conversationId: string) {}

  async getSessionId(): Promise<string> {
    return this.conversationId;
  }

  async getItems(limit?: number): Promise<AgentInputItem[]> {
    if (limit !== undefined && limit <= 0) return [];
    const rows = await db.chatMessage.findMany({
      where: { conversationId: this.conversationId },
      orderBy: { id: limit === undefined ? "asc" : "desc" },
      take: limit,
      select: { role: true, content: true },
    });
    if (limit !== undefined) rows.reverse();
    return rows.map((r) => toItem(r as ChatText));
  }

  async addItems(items: AgentInputItem[]): Promise<void> {
    const rows = items.map(chatText).filter((m): m is ChatText => m !== null);
    if (rows.length === 0) return;
    await db.$transaction([
      db.chatMessage.createMany({ data: rows.map((m) => ({ conversationId: this.conversationId, ...m })) }),
      db.chatConversation.update({ where: { id: this.conversationId }, data: { updatedAt: new Date() } }),
    ]);
  }

  async popItem(): Promise<AgentInputItem | undefined> {
    const last = await db.chatMessage.findFirst({ where: { conversationId: this.conversationId }, orderBy: { id: "desc" } });
    if (!last) return undefined;
    await db.chatMessage.delete({ where: { id: last.id } });
    return toItem(last as ChatText);
  }

  async clearSession(): Promise<void> {
    await db.chatMessage.deleteMany({ where: { conversationId: this.conversationId } });
  }
}

/**
 * The user's conversation `id`, created on first use. Someone else's id is a 404 (not 403),
 * so a guessed id does not even reveal that the conversation exists.
 */
export async function openChatSession(userId: string, id: string, firstQuestion: string): Promise<PrismaChatSession> {
  const conversation = await db.chatConversation.upsert({
    where: { id },
    create: { id, userId, title: firstQuestion.slice(0, TITLE_LENGTH) },
    update: {},
    select: { userId: true },
  });
  if (conversation.userId !== userId) throw notFound();
  return new PrismaChatSession(id);
}

export async function listConversations(userId: string) {
  const conversations = await db.chatConversation.findMany({
    where: { userId, messages: { some: {} } },
    orderBy: { updatedAt: "desc" },
    take: 20,
    select: { id: true, title: true, updatedAt: true },
  });
  return { conversations };
}

export async function getConversation(userId: string, id: string) {
  const conversation = await db.chatConversation.findUnique({ where: { id }, select: { id: true, userId: true, title: true } });
  if (!conversation || conversation.userId !== userId) throw notFound();
  const messages = await db.chatMessage.findMany({ where: { conversationId: id }, orderBy: { id: "asc" }, select: { role: true, content: true } });
  return { id, title: conversation.title, messages: messages as ChatText[] };
}

export async function deleteConversation(userId: string, id: string) {
  const { count } = await db.chatConversation.deleteMany({ where: { id, userId } });
  if (count === 0) throw notFound();
}
