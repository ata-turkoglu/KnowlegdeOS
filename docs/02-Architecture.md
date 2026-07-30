# Architecture

## Hedef Çalışma Profili

KnowledgeOS, **tek bir bilgisayar üzerinde tek bir kullanıcı tarafından** çalıştırılacak yerel-öncelikli bir uygulamadır. Mimari kararlar, teknik öneriler ve model seçimleri aksi açıkça belirtilmedikçe bu kullanım profiline göre değerlendirilmelidir.

Bu nedenle önerilerde:

- kolay kurulum, bakım ve yedekleme; yatay ölçekleme ve dağıtık sistem tasarımından önce gelir
- aynı anda çok sayıda kullanıcı, yüksek istek trafiği veya çok kiracılı (multi-tenant) SaaS yükü varsayılmaz
- gereksiz mikroservis, kuyruk, cluster, load balancer, merkezi kimlik yönetimi ve rol tabanlı yetkilendirme katmanları önerilmez
- CPU, RAM, GPU, disk ve model belleği tek bilgisayarda paylaşılacağı için yerel kaynak tüketimi gözetilir
- yerel modellerde donanıma uygun en küçük yeterli model; bulut modellerinde ise yalnız gerekli adımlarda çağrılan düşük maliyetli model tercih edilir
- kalite artışı ölçülmeden daha büyük veya daha pahalı modele geçilmez; öneriler maliyet, gecikme ve işletim sadeliğini birlikte değerlendirmelidir
- güvenlik önerileri tek kullanıcı varsayımına rağmen API anahtarlarının korunmasını, yerel servislerin gereksiz yere ağa açılmamasını ve güvenli yedeklemeyi sürdürmelidir

Workspace yapısı çok kullanıcılı erişim kontrolü için değil; farklı arşivleri düzenlemek, veriyi izole tutmak ve export/import ile taşınabilirliği sağlamak için korunur.

## Genel Mimari

```text
Scanned Original Files
PDF / JPG / PNG / TIFF
        │
        ▼
External OCR / ChatGPT Markdown Conversion
        │
        ▼
Markdown Working Copy
        │
        ▼
KnowledgeOS Upload
        │
        ▼
Ingestion Engine
        ├── Normalize
        ├── Chunk
        ├── Deterministic extraction
        ├── LLM extraction
        ├── Alias resolution
        ├── Relationship extraction
        └── Embedding
        │
        ▼
PostgreSQL + pgvector
        │
        ▼
Search Engine
        ├── Entity Search
        ├── Full Text Search
        ├── Fuzzy Search
        ├── Semantic Search
        └── Hybrid Search
        │
        ▼
AI Engine
        │
        ▼
Next.js UI
```

## Workflow Haritası Bakımı

Uygulamadaki **Sistem Haritası** (`/architecture`) beş görünümü React Flow diyagramı olarak gösterir: Conversion, Upload & Indexing, Search, Chat ve Database Schema.

Bir değişiklik aşağıdakilerden birini etkiliyorsa ilgili diyagram düğümü, bağlantısı, karar kolu ve sağ-panel açıklaması aynı değişiklikte güncellenmelidir:

- API route veya istek doğrulaması
- deterministic/rule-based karar veya fallback
- yerel LLM rolü ya da seçilen model ayarı
- ana LLM üretimi, embedding veya retrieval davranışı
- veritabanı şeması veya tablo ilişkisi
- güvenlik, kanıt doğrulama, persistence ya da sonuç teslimi

Bu kuralın uygulama kaynağı `apps/web/app/architecture-map.tsx` dosyasıdır. Upload & Indexing tabı veritabanı **yazma** işlemlerini, Search ve Chat tabları veritabanı **okuma** işlemlerini, Database Schema tabı ise yalnız tablolar arası foreign-key ilişkilerini göstermelidir. Diyagramdaki **Yerel LLM** düğümleri ilgili canlı model ayarını `/api/settings/models` üzerinden göstermelidir; sabit model adı yazılmamalıdır.

### Canlı Sohbet İlerlemesi

Hybrid router veya API fallback değiştiğinde aynı güncellemede Chat tabındaki router/kol düğümleri, `/api/settings/models` içindeki yerel ve API reranker seçimi, çalışma zamanı telemetry'si ve canlı ilerleme açıklaması güncellenmelidir. API yoluna yalnız karar için gerekli, kısa ve güvenlikten geçirilmiş kanıt parçaları gönderilebilir; API hatası yerel yola güvenli biçimde düşmelidir.

Chat ekranındaki **Canlı RAG akışı**, `packages/shared/src/chat-workflow.ts` içindeki aşamaları ve API'nin SSE `progress` event'lerini kullanır. Chat workflow diyagramına yeni bir yürütme, karar, veri erişimi, yerel LLM veya güvenlik katmanı eklendiğinde; aynı değişiklikte bu aşama tanımı, `apps/api/src/services/chat.ts`/`apps/api/src/routes/chat.ts` event'i ve `apps/web/app/chat-progress-dialog.tsx` görünümü güncellenmelidir. Atlanan dallar event göndermemeli ve canlı ilerleme ekranında pasif kalmalıdır.

## Dosya Saklama Mimarisi

```text
storage/
  workspaces/
    merter-arsivi/
      originals/
        A-1.pdf
        A-1_page_001.jpg
      markdown/
        A-1_Baki_Toksal_Ali_Cobanoglu.md
      metadata/
        A-1.json
      exports/
      backups/
```

## Önemli Karar

Orijinal tarama dosyaları saklanır ama indekslenen ana içerik Markdown'dır.

Bu sayede:

- OCR hataları elle düzeltilebilir
- AI için temiz metin sağlanır
- Obsidian uyumu korunur
- Taşınabilirlik kolaylaşır

## Architecture Change Completion Rule

An architecture-affecting change is not complete until the relevant `/architecture` node, edge, and detail text are updated and checked. A new database table, claim/event type, evidence model, or LLM default must update the Upload & Indexing and Database Schema views in the same change.

## Workspace

Her arşiv ayrı workspace olabilir.

Örnek:

- Merter Arşivi
- Maden Analizleri
- Teknik Belgeler

Her workspace kendi belgelerine, entity'lerine, chat geçmişine ve ayarlarına sahiptir.

## Export / Import

Workspace zip olarak dışa aktarılabilmelidir.

```text
workspace-export.zip
  storage/
  database.dump
  config.json
  version.json
```
