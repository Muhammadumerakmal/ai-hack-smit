import OpenAI from "openai";
import { OpenAIConversationsSession, type Session as AgentSession } from "@openai/agents";
import { HttpError } from "@/lib/errors";
import { openAiClient } from "./agents";

// Chat history lives in the OpenAI Conversations API through the Agents SDK's OpenAIConversationsSession:
// run(agent, input, { session }) loads earlier turns before the model call and saves the new turn after it.
// Each conversation records its owner in the conversation metadata.

export interface ChatHistory {
  /**
   * The signed-in user's conversation, or a new one when `conversationId` is absent.
   * Someone else's (or an unknown) id is a 404, so a guessed id reveals nothing.
   */
  open(userId: string, conversationId?: string): Promise<AgentSession>;
}

const notFound = () => new HttpError(404, "Conversation not found", "not_found");

const openAiHistory: ChatHistory = {
  async open(userId, conversationId) {
    const client = openAiClient();
    if (!conversationId) {
      const created = await client.conversations.create({ metadata: { userId } });
      return new OpenAIConversationsSession({ conversationId: created.id, client });
    }
    try {
      const conversation = await client.conversations.retrieve(conversationId);
      if ((conversation.metadata as Record<string, string> | null)?.userId !== userId) throw notFound();
    } catch (err) {
      if (err instanceof OpenAI.NotFoundError || err instanceof OpenAI.BadRequestError) throw notFound();
      throw err;
    }
    return new OpenAIConversationsSession({ conversationId, client });
  },
};

/** Tests inject an in-memory history (MemorySession per conversation) so runs never touch OpenAI. */
let injected: ChatHistory | null = null;
export function setChatHistory(history: ChatHistory | null): void {
  injected = history;
}

export function chatHistory(): ChatHistory {
  return injected ?? openAiHistory;
}
