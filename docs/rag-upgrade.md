# RAG upgrade

Retrieval is workspace-scoped. Entity/alias lookup, pgvector similarity, and PostgreSQL full-text lexical lookup are separate plans; hybrid queries run entity and semantic retrieval in parallel. RRF fuses ranks without comparing provider scores. `RULE` relationships remain excluded from retrieval.

`NoopReranker` is the default offline fallback. Query rewriting, graph expansion, semantic caching, and external rerankers remain disabled until a provider and quality evaluation are configured. Integration tests require `TEST_DATABASE_URL` and reject any database name not ending `_test`.
