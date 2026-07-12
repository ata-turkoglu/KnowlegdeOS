"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";

const apiBaseUrl = "http://127.0.0.1:4000";
const defaultWorkspaceSlug = "merter-arsivi";
const storageKey = "knowledgeos.workspaceSlug";

type WorkspaceItem = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  storagePath: string;
};

type WorkspaceContextValue = {
  workspaceSlug: string;
  setWorkspaceSlug: (slug: string) => void;
  workspaces: WorkspaceItem[];
  isLoading: boolean;
  error: string;
  reloadWorkspaces: () => Promise<void>;
  createWorkspace: (input: { name: string; description?: string }) => Promise<WorkspaceItem>;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

type WorkspaceProviderProps = {
  children: ReactNode;
};

export function WorkspaceProvider({ children }: WorkspaceProviderProps) {
  const [workspaceSlug, setWorkspaceSlugState] = useState(defaultWorkspaceSlug);
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const savedWorkspaceSlug = window.localStorage.getItem(storageKey);

    if (savedWorkspaceSlug) {
      setWorkspaceSlugState(savedWorkspaceSlug);
    }
  }, []);

  const setWorkspaceSlug = useCallback((slug: string) => {
    setWorkspaceSlugState(slug);
    window.localStorage.setItem(storageKey, slug);
  }, []);

  const reloadWorkspaces = useCallback(async () => {
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch(`${apiBaseUrl}/api/workspaces`);
      const body = (await response.json()) as WorkspaceItem[] | { error?: string };

      if (!response.ok || !Array.isArray(body)) {
        setError(
          !Array.isArray(body) && body.error
            ? body.error
            : "Workspace listesi alinamadi."
        );
        setWorkspaces([]);
        return;
      }

      setWorkspaces(body);

      if (body.length === 0) {
        setWorkspaceSlug(defaultWorkspaceSlug);
        return;
      }

      if (body.length === 1) {
        setWorkspaceSlug(body[0].slug);
        return;
      }

      const selectedWorkspaceExists = body.some(
        (workspace) => workspace.slug === workspaceSlug
      );

      if (!selectedWorkspaceExists) {
        const defaultWorkspace = body.find(
          (workspace) => workspace.slug === defaultWorkspaceSlug
        );

        setWorkspaceSlug(defaultWorkspace?.slug ?? body[0].slug);
      }
    } catch {
      setError("Workspace listesi alinamadi.");
      setWorkspaces([]);
    } finally {
      setIsLoading(false);
    }
  }, [setWorkspaceSlug, workspaceSlug]);

  useEffect(() => {
    void reloadWorkspaces();
  }, [reloadWorkspaces]);

  const createWorkspace = useCallback(
    async ({ name, description }: { name: string; description?: string }) => {
      const response = await fetch(`${apiBaseUrl}/api/workspaces`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8"
        },
        body: JSON.stringify({
          name,
          description
        })
      });
      const body = (await response.json()) as WorkspaceItem | { error?: string };

      if (!response.ok || Array.isArray(body) || !("slug" in body)) {
        const message =
          !Array.isArray(body) && "error" in body && body.error
            ? body.error
            : "Workspace olusturulamadi.";
        throw new Error(message);
      }

      await reloadWorkspaces();
      setWorkspaceSlug(body.slug);

      return body;
    },
    [reloadWorkspaces, setWorkspaceSlug]
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      workspaceSlug,
      setWorkspaceSlug,
      workspaces,
      isLoading,
      error,
      reloadWorkspaces,
      createWorkspace
    }),
    [createWorkspace, error, isLoading, reloadWorkspaces, setWorkspaceSlug, workspaceSlug, workspaces]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);

  if (!context) {
    throw new Error("useWorkspace must be used within WorkspaceProvider.");
  }

  return context;
}
