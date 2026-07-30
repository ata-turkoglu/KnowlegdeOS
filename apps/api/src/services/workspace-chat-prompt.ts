import type { ApiConfig } from "../config/env.js";
import { slugify } from "../lib/slug.js";
import { ensureWorkspaceStorage, readWorkspaceMetadata, writeWorkspaceMetadata } from "./storage.js";

export const defaultChatSystemPrompt = `Answer the user's specific request first. Do not summarize unrelated documents or background. Omit details the user did not request. If the supplied sources do not contain the requested information, say so explicitly. Match the language of the user's question.`;

export async function getWorkspaceChatSystemPrompt(config: ApiConfig, workspaceSlugInput: string) {
  const paths = await ensureWorkspaceStorage(config.storageRoot, slugify(workspaceSlugInput));
  try {
    const value = (await readWorkspaceMetadata(paths)).chatSystemPrompt;
    return typeof value === "string" && value.trim() ? value : defaultChatSystemPrompt;
  } catch { return defaultChatSystemPrompt; }
}

export async function saveWorkspaceChatSystemPrompt(config: ApiConfig, workspaceSlugInput: string, prompt: unknown) {
  if (typeof prompt !== "string" || !prompt.trim()) throw new Error("Chat system prompt is required.");
  if (prompt.length > 20_000) throw new Error("Chat system prompt must be 20,000 characters or less.");
  const slug = slugify(workspaceSlugInput), paths = await ensureWorkspaceStorage(config.storageRoot, slug);
  let metadata: Record<string, unknown> = {};
  try { metadata = await readWorkspaceMetadata(paths); } catch { /* First workspace setting. */ }
  const chatSystemPrompt = prompt.trim();
  await writeWorkspaceMetadata(paths, { ...metadata, slug, storagePath: paths.root, updatedAt: new Date().toISOString(), chatSystemPrompt });
  return chatSystemPrompt;
}
