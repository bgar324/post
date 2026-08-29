import { z } from "zod";
import {
  MailStoreSchema,
  ThreadIdSchema,
  type AccountId,
  type Draft,
  type DraftId,
  type MailStore,
  type ThreadId,
} from "./model";

const StoreResponseSchema = z.object({ store: MailStoreSchema });
const BootstrapResponseSchema = StoreResponseSchema.extend({
  user: z.object({ id: z.string(), email: z.string().email(), displayName: z.string() }).nullable(),
});
const SendResponseSchema = StoreResponseSchema.extend({ threadId: ThreadIdSchema });

export type AppUser = z.infer<typeof BootstrapResponseSchema>["user"];
export type BootstrapResult = { store: MailStore; user: AppUser };

async function apiRequest(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: {
      ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  });
  if (response.status === 204) return null;
  const data: unknown = await response.json();
  if (!response.ok) {
    const parsed = z.object({ error: z.string() }).safeParse(data);
    throw new Error(parsed.success ? parsed.data.error : `Request failed with ${response.status}`);
  }
  return data;
}

export async function fetchBootstrap(
  threadId: ThreadId | null = null,
): Promise<BootstrapResult> {
  const path = threadId === null ? "/api/store" : `/api/store?threadId=${encodeURIComponent(threadId)}`;
  return BootstrapResponseSchema.parse(await apiRequest(path));
}

export async function syncAccount(accountId: AccountId): Promise<MailStore> {
  const data = await apiRequest(`/api/accounts/${accountId}/sync`, { method: "POST" });
  return StoreResponseSchema.parse(data).store;
}


export async function disconnectRemoteAccount(accountId: AccountId): Promise<MailStore> {
  const data = await apiRequest(`/api/accounts/${accountId}`, { method: "DELETE" });
  return StoreResponseSchema.parse(data).store;
}

export async function setRemoteDefaultAccount(accountId: AccountId): Promise<MailStore> {
  const data = await apiRequest("/api/preferences", {
    method: "PATCH",
    body: JSON.stringify({ defaultAccountId: accountId }),
  });
  return StoreResponseSchema.parse(data).store;
}
export async function saveRemoteDraft(draft: Draft, keepalive = false): Promise<void> {
  await apiRequest(`/api/drafts/${draft.id}`, {
    method: "PUT",
    body: JSON.stringify(draft),
    keepalive,
  });
}

export async function deleteRemoteDraft(draftId: DraftId): Promise<void> {
  await apiRequest(`/api/drafts/${draftId}`, { method: "DELETE" });
}

export type ThreadMutation = "archive" | "inbox" | "trash" | "read" | "unread" | "star" | "unstar";
export async function refreshRemoteThread(threadId: ThreadId): Promise<MailStore> {
  const data = await apiRequest(`/api/threads/${threadId}/sync`, { method: "POST" });
  return StoreResponseSchema.parse(data).store;
}

export async function mutateRemoteThread(threadId: ThreadId, mutation: ThreadMutation): Promise<MailStore> {
  const data = await apiRequest(`/api/threads/${threadId}/${mutation}`, { method: "POST" });
  return StoreResponseSchema.parse(data).store;
}

export async function sendRemoteDraft(draft: Draft): Promise<{ store: MailStore; threadId: ThreadId }> {
  return SendResponseSchema.parse(await apiRequest("/api/send", {
    method: "POST",
    body: JSON.stringify(draft),
  }));
}
