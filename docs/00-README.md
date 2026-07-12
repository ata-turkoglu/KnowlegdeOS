# KnowledgeOS

KnowledgeOS, tamamen yerelde çalışan AI destekli dijital arşiv ve bilgi yönetim sistemidir.

Bu proje AnythingLLM yerine geliştirilecek özel bir sistemdir. Amaç sadece belgelerle sohbet etmek değil; belgelerden kişi, yer, parsel, tarih, kurum, dava numarası, belge tipi, ilişki ve olay bilgisi çıkararak aranabilir bir bilgi modeli oluşturmaktır.

## Temel Kullanım Akışı

Eski kağıt belgeler taranır.

```text
Kağıt belge
↓
Tarama / fotoğraf
↓
ChatGPT ile OCR + düzenli Markdown çıktısı
↓
KnowledgeOS'a Markdown yükleme
↓
Entity extraction
↓
Alias resolution
↓
Search / Chat / Knowledge Graph
```

## Neden Markdown?

KnowledgeOS'un ana çalışma formatı Markdown'dır.

Orijinal tarama dosyaları kanıt niteliğinde saklanır. AI'ın okuyacağı ve indeksleyeceği metin Markdown dosyasıdır.

## İlk MVP Hedefi

Aşağıdaki soru doğru cevaplanmalıdır:

```text
Ali Çobanoğlu hangi belgelerde geçiyor?
```

Sistem, sadece vector search kullanmamalıdır. Alias ve entity sistemiyle şunları aynı kişi olarak değerlendirebilmelidir:

- Ali Çobanoğlu
- Ali Zeki Çobanoğlu
- Ali Çavanoğlu
- A. Çobanoğlu

Beklenen sonuç:

- A-1
- A-2
- A-8

## Local-first

Sistem tamamen yerelde çalışır.

- Harici AI API yok
- Cloud yok
- Login yok
- SaaS yok
- PostgreSQL yerelde
- Ollama yerelde
- Dosyalar yerelde
- Workspace export/import destekli

## Taşınabilirlik

Projede workspace mantığı olmalıdır. Kullanıcı bir workspace'i zip olarak dışa aktarabilmeli, başka bilgisayarda içe aktarabilmelidir.
