# Small-model layers

Three independently selectable task models are available under `/settings`:

| Role | Model family | Authority | Fallback |
| --- | --- | --- | --- |
| Chunk entity linker | LLM | May link an exact copied mention only to an existing document entity | Exact and alias links remain |
| Retrieval reranker | LLM | May reorder at most 12 allow-listed chunk IDs | Lexical overlap reranker |
| Metadata field matcher | Embedding | May recommend a compatible existing field | Trigram match or a new field |

The entity linker cannot create fields, entities, aliases, or corrected mention text.
Its output must contain an allowed chunk/entity pair, an exact substring from the
chunk, confidence of at least `0.88`, and a deterministic name-compatibility match.

The metadata matcher runs only after exact/alias and conservative trigram matching.
Unrelated keys do not trigger model work. Semantic matching requires compatible
value types, cosine similarity of at least `0.86`, and a margin of at least `0.05`
over the second candidate.

Changing the entity-linker model marks indexed documents as stale. The reranker
selection applies immediately. The field matcher applies only to future metadata
field discovery; it does not rescan historical YAML files.

Runtime attempt, success, fallback, and accepted-result counters are exposed by
`GET /api/settings/models` and displayed in the Small models settings tab.
