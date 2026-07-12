"use client";

import { useState } from "react";
import { AButton, ADropdown, AInput } from "../components/ui";
import { useLanguage } from "./language-context";
import { useWorkspace } from "./workspace-context";

type WorkspaceOption = {
  label: string;
  value: string;
};

export function WorkspaceSwitcher() {
  const { language } = useLanguage();
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
      setMessage(language === "en" ? "Workspace name is required." : "Workspace adı gerekli.");
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
      setMessage(language === "en" ? `${workspace.name} was created.` : `${workspace.name} oluşturuldu.`);
    } catch (createError) {
      setMessage(
        createError instanceof Error
          ? createError.message
          : language === "en"
            ? "Workspace could not be created."
            : "Workspace oluşturulamadı."
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
          placeholder={isLoading ? (language === "tr" ? "Workspace yukleniyor..." : "Loading workspaces...") : language === "tr" ? "Workspace sec" : "Select workspace"}
          disabled={isLoading || options.length === 0}
          className="workspace-switcher__dropdown"
        />
        <AButton
          type="button"
          aria-label={language === "tr" ? "Yeni workspace ekle" : "Add workspace"}
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
            {language === "tr" ? "Workspace adi" : "Workspace name"}
            <AInput
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={language === "tr" ? "Yeni workspace" : "New workspace"}
            />
          </label>
          <label>
            {language === "tr" ? "Aciklama" : "Description"}
            <AInput
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={language === "tr" ? "Opsiyonel" : "Optional"}
            />
          </label>
          <AButton type="button" onClick={handleCreateWorkspace} disabled={isSaving}>
            {isSaving ? (language === "tr" ? "Olusturuluyor..." : "Creating...") : language === "tr" ? "Olustur" : "Create"}
          </AButton>
        </div>
      ) : null}
      {error ? <p className="form-message">{error}</p> : null}
      {message ? <p className="form-message">{message}</p> : null}
    </div>
  );
}
