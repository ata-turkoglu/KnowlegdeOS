export type CacheKeyInput = { workspaceId: string; query: string; indexVersion: string; retrievalSettingsVersion: string; providerModel: string; metadataFilters: unknown };
export function retrievalCacheKey(input: CacheKeyInput) { return JSON.stringify([input.workspaceId, input.query.trim().toLocaleLowerCase("tr-TR"), input.indexVersion, input.retrievalSettingsVersion, input.providerModel, input.metadataFilters]); }
export class InMemoryRetrievalCache<T> {
  private values = new Map<string, { value: T; expiresAt: number }>();
  constructor(private readonly ttlMs = 60_000) {}
  get(key: string) {
    const item = this.values.get(key);
    if (!item) return undefined;
    if (item.expiresAt <= Date.now()) { this.values.delete(key); return undefined; }
    return item.value;
  }
  set(key: string, value: T) { this.values.set(key, { value, expiresAt: Date.now() + this.ttlMs }); }
  invalidateWorkspace(workspaceId: string) { for (const key of this.values.keys()) if (key.includes(`\"${workspaceId}\"`)) this.values.delete(key); }
}

/** Process-local exact-query cache. Reindexing invalidates it; TTL limits stale data after external writes. */
export const ragRetrievalCache = new InMemoryRetrievalCache<unknown>();
