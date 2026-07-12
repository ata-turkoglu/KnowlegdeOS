"use client";

import { useState } from "react";
import { AButton, ADropdown, AInput } from "../components/ui";
import { useWorkspace } from "./workspace-context";

type WorkspaceOption = {
  label: string;
  value: string;
};

export function WorkspaceSwitcher() {
  const {
    workspaceSlug,
    setWorkspaceSlug,
    workspaces,
    isLoading,
    error,
    createWorkspace
  } = useWorkspace();
  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const options: WorkspaceOption[] = workspaces.map((workspace) => ({
    label: workspace.name,
    value: workspace.slug
  }));

  async function handleCreateWorkspace() {
    const trimmedName = name.trim();

    if (!trimmedName) {
      setMessage("Workspace adi gerekli.");
      return;
    }

    setIsSaving(true);
    setMessage("");

    try {
      const workspace = await createWorkspace({
        name: trimmedName,
        description: description.trim() || undefined
      });

      setName("");
      setDescription("");
      setIsCreating(false);
      setMessage(`${workspace.name} olusturuldu.`);
    } catch (createError) {
      setMessage(
        createError instanceof Error
          ? createError.message
          : "Workspace olusturulamadi."
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="workspace-switcher">
      <div className="workspace-switcher__row">
        <ADropdown
          value={workspaceSlug}
          options={options}
          onChange={(event) => setWorkspaceSlug(String(event.value))}
          placeholder={isLoading ? "Workspace yukleniyor..." : "Workspace sec"}
          disabled={isLoading || options.length === 0}
          className="workspace-switcher__dropdown"
        />
        <AButton
          type="button"
          aria-label="Yeni workspace ekle"
          className="workspace-switcher__add"
          onClick={() => {
            setIsCreating((current) => !current);
            setMessage("");
          }}
        >
          <span className="pi pi-plus" aria-hidden="true" />
        </AButton>
      </div>

      {isCreating ? (
        <div className="workspace-switcher__form">
          <label>
            Workspace adi
            <AInput
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Yeni workspace"
            />
          </label>
          <label>
            Aciklama
            <AInput
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Opsiyonel"
            />
          </label>
          <AButton type="button" onClick={handleCreateWorkspace} disabled={isSaving}>
            {isSaving ? "Olusturuluyor..." : "Olustur"}
          </AButton>
        </div>
      ) : null}
      {error ? <p className="form-message">{error}</p> : null}
      {message ? <p className="form-message">{message}</p> : null}
    </div>
  );
}
