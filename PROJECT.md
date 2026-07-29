# KnowledgeOS Proje Rehberi

Bu belge proje yapısı, çalışma kuralları ve temel süreçler için ana giriş noktasıdır. Ayrıntılı konu belgeleri `docs/` altında tutulur; burada yazan kurallar tüm proje için geçerlidir.

## Amaç

KnowledgeOS; taranmış arşiv belgelerini düzenli Markdown içeriğine dönüştüren, entity ve ilişkileri çıkaran, PostgreSQL/pgvector üzerinde indeksleyen ve kaynak gösteren RAG yanıtları üreten local-first bir bilgi yönetim sistemidir.

## Proje Yapısı

- `apps/api`: Fastify API, chat/RAG orkestrasyonu, belge ve workspace servisleri.
- `apps/web`: Next.js kullanıcı arayüzü.
- `packages/ai`: LLM sağlayıcıları ve prompt yardımcıları.
- `packages/database`: Drizzle şeması, migration ve veritabanı erişimi.
- `packages/ingestion`: normalize, chunk ve bilgi çıkarım süreci.
- `packages/search`: sorgu sınıflandırma ve arama yardımcıları.
- `packages/shared`: API ve UI tarafından ortak kullanılan tipler ile kanonik süreç tanımları.
- `storage/workspaces`: workspace’e ait orijinal, Markdown ve metadata dosyaları.
- `docs`: ayrıntılı mimari ve işletim belgeleri.

## Zorunlu Geliştirme Kuralları

1. Orijinal belgeler kanıt olarak korunur; indekslenen çalışma kopyası Markdown’dır.
2. Her veri işlemi workspace sınırı içinde kalmalıdır.
3. Kullanıcıya yalnızca citation ve groundedness kontrolünden geçen chat yanıtı gönderilir.
4. Veritabanı değişiklikleri migration ile yapılır; mevcut migration dosyaları geriye dönük değiştirilmez.
5. API ile UI arasında paylaşılan durumlar ve tipler `packages/shared` içinde tanımlanır.
6. Chat akışı değiştirildiğinde `chatWorkflowStages` tanımı da aynı değişiklik içinde güncellenir.
7. Üretilmiş mimari dosyaları elle düzenlenmez; üretim komutu kullanılır.
8. Değişiklikler en az `pnpm typecheck` ve ilgili testlerle doğrulanır.

## Belge Yükleme Süreci

```text
Orijinal PDF/görsel
  → OCR ve düzenli Markdown
  → normalize ve chunk
  → entity/alias/ilişki çıkarımı
  → embedding ve full-text index
  → PostgreSQL + pgvector
```

## Chat/RAG Süreci

Chat akışının tek doğruluk kaynağı:

- `packages/shared/src/chat-workflow.ts`: Backend event’lerinin, frontend durum şemasının ve dokümantasyonun kullandığı kanonik tanım.
- `docs/chat-workflow.mmd`: Kanonik tanımdan üretilen güncel Mermaid şeması.

Akış genel olarak sorgu sınıflandırma, paralel entity/lexical/semantic retrieval, RRF birleştirme, reranking, context oluşturma, LLM üretimi, kaynak doğrulama, geçmişe kaydetme ve kullanıcıya iletme aşamalarından oluşur.

Şemayı güncellemek:

```bash
corepack pnpm docs:generate
```

Şemanın koddan geri kalmadığını kontrol etmek:

```bash
corepack pnpm docs:check
```

`verify` komutu bu kontrolü otomatik çalıştırır. Chat akışında bir aşama eklendiğinde veya kaldırıldığında kanonik TypeScript tanımı değiştirilir ve Mermaid dosyası yeniden üretilir.

## Chat İlerleme Protokolü

Streaming chat endpoint’i `progress` adlı SSE event’leri yayınlar. Her event kanonik tanımda bulunan bir `stage` kimliği taşır. Arayüz yalnızca aldığı gerçek event’leri aktif veya tamamlanmış gösterir; atlanan işlemler tamamlandı varsayılmaz.

Yanıt istemciye aktarılmadan önce:

1. Kaynaklar seçilir ve token bütçesine sığdırılır.
2. Yanıt üretilir.
3. Citation, sayısal değer ve kaynak desteği doğrulanır.
4. Gerekirse kontrollü tekrar veya tek güçlü kanıt fallback’i uygulanır.
5. Doğrulanmış yanıt kaydedilir ve gönderilir.

## Temel Komutlar

```bash
corepack pnpm dev
corepack pnpm typecheck
corepack pnpm build
corepack pnpm test
corepack pnpm verify
```

## Ayrıntılı Belgeler

- `docs/02-Architecture.md`: Genel sistem ve dosya saklama mimarisi.
- `docs/04-Database.md`: Veritabanı yapısı.
- `docs/05-Ingestion-Engine.md`: Belge işleme süreci.
- `docs/07-Search-Engine.md`: Arama yaklaşımı.
- `docs/08-AI-Engine.md`: AI sağlayıcıları ve üretim.
- `docs/09-Frontend.md`: Arayüz yapısı.
- `docs/10-Backend.md`: Backend yapısı.
- `docs/11-API.md`: API sözleşmeleri.
- `docs/12-Coding-Standards.md`: Kodlama standartları.

