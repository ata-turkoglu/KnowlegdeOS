"use client";

import { useEffect, useState } from "react";
import { AButton, ADropdown, AInput } from "../components/ui";
import { useWorkspace } from "./workspace-context";

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
  occurrenceCount: number;
  confidence: number;
  evidenceSnippet: string;
};

type EntityItem = {
  id: string;
  workspaceSlug: string;
  type: string;
  canonicalValue: string;
  aliases: EntityAlias[];
  documents: EntityDocument[];
  updatedAt: string;
};

export function EntitiesPanel() {
  const { workspaceSlug } = useWorkspace();
  const [entities, setEntities] = useState<EntityItem[]>([]);
  const [selectedEntityId, setSelectedEntityId] = useState("");
  const [mergeSourceId, setMergeSourceId] = useState("");
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [newAlias, setNewAlias] = useState("");
  const [message, setMessage] = useState("Yukleniyor...");
  const [isLoading, setIsLoading] = useState(false);
  const [activeAction, setActiveAction] = useState("");

  const selectedEntity =
    entities.find((entity) => entity.id === selectedEntityId) ?? entities[0];

  const entityOptions = entities.map((entity) => ({
    label: entity.canonicalValue,
    value: entity.id
  }));

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

    const response = await fetch(
      `${apiBaseUrl}/api/entities?workspaceSlug=${encodeURIComponent(
        nextWorkspaceSlug
      )}`
    );
    const body = await response.json();

    setIsLoading(false);

    if (!response.ok) {
      setMessage(body.error ?? "Entity listesi alinamadi.");
      return;
    }

    updateEntityState(body);
    setMessage(`${body.length} entity listelendi.`);
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
      setMessage(body.error ?? "Entity index yenilenemedi.");
      return;
    }

    updateEntityState(body.entities);
    setMessage(`${body.entities.length} entity yeniden olusturuldu.`);
  }

  async function addAlias() {
    const alias = newAlias.trim();

    if (!selectedEntity || !alias) {
      setMessage("Alias ve entity secimi gerekli.");
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
      setMessage(body.error ?? "Alias eklenemedi.");
      return;
    }

    setNewAlias("");
    setEntities((current) =>
      current.map((entity) => (entity.id === body.id ? body : entity))
    );
    setSelectedEntityId(body.id);
    setMessage(`${alias} alias olarak eklendi.`);
  }

  async function mergeSelectedEntities() {
    if (!mergeSourceId || !mergeTargetId || mergeSourceId === mergeTargetId) {
      setMessage("Birlestirmek icin iki farkli entity secilmeli.");
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
      setMessage(body.error ?? "Entity merge basarisiz.");
      return;
    }

    await loadEntities(workspaceSlug);
    setSelectedEntityId(body.id);
    setMessage(`${body.canonicalValue} altinda entity merge tamamlandi.`);
  }

  useEffect(() => {
    void loadEntities(workspaceSlug);
  }, [workspaceSlug]);

  return (
    <section className="panel entities-panel">
      <div>
        <p className="eyebrow">Entity yonetimi</p>
        <h3>Entities</h3>
      </div>

      <div className="entities-toolbar">
        <div className="button-row">
          <AButton type="button" onClick={() => loadEntities()} disabled={isLoading}>
            {isLoading ? "Yukleniyor..." : "Yenile"}
          </AButton>
          <AButton
            type="button"
            tone="secondary"
            onClick={rebuildEntities}
            disabled={Boolean(activeAction)}
          >
            {activeAction === "rebuild" ? "Isleniyor..." : "Rebuild"}
          </AButton>
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
              <span>{entity.type}</span>
              <strong>{entity.canonicalValue}</strong>
              <small>
                {entity.aliases.length} alias · {entity.documents.length} belge
              </small>
            </AButton>
          ))}
        </div>

        <div className="entity-detail">
          {selectedEntity ? (
            <>
              <div className="entity-heading">
                <span>{selectedEntity.type}</span>
                <strong>{selectedEntity.canonicalValue}</strong>
              </div>

              <div className="alias-editor">
                <AInput
                  value={newAlias}
                  placeholder="Yeni alias"
                  onChange={(event) => setNewAlias(event.target.value)}
                />
                <AButton
                  type="button"
                  onClick={addAlias}
                  disabled={activeAction === "alias"}
                >
                  {activeAction === "alias" ? "Ekleniyor..." : "Alias ekle"}
                </AButton>
              </div>

              <div className="alias-list">
                {selectedEntity.aliases.map((alias) => (
                  <span key={alias.normalizedAlias}>
                    {alias.alias} · {alias.source}
                  </span>
                ))}
              </div>

              <div className="entity-documents">
                {selectedEntity.documents.map((document) => (
                  <article key={document.documentName}>
                    <strong>{document.documentName}</strong>
                    <span>
                      {document.title} · {document.occurrenceCount} kayit
                    </span>
                    <p>{document.evidenceSnippet}</p>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <p className="empty-state">Bu workspace icinde entity yok.</p>
          )}
        </div>
      </div>

      <div className="merge-panel">
        <div>
          <p className="eyebrow">Merge</p>
          <strong>Entity birlestirme</strong>
        </div>
        <label>
          Source
          <ADropdown
            value={mergeSourceId}
            options={entityOptions}
            onChange={(event) => setMergeSourceId(event.value)}
            placeholder="Kaynak entity"
          />
        </label>
        <label>
          Target
          <ADropdown
            value={mergeTargetId}
            options={entityOptions}
            onChange={(event) => setMergeTargetId(event.value)}
            placeholder="Hedef entity"
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
          {activeAction === "merge" ? "Birlestiriliyor..." : "Merge"}
        </AButton>
      </div>

      {message ? <p className="form-message">{message}</p> : null}
    </section>
  );
}
