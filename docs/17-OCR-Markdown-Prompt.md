# OCR to KnowledgeOS Markdown Prompt

Bu prompt, KnowledgeOS upload panelinde kullanıcıya gösterilecek ve kopyalanabilir olacaktır.

## Kullanım

1. ChatGPT'ye taranmış PDF/JPG/PNG/TIFF dosyasını yükle.
2. Aşağıdaki promptu yapıştır.
3. ChatGPT'nin ürettiği Markdown çıktısını `.md` dosyası olarak kaydet.
4. KnowledgeOS upload panelinden bu `.md` dosyasını yükle.
5. Varsa orijinal tarama dosyasını da ek olarak yükle.

## Prompt

```text
Aşağıdaki taranmış belgeyi KnowledgeOS uyumlu Markdown formatına çevir.

Kurallar:

1. Belgedeki metni OCR ile oku.
2. Orijinal metni mümkün olduğunca koru.
3. Türkçe karakterleri koru.
4. Emin olmadığın kelimeleri tahmin etme; `[okunamadı]` olarak işaretle.
5. Sayfa ayrımlarını `[Sayfa 1]`, `[Sayfa 2]` şeklinde belirt.
6. Belge üzerindeki başlıkları Markdown başlığına çevir.
7. Tablo varsa Markdown tablo olarak yaz.
8. İmza, mühür, kaşe, el yazısı, çizim, kroki gibi görsel unsurları köşeli parantez içinde belirt.
9. Belgedeki kişi, kurum, tarih, parsel, dava numarası gibi bilgileri değiştirme.
10. Modernleştirme, özetleme veya yorum yapma.
11. Sadece Markdown çıktısı ver.
12. Belgenin okunamayan yerlerini saklama, mutlaka `[okunamadı]` olarak göster.
13. Eğer aynı kişinin farklı yazımları varsa metinde geçtiği gibi bırak.
14. Satır sonlarını belge anlamını bozmayacak şekilde düzenle.
15. Belge birden fazla sayfadan oluşuyorsa her sayfanın başına sayfa etiketi koy.

Markdown dosyasının başına şu YAML metadata taslağını ekle:

---
document_code: ""
title: ""
source_original: ""
ocr_status: "chatgpt_ocr"
language: "tr"
document_type: ""
date: ""
people: []
places: []
parcels: []
notes: "Bu metin taranmış belgeden ChatGPT yardımıyla Markdown'a çevrilmiştir."
---

Ardından belge içeriğini şu formatta yaz:

# Belge Başlığı

[Sayfa 1]

Belge metni...

[Sayfa 2]

Belge metni...

Çıktıda açıklama yapma. Sadece Markdown ver.
```

## Beklenen Çıktı Örneği

```md
---
document_code: "A-8"
title: "Sulh ve Taksim Anlaşması"
source_original: "A-8.pdf"
ocr_status: "chatgpt_ocr"
language: "tr"
document_type: "Anlaşma"
date: ""
people:
  - "Ali Çobanoğlu"
  - "Baki Toksal"
places:
  - "Beykoz"
parcels:
  - "247"
  - "248"
  - "249"
notes: "Bu metin taranmış belgeden ChatGPT yardımıyla Markdown'a çevrilmiştir."
---

# A-8 Sulh ve Taksim Anlaşması

[Sayfa 1]

Belge metni...
```
