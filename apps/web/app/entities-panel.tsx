"use client";

import { useEffect, useState } from "react";
import { AButton, ADropdown, AInput } from "../components/ui";
import { useWorkspace } from "./workspace-context";
import { useLanguage } from "./language-context";

const apiBaseUrl = "http://127.0.0.1:4000";

type EntityAlias = {
  alias: string;
  normalizedAlias: string;
  confidence: number;
  source: "REGEX" | "FRONTMATTER" | "USER" | "IMPORT";
};

type EntityDocument = {
  documentName: string;
  title: string;
  mentionCount: number;
  maxChunkMentions: number;
  confidence: number;
  evidenceSnippet: string;
};

type EntityItem = {
  id: string;
  workspaceSlug: string;
  fieldId: string;
  fieldKey: string;
  fieldLabel: string;
  canonicalValue: string;
  aliases: EntityAlias[];
  documents: EntityDocument[];
  updatedAt: string;
};

type WorkspaceField = {
  id: string;
  key: string;
  label: string;
  valueType: string;
  filterable: boolean;
  entityEnabled: boolean;
  entityCount: number;
  documentCount: number;
};

export function EntitiesPanel() {
  const { language } = useLanguage();
  const isEnglish = language === "en";
  const { workspaceSlug } = useWorkspace();
  const [entities, setEntities] = useState<EntityItem[]>([]);
  const [fields, setFields] = useState<WorkspaceField[]>([]);
  const [selectedEntityId, setSelectedEntityId] = useState("");
  const [mergeSourceId, setMergeSourceId] = useState("");
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [newAlias, setNewAlias] = useState("");
  const [message, setMessage] = useState(isEnglish ? "Loading..." : "Yükleniyor...");
  const [isLoading, setIsLoading] = useState(false);
  const [activeAction, setActiveAction] = useState("");

  const selectedEntity =
    entities.find((entity) => entity.id === selectedEntityId) ?? entities[0];

  const entityOptions = entities.map((entity) => ({
    label: `${entity.fieldLabel}: ${entity.canonicalValue}`,
    value: entity.id
  }));
  const mergeTargetOptions = entities.filter((entity) =>
    !mergeSourceId || entity.fieldId === entities.find((item) => item.id === mergeSourceId)?.fieldId
  ).map((entity) => ({ label: `${entity.fieldLabel}: ${entity.canonicalValue}`, value: entity.id }));

  function updateEntityState(nextEntities: EntityItem[], preferredId = "") {
    setEntities(nextEntities);
    setSelectedEntityId((current) => {
      if (preferredId && nextEntities.some((entity) => entity.id === preferredId)) {
        return preferredId;
      }

      return nextEntities.some((entity) => entity.id === current)
        ? current
        : nextEntities[0]?.id ?? "";
    });
    setMergeSourceId(nextEntities[0]?.id ?? "");
    setMergeTargetId(nextEntities[1]?.id ?? "");
  }

  async function loadEntities(nextWorkspaceSlug = workspaceSlug) {
    setIsLoading(true);
    setMessage("");

    const [response, fieldResponse] = await Promise.all([
      fetch(`${apiBaseUrl}/api/entities?workspaceSlug=${encodeURIComponent(nextWorkspaceSlug)}`),
      fetch(`${apiBaseUrl}/api/workspaces/${encodeURIComponent(nextWorkspaceSlug)}/fields`)
    ]);
    const [body, fieldBody] = await Promise.all([response.json(), fieldResponse.json()]);

    setIsLoading(false);

    if (!response.ok) {
      setMessage(body.error ?? (isEnglish ? "Entity list could not be loaded." : "Varlık listesi alınamadı."));
      return;
    }

    updateEntityState(body);
    if (fieldResponse.ok) setFields(fieldBody);
    setMessage("");
  }

  async function rebuildEntities() {
    setActiveAction("rebuild");
    setMessage("");

    const response = await fetch(
      `${apiBaseUrl}/api/entities/rebuild?workspaceSlug=${encodeURIComponent(
        workspaceSlug
      )}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: "{}"
      }
    );
    const body = await response.json();

    setActiveAction("");

    if (!response.ok) {
      setMessage(body.error ?? (isEnglish ? "Entity index could not be rebuilt." : "Varlık indeksi yenilenemedi."));
      return;
    }

    updateEntityState(body.entities);
    setMessage(isEnglish ? `${body.entities.length} entities rebuilt.` : `${body.entities.length} varlık yeniden oluşturuldu.`);
  }

  async function addAlias() {
    const alias = newAlias.trim();

    if (!selectedEntity || !alias) {
      setMessage(isEnglish ? "An alias and an entity must be selected." : "Takma ad ve varlık seçimi gerekli.");
      return;
    }

    setActiveAction("alias");
    setMessage("");

    const response = await fetch(
      `${apiBaseUrl}/api/entities/${encodeURIComponent(
        selectedEntity.id
      )}/aliases?workspaceSlug=${encodeURIComponent(workspaceSlug)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8"
        },
        body: JSON.stringify({ alias })
      }
    );
    const body = await response.json();

    setActiveAction("");

    if (!response.ok) {
      setMessage(body.error ?? (isEnglish ? "Alias could not be added." : "Takma ad eklenemedi."));
      return;
    }

    setNewAlias("");
    setEntities((current) =>
      current.map((entity) => (entity.id === body.id ? body : entity))
    );
    setSelectedEntityId(body.id);
    setMessage(isEnglish ? `${alias} was added as an alias.` : `${alias} takma ad olarak eklendi.`);
  }

  async function removeAlias(alias: EntityAlias) {
    if (!selectedEntity) {
      return;
    }

    setActiveAction(`remove-alias-${alias.normalizedAlias}`);
    setMessage("");

    const response = await fetch(
      `${apiBaseUrl}/api/entities/${encodeURIComponent(selectedEntity.id)}/aliases/${encodeURIComponent(alias.normalizedAlias)}?workspaceSlug=${encodeURIComponent(workspaceSlug)}`,
      { method: "DELETE" }
    );
    const body = await response.json();

    setActiveAction("");

    if (!response.ok) {
      setMessage(body.error ?? (isEnglish ? "Alias could not be removed." : "Takma ad silinemedi."));
      return;
    }

    setEntities((current) => current.map((entity) => (entity.id === body.id ? body : entity)));
    setMessage(isEnglish ? `${alias.alias} was removed.` : `${alias.alias} silindi.`);
  }

  async function mergeSelectedEntities() {
    if (!mergeSourceId || !mergeTargetId || mergeSourceId === mergeTargetId) {
      setMessage(isEnglish ? "Choose two different entities to merge." : "Birleştirmek için iki farklı varlık seçilmeli.");
      return;
    }

    setActiveAction("merge");
    setMessage("");

    const response = await fetch(
      `${apiBaseUrl}/api/entities/merge?workspaceSlug=${encodeURIComponent(
        workspaceSlug
      )}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8"
        },
        body: JSON.stringify({
          sourceEntityId: mergeSourceId,
          targetEntityId: mergeTargetId
        })
      }
    );
    const body = await response.json();

    setActiveAction("");

    if (!response.ok) {
      setMessage(body.error ?? (isEnglish ? "Entity merge failed." : "Varlık birleştirme başarısız."));
      return;
    }

    await loadEntities(workspaceSlug);
    setSelectedEntityId(body.id);
    setMessage(isEnglish ? `Entities merged under ${body.canonicalValue}.` : `Varlıklar ${body.canonicalValue} altında birleştirildi.`);
  }

  useEffect(() => {
    void loadEntities(workspaceSlug);
  }, [workspaceSlug]);

  return (
    <section className="panel entities-panel">
      <div className="entities-header">
        <div>
          <p className="eyebrow">{isEnglish ? "Entity management" : "Varlık yönetimi"}</p>
          <h3>{isEnglish ? "Entities" : "Varlıklar"} ({entities.length})</h3>
        </div>
        <div className="entities-toolbar">
          <div className="button-row">
            <AButton type="button" onClick={() => loadEntities()} disabled={isLoading}>
              {isLoading ? (isEnglish ? "Loading..." : "Yükleniyor...") : isEnglish ? "Refresh" : "Yenile"}
            </AButton>
            <AButton
              type="button"
              tone="secondary"
              onClick={rebuildEntities}
              disabled={Boolean(activeAction)}
            >
              {activeAction === "rebuild" ? (isEnglish ? "Processing..." : "İşleniyor...") : isEnglish ? "Rebuild" : "Yeniden oluştur"}
            </AButton>
          </div>
        </div>
      </div>

      <div className="entities-layout">
        <div className="entity-list">
          {entities.map((entity) => (
            <AButton
              key={entity.id}
              type="button"
              tone="secondary"
              className={entity.id === selectedEntity?.id ? "entity-card active" : "entity-card"}
              onClick={() => setSelectedEntityId(entity.id)}
            >
              <span>{entity.fieldLabel}</span>
              <strong>{entity.canonicalValue}</strong>
              <small>
                {entity.aliases.length} {isEnglish ? "aliases" : "takma ad"} · {entity.documents.length} {isEnglish ? "documents" : "belge"}
              </small>
            </AButton>
          ))}
        </div>

        <div className="entity-detail">
          {selectedEntity ? (
            <>
              <div className="entity-heading">
                <span>{selectedEntity.fieldLabel}</span>
                <strong>{selectedEntity.canonicalValue}</strong>
              </div>

              <div className="alias-editor">
                <AInput
                  value={newAlias}
                  placeholder={isEnglish ? "New alias" : "Yeni alias"}
                  onChange={(event) => setNewAlias(event.target.value)}
                />
                <AButton
                  type="button"
                  onClick={addAlias}
                  disabled={activeAction === "alias"}
                >
                  {activeAction === "alias" ? (isEnglish ? "Adding..." : "Ekleniyor...") : isEnglish ? "Add alias" : "Alias ekle"}
                </AButton>
              </div>

              <div className="alias-list">
                {selectedEntity.aliases.map((alias) => (
                  <span key={alias.normalizedAlias}>
                    {alias.alias} · {alias.source}
                    {alias.source === "USER" ? (
                      <button
                        className="alias-delete"
                        type="button"
                        onClick={() => void removeAlias(alias)}
                        disabled={Boolean(activeAction)}
                        aria-label={isEnglish ? `${alias.alias} aliasını sil` : `${alias.alias} takma adını sil`}
                        title={isEnglish ? "Remove alias" : "Takma adı sil"}
                      >
                        <i className="pi pi-times" aria-hidden="true" />
                      </button>
                    ) : null}
                  </span>
                ))}
              </div>

              <div className="entity-documents">
                {selectedEntity.documents.map((document) => (
                  <article key={document.documentName}>
                    <strong>{document.documentName}</strong>
                    <span>
                      {document.title} · {document.mentionCount} {isEnglish ? "mentions" : "geçiş"} · {isEnglish ? "peak" : "en yoğun chunk"} {document.maxChunkMentions}
                    </span>
                    <p>{document.evidenceSnippet}</p>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <p className="empty-state">{isEnglish ? "There are no entities in this workspace." : "Bu çalışma alanında varlık yok."}</p>
          )}
        </div>
      </div>

      <div className="merge-panel">
        <div>
          <p className="eyebrow">{isEnglish ? "Merge" : "Birleştir"}</p>
          <strong>{isEnglish ? "Merge entities" : "Varlık birleştirme"}</strong>
        </div>
        <label>
          {isEnglish ? "Source" : "Kaynak"}
          <ADropdown
            value={mergeSourceId}
            options={entityOptions}
            onChange={(event) => setMergeSourceId(event.value)}
            placeholder={isEnglish ? "Source entity" : "Kaynak varlık"}
          />
        </label>
        <label>
          {isEnglish ? "Target" : "Hedef"}
          <ADropdown
            value={mergeTargetId}
            options={mergeTargetOptions}
            onChange={(event) => setMergeTargetId(event.value)}
            placeholder={isEnglish ? "Target entity" : "Hedef varlık"}
          />
        </label>
        <AButton
          type="button"
          tone="secondary"
          onClick={mergeSelectedEntities}
          disabled={
            entities.length < 2 ||
            Boolean(activeAction) ||
            mergeSourceId === mergeTargetId
          }
        >
          {activeAction === "merge" ? (isEnglish ? "Merging..." : "Birleştiriliyor...") : isEnglish ? "Merge" : "Birleştir"}
        </AButton>
      </div>

      <div className="merge-panel">
        <div>
          <p className="eyebrow">{isEnglish ? "Metadata catalog" : "Metadata kataloğu"}</p>
          <strong>{fields.length} {isEnglish ? "dynamic fields" : "dinamik alan"}</strong>
        </div>
        {fields.map((field) => (
          <span key={field.id}>
            {field.label} · {field.valueType} · {field.entityCount} {isEnglish ? "entities" : "varlık"} · {field.documentCount} {isEnglish ? "documents" : "belge"}
          </span>
        ))}
      </div>

      {message ? <p className="form-message">{message}</p> : null}
    </section>
  );
}
