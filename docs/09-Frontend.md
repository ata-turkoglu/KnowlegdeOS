# Frontend

## Pages

### Dashboard

- toplam workspace
- toplam belge
- toplam entity
- toplam parsel
- indekslenmiş belge
- son yüklenen belgeler

### Workspace Selector

- workspace oluştur
- workspace seç
- workspace export
- workspace import
- backup
- restore

### Documents

- markdown upload
- original file upload optional
- belge listesi
- belge detayına git
- yeniden indeksle
- sil

### Upload Panel

Bu panelde özel bir bölüm olmalıdır:

## "Taranmış belgeyi Markdown'a çevirme"

Kullanıcıya açıklama:

> Eğer elinizde taranmış PDF, JPG, PNG veya TIFF varsa, en iyi sonuç için önce ChatGPT ile KnowledgeOS uyumlu Markdown çıktısı alın. Aşağıdaki promptu kopyalayın, ChatGPT'ye tarama dosyanızı yükleyin ve çıktıyı `.md` olarak kaydedip buraya yükleyin.

Butonlar:

- Promptu kopyala
- Örnek Markdown göster
- Markdown yükle
- Orijinal tarama dosyasını ekle

### Document Detail

- içerik
- özet
- kişiler
- parseller
- tarihler
- ilişkiler
- chunks
- source original link

### Entities

- entity listesi
- aliaslar
- merge
- detail

### Chat

Her cevapta:

- query type
- matched aliases
- sources
- final answer

gösterilmelidir.

### Settings

- Ollama URL
- LLM model
- embedding model
- chunk size
- storage path
- OCR prompt template
