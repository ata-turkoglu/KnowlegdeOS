# Codex Çalışma Kuralları

Bu dosya, Codex'in bu projede kullanıcıya cevap vermeden veya proje üzerinde işlem yapmadan önce okuyacağı ana çalışma kuralıdır.

## Cevaplamadan Önce

1. Önce bu dosyayı oku.
2. Sorunun konusu ile ilgili `PROJECT.md`, `README.md` ve `docs/` altındaki ilgili belgeleri oku.
3. Kullanıcı bir dosya veya kaynak metin belirtmişse onu doğrudan incele.
4. Cevabı varsayımla değil, incelenen dosya ve kaynaklardaki kanıtlarla oluştur.
5. Kullanıcı yalnızca soru sorduysa dosya, kod veya dış sistem üzerinde değişiklik yapma; yalnızca istenen değerlendirmeyi yap.
6. Kullanıcı değişiklik istediyse ilgili dosyaları düzenle, uygun kontrolleri çalıştır ve sonucu bildir.

## Proje İlkeleri

- KnowledgeOS local-first çalışır; gereksiz cloud, SaaS, mikroservis veya dağıtık mimari önerme.
- Orijinal belgeler kanıt olarak korunur; indekslenen çalışma içeriği Markdown'dır.
- Belge içeriği özetlenerek veya tahmin edilerek kaynak metnin yerine geçirilemez.
- OCR belirsizlikleri korunur; emin olunmayan bilgi uydurulmaz ve mümkünse `[okunamadı]` olarak işaretlenir.
- Türkçe ve tarihî yazımlar, kişi/kurum/yer adları ve resmî numaralar kaynakta göründüğü biçimde korunur.
- Kod ve metadata işlemleri workspace sınırında kalır.
- Veritabanı değişiklikleri migration ile yapılır; mevcut migration dosyaları geriye dönük değiştirilmez.
- Değişikliklerden sonra en az ilgili testler ve `corepack pnpm typecheck` çalıştırılır.

## Dinamik YAML Metadata

Metadata şeması tek bir belge türüne veya tek bir dosyaya sabitlenmez.

- Alan anahtarları workspace kapsamındaki dinamik `workspace_fields` kataloğundan yönetilir.
- YAML metadata tek bir düz metadata nesnesidir; değerler string, sayı, boolean veya basit listeler olabilir.
- Yeni ve gerçekten gerekli alanlar çalışma sırasında kanonikleştirilerek `workspace_fields` kataloğuna eklenir.
- Scalar/list tür çatışmaları değer kaybettirmeden genişletilir.
- Uzun Markdown bölümler hâlinde işlenir, sonuçlar tek düz metadata nesnesinde birleştirilir.
- YAML görünür yapılmadan önce anahtarlar doğrulanır; indeksleme YAML'ı yeniden LLM çağrısı yapmadan okur.
- Yeni alanlar tarihsel belgelerin otomatik olarak yeniden taranmasına neden olmaz.
- Sabit, dosyaya özel iç içe `records` şeması dayatılmaz. Belge içindeki tekrarların ilişkisi gerektiğinde düz alanlar, kaynak metin ve güven bilgisiyle korunur; genel dinamik model bozulmaz.
- Kişi, kurum, yer, tarih, parsel, dava/yevmiye ve benzeri alanlar yalnızca kaynakta açıkça görüldüğünde doldurulur.
- Dinamik alanlar sorgu sırasında katalog üzerinden doğrulanır; düşük güvenli LLM filtreleri gerektiğinde düşürülebilir, ancak kilitli tarihler, tanımlayıcılar ve kesin katalog eşleşmeleri korunur.

## YAML Kalite Kontrolü

Bir YAML çıktısını değerlendirirken şu kontroller yapılır:

1. Geçerli YAML/frontmatter veya üretim sözleşmesine uygun JSON olup olmadığı.
2. UTF-8 karakterlerin bozulup bozulmadığı.
3. Kaynakta olmayan bilgi, kişi, numara veya tarih eklenip eklenmediği.
4. Aynı listenin tekrar edip etmediği ve farklı alanların birbirine karışıp karışmadığı.
5. Belirsiz OCR bilgilerinin kesin bilgiye dönüştürülüp dönüştürülmediği.
6. `workspace_fields` kataloğuna uygun kanonik anahtarların kullanılıp kullanılmadığı.
7. YAML'ın gerçekten Markdown frontmatter olarak kaydedilip kaydedilmediği.
8. Metadata ile kaynak Markdown arasında anlamlı tutarsızlık bulunup bulunmadığı.

## Dokümantasyon ve Mimari

- Bir değişiklik mimariyi, ingestion'ı, aramayı, chat akışını, modeli, güvenliği veya veritabanını etkiliyorsa ilgili dokümantasyon da aynı değişiklikte güncellenir.
- Üretilmiş mimari dosyaları elle düzenlenmez; ilgili üretim komutu kullanılır.
- Chat workflow değişirse kanonik `chatWorkflowStages` tanımı ve ilgili diyagram/arayüz güncellenir.
- Chat yanıtları kaynak ve groundedness kontrolünden geçmeden kullanıcıya gönderilmez.

## İlgili Belgeler

Konuya göre gerektiğinde şu belgeler ayrıca okunmalıdır:

- `PROJECT.md`: proje genel kuralları ve süreçler
- `docs/02-Architecture.md`: mimari, workspace ve dosya saklama
- `docs/05-Ingestion-Engine.md`: Markdown ingestion ve çıkarım pipeline'ı
- `docs/08-AI-Engine.md`: AI sağlayıcıları ve prompt kuralları
- `docs/12-Coding-Standards.md`: kodlama standartları
- `docs/17-OCR-Markdown-Prompt.md`: OCR ve Markdown üretim kuralları
- `docs/18-Upload-Workflow.md`: yükleme akışı
- `docs/dynamic-metadata.md`: dinamik YAML metadata ve sorgu doğrulama yaşam döngüsü
