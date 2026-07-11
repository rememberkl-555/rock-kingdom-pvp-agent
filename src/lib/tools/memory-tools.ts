import { tool, type ToolSet } from "ai";
import * as Crypto from "expo-crypto";
import { z } from "zod";

import type { MemoryRepository } from "@/lib/db/repositories/types";
import type { MemoryEntry, MemoryEvent } from "@/types/app-state";

const memoryCategorySchema = z.enum([
  "preference",
  "personal_fact",
  "goal",
  "constraint",
]);

type MemoryCategory = z.infer<typeof memoryCategorySchema>;

const MEMORY_CATEGORY_LABELS: Record<MemoryCategory, string> = {
  preference: "Preference",
  personal_fact: "Personal fact",
  goal: "Goal",
  constraint: "Constraint",
};

function formatMemory(category: MemoryCategory, key: string, value: string) {
  return `${MEMORY_CATEGORY_LABELS[category]}: ${key.trim()} = ${value.trim()}`;
}

export function buildMemorySystemPrompt(
  memories: MemoryEntry[],
  input: { canWrite: boolean },
) {
  const enabledMemories = memories.filter(
    (memory) => memory.enabled && !memory.archivedAt,
  );

  if (enabledMemories.length === 0) {
    return input.canWrite
      ? [
          "Memory is enabled.",
          "Save only durable information that will predictably help in future chats: explicit preferences, stable personal facts, ongoing goals, or persistent constraints.",
          "Good trigger phrases include: remember this, always, from now on, I prefer, my preferred, or a clearly stated lasting fact.",
          "Example: 'Always respond in Hinglish' should be saved as category=preference, key=language, value=Hinglish.",
          "Never save the conversation, assistant responses, tool results, temporary tasks, one-off requests, guesses, or information inferred only from context.",
          "Do not save one-off requests, secrets, credentials, payment data, or sensitive health, legal, or financial facts unless the user explicitly asks you to remember them.",
        ].join("\n")
      : "Memory is enabled, but no memories have been saved yet.";
  }

  const lines = [
    "Memory:",
    ...enabledMemories.map(
      (memory) => `- ${memory.content} (memory id: ${memory.id})`,
    ),
  ];

  if (!input.canWrite) {
    return lines.join("\n");
  }

  return [
    ...lines,
    "",
    "Save only durable information that will predictably help in future chats: explicit preferences, stable personal facts, ongoing goals, or persistent constraints.",
    "Example: 'Always respond in Hinglish' should be saved as category=preference, key=language, value=Hinglish.",
    "Never save the conversation, assistant responses, tool results, temporary tasks, one-off requests, guesses, or information inferred only from context.",
    "Do not save one-off requests, secrets, credentials, payment data, or sensitive health, legal, or financial facts unless the user explicitly asks you to remember them.",
    "If a new durable fact replaces an existing memory, update that memory instead of creating a duplicate.",
    "When updating or removing an existing memory, use the memory id shown above.",
  ].join("\n");
}

export function createMemoryTools(input: {
  conversationId: string;
  memoryRepository: MemoryRepository;
  onEvent?: (event: MemoryEvent) => void;
  sourceMessageId: string;
}) {
  const createEvent = (
    event: Omit<MemoryEvent, "createdAt" | "id">,
  ): MemoryEvent => ({
    ...event,
    id: Crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  });

  const tools = {
    rememberMemory: tool({
      description:
        "Save one explicit, durable user preference, personal fact, ongoing goal, or persistent constraint for future chats. Never store chat transcripts, assistant output, temporary tasks, tool results, or inferred information.",
      inputSchema: z.object({
        category: memoryCategorySchema,
        key: z.string().trim().min(1).max(80),
        value: z.string().trim().min(1).max(300),
        reason: z.string().optional(),
      }),
      execute: async ({ category, key, reason, value }) => {
        const content = formatMemory(category, key, value);
        const existing = (await input.memoryRepository.list()).find(
          (memory) =>
            memory.enabled &&
            !memory.archivedAt &&
            memory.content.toLowerCase() === content.toLowerCase(),
        );

        if (existing) {
          return {
            memoryId: existing.id,
            status: "already_saved",
          };
        }

        const memory = await input.memoryRepository.create({
          content,
          sourceConversationId: input.conversationId,
          sourceMessageId: input.sourceMessageId,
        });
        const event = createEvent({
          kind: "created",
          memoryId: memory.id,
          content: memory.content,
          previousContent: null,
          reason: reason?.trim() || null,
        });

        input.onEvent?.(event);

        return {
          memoryId: memory.id,
          status: "saved",
        };
      },
    }),
    updateMemory: tool({
      description:
        "Update an existing structured memory by id when the user replaces or clarifies durable information.",
      inputSchema: z.object({
        memoryId: z.string().min(1),
        category: memoryCategorySchema,
        key: z.string().trim().min(1).max(80),
        value: z.string().trim().min(1).max(300),
        reason: z.string().optional(),
      }),
      execute: async ({ category, key, memoryId, reason, value }) => {
        const current = await input.memoryRepository.getById(memoryId);

        if (!current || current.archivedAt) {
          return {
            memoryId,
            status: "not_found",
          };
        }

        const nextContent = formatMemory(category, key, value);

        await input.memoryRepository.update(memoryId, {
          content: nextContent,
          enabled: true,
          sourceConversationId: input.conversationId,
          sourceMessageId: input.sourceMessageId,
        });

        const event = createEvent({
          kind: "updated",
          memoryId,
          content: nextContent,
          previousContent: current.content,
          reason: reason?.trim() || null,
        });

        input.onEvent?.(event);

        return {
          memoryId,
          status: "updated",
        };
      },
    }),
    forgetMemory: tool({
      description:
        "Remove an existing memory by id when the user asks you to forget it or it is no longer true.",
      inputSchema: z.object({
        memoryId: z.string().min(1),
        reason: z.string().optional(),
      }),
      execute: async ({ memoryId, reason }) => {
        const current = await input.memoryRepository.getById(memoryId);

        if (!current || current.archivedAt) {
          return {
            memoryId,
            status: "not_found",
          };
        }

        await input.memoryRepository.archive(memoryId);

        const event = createEvent({
          kind: "deleted",
          memoryId,
          content: current.content,
          previousContent: current.content,
          reason: reason?.trim() || null,
        });

        input.onEvent?.(event);

        return {
          memoryId,
          status: "removed",
        };
      },
    }),
  } satisfies ToolSet;

  return { tools };
}
