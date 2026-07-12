# Vision

## KnowledgeOS Nedir?

KnowledgeOS, yerel çalışan bir bilgi işletim sistemidir.

Belge saklama sistemi değildir. Belgeden bilgi çıkaran, bilgileri ilişkilendiren ve kullanıcıya kaynaklı cevap veren bir sistemdir.

## Problem

Klasik RAG sistemleri şu akışla çalışır:

```text
Belge
↓
Chunk
↓
Embedding
↓
Vector Search
↓
LLM
```

Bu yapı özetleme ve anlamsal sorgularda faydalıdır. Ancak kesin arşiv sorgularında yetersizdir.

Örneğin:

```text
Ali Çobanoğlu hangi belgelerde geçiyor?
```

Bu soru LLM tahminiyle cevaplanmamalıdır. Veritabanı üzerinden kesin aranmalıdır.

## Çözüm

KnowledgeOS üç motoru birleştirir:

1. Knowledge Engine
2. Search Engine
3. AI Engine

## Temel Prensipler

### AI yardımcıdır, karar verici değildir

Kişi hangi belgelerde geçiyor gibi sorular SQL/entity search ile çözülür. LLM sadece sonucu açıklar.

### Her cevap kaynaklıdır

Cevap yanında kullanılan belgeler ve evidence snippet gösterilir.

### Her AI çıktısı düzeltilebilir

Kullanıcı alias ekleyebilir, entity birleştirebilir, yanlış ilişkiyi düzeltebilir.

### Local-first

Veri dışarı çıkmaz.

## İlk Kullanım Senaryosu

Eski Türkçe hukuk/arşiv belgeleri.

Ancak sistem geneldir:

- Hukuk arşivi
- Tapu/parsel belgeleri
- Belediye evrakları
- Teknik dokümantasyon
- Maden/laboratuvar belgeleri
- Kişisel bilgi yönetimi
