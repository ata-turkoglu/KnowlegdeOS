# Search Engine

## Query Types

### ENTITY_SEARCH

Kesin belge listeleme soruları.

Örnek:

```text
Ali Çobanoğlu hangi belgelerde geçiyor?
248 parsel hangi belgelerde var?
1988 tarihli belgeleri listele.
```

Bu sorularda vector search ana kaynak olmamalıdır.

### SEMANTIC_SEARCH

Anlamsal açıklama soruları.

```text
A-8 belgesini özetle.
248 parselde ne olmuş?
```

### HYBRID_SEARCH

Önce SQL, sonra vector/LLM.

```text
Ali Çobanoğlu geçen belgeleri özetle.
248 parsel geçen belgeleri karşılaştır.
```

## Query Router

MVP'de kural tabanlı başlayabilir.

Kurallar:

- "hangi belgelerde" → ENTITY_SEARCH
- "geçiyor mu" → ENTITY_SEARCH
- "listele" → ENTITY_SEARCH
- "özetle" → SEMANTIC_SEARCH veya HYBRID
- "karşılaştır" → HYBRID

## Entity Search

Arama kaynakları:

1. entities
2. entity_aliases
3. document_entities
4. full text search
5. trigram fuzzy search

## Source Transparency

Chat cevabında gösterilecekler:

- Query Type
- Matched Entity
- Matched Aliases
- Retrieved Documents
- Evidence Snippets
