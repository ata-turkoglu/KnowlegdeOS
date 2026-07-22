import { readdir } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import {
  createDatabaseClient,
  workspaces,
  type DatabaseClient
} from "@knowledgeos/database";
import type { ApiConfig } from "../config/env.js";
import { HttpError } from "../lib/http-errors.js";
import { slugify } from "../lib/slug.js";
import {
  ensureStorageRoot,
  ensureWorkspaceStorage,
  getWorkspaceStoragePaths,
  readWorkspaceMetadata,
  resolveStorageRoot,
  writeWorkspaceMetadata
} from "./storage.js";

export type CreateWorkspaceInput = {
  name: string;
  description?: string;
};

export type UpdateWorkspaceInput = {
  name: string;
  description?: string;
};

export type WorkspaceExportManifest = {
  version: 1;
  exportedAt: string;
  workspace: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    storagePath: string;
  };
  storage: {
    originals: string;
    markdown: string;
    metadata: string;
  };
  databaseDump: {
    included: false;
    note: string;
  };
};

function openDatabase(config: ApiConfig) {
  return createDatabaseClient(config.databaseUrl);
}

function workspaceNameFromSlug(slug: string) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function syncWorkspacesFromStorage(config: ApiConfig, db: DatabaseClient["db"]) {
  const storageRoot = path.join(resolveStorageRoot(config.storageRoot), "workspaces");

  let entries;
  try {
    entries = await readdir(storageRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const storageWorkspaces = entries.filter((entry) => entry.isDirectory());

  if (storageWorkspaces.length === 0) {
    return [];
  }

  const inserted = [];

  for (const entry of storageWorkspaces) {
    const slug = slugify(entry.name);

    if (!slug) {
      continue;
    }

    const [existingWorkspace] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.slug, slug))
      .limit(1);

    if (existingWorkspace) {
      continue;
    }

    const paths = getWorkspaceStoragePaths(config.storageRoot, slug);
    let metadata: Record<string, unknown> = {};

    try {
      metadata = await readWorkspaceMetadata(paths);
    } catch {
      metadata = {};
    }

    const name =
      typeof metadata.name === "string" && metadata.name.trim()
        ? metadata.name.trim()
        : workspaceNameFromSlug(slug);
    const description =
      typeof metadata.description === "string" && metadata.description.trim()
        ? metadata.description.trim()
        : null;

    const [workspace] = await db
      .insert(workspaces)
      .values({
        name,
        slug,
        description,
        storagePath: paths.root
      })
      .returning();

    await writeWorkspaceMetadata(paths, {
      ...metadata,
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      description: workspace.description,
      storagePath: workspace.storagePath,
      createdAt:
        typeof metadata.createdAt === "string" && metadata.createdAt
          ? metadata.createdAt
          : workspace.createdAt.toISOString()
    });

    inserted.push(workspace);
  }

  return inserted;
}

async function withDatabase<T>(
  config: ApiConfig,
  operation: (client: DatabaseClient) => Promise<T>
) {
  const client = openDatabase(config);

  try {
    return await operation(client);
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }

    throw new HttpError(
      503,
      "Database is not reachable. Start PostgreSQL and run migrations first."
    );
  } finally {
    await client.close();
  }
}

export async function listWorkspaces(config: ApiConfig) {
  return withDatabase(config, async ({ db }) => {
    const existingWorkspaces = await db.select().from(workspaces).orderBy(workspaces.createdAt);

    if (existingWorkspaces.length > 0) {
      return existingWorkspaces;
    }

    await syncWorkspacesFromStorage(config, db);

    return db.select().from(workspaces).orderBy(workspaces.createdAt);
  });
}

export async function getWorkspaceById(config: ApiConfig, workspaceId: string) {
  return withDatabase(config, async ({ db }) => {
    const [workspace] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);

    if (!workspace) {
      throw new HttpError(404, "Workspace not found.");
    }

    return workspace;
  });
}

export async function createWorkspace(
  config: ApiConfig,
  input: CreateWorkspaceInput
) {
  const name = input.name.trim();

  if (!name) {
    throw new HttpError(400, "Workspace name is required.");
  }

  await ensureStorageRoot(config.storageRoot);
  const slug = slugify(name);
  const paths = await ensureWorkspaceStorage(config.storageRoot, slug);

  return withDatabase(config, async ({ db }) => {
    const [workspace] = await db
      .insert(workspaces)
      .values({
        name,
        slug,
        description: input.description?.trim() || null,
        storagePath: paths.root
      })
      .returning();

    await writeWorkspaceMetadata(paths, {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      description: workspace.description,
      storagePath: workspace.storagePath,
      createdAt: workspace.createdAt.toISOString()
    });

    return workspace;
  });
}

export async function updateWorkspace(
  config: ApiConfig,
  workspaceSlugInput: string,
  input: UpdateWorkspaceInput
) {
  const workspaceSlug = slugify(workspaceSlugInput);
  const name = input.name.trim();

  if (!workspaceSlug || !name) {
    throw new HttpError(400, "Workspace name is required.");
  }

  return withDatabase(config, async ({ db }) => {
    const [existingWorkspace] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.slug, workspaceSlug))
      .limit(1);

    if (!existingWorkspace) {
      throw new HttpError(404, "Workspace not found.");
    }

    const [workspace] = await db
      .update(workspaces)
      .set({
        name,
        description: input.description?.trim() || null,
        updatedAt: new Date()
      })
      .where(eq(workspaces.id, existingWorkspace.id))
      .returning();

    const paths = await ensureWorkspaceStorage(config.storageRoot, workspace.slug);
    let metadata: Record<string, unknown> = {};
    try {
      metadata = await readWorkspaceMetadata(paths);
    } catch {
      // Metadata is created below if this is an older workspace.
    }
    await writeWorkspaceMetadata(paths, {
      ...metadata,
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      description: workspace.description,
      storagePath: workspace.storagePath,
      updatedAt: workspace.updatedAt.toISOString()
    });

    return workspace;
  });
}

export async function createWorkspaceExportManifest(
  config: ApiConfig,
  workspaceId: string
): Promise<WorkspaceExportManifest> {
  const workspace = await getWorkspaceById(config, workspaceId);
  const paths = getWorkspaceStoragePaths(config.storageRoot, workspace.slug);
  await ensureWorkspaceStorage(config.storageRoot, workspace.slug);

  const manifest: WorkspaceExportManifest = {
    version: 1,
    exportedAt: new Date().toISOString(),
    workspace: {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      description: workspace.description,
      storagePath: workspace.storagePath
    },
    storage: {
      originals: paths.originals,
      markdown: paths.markdown,
      metadata: paths.metadata
    },
    databaseDump: {
      included: false,
      note: "Sprint 3 export skeleton only writes the manifest. Zip and pg_dump are planned for Sprint 12."
    }
  };

  await writeWorkspaceMetadata(paths, {
    ...manifest.workspace,
    lastExportManifest: manifest
  });

  return manifest;
}

export async function importWorkspaceSkeleton(
  config: ApiConfig,
  input: CreateWorkspaceInput
) {
  const workspace = await createWorkspace(config, input);

  return {
    imported: false,
    workspace,
    note: "Sprint 3 import skeleton creates the target workspace. Zip restore and database replay are planned for Sprint 12."
  };
}
