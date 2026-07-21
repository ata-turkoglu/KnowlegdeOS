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

Amaç:

Bu çıktı, KnowledgeOS bilgi tabanında kalıcı dijital arşiv ve arama amacıyla kullanılacaktır. Görev bir özetleme veya içerik çıkarımı değil, belgenin diplomatik transkripsiyonunu üretmektir: görseldeki metni okuma sırasına göre, mümkün olduğunca kelimesi kelimesine ve orijinal yapısına sadık biçimde aktar. Amaç, insan doğrulaması öncesinde düzenlenebilir ve mümkün olduğunca eksiksiz bir ilk taslak oluşturmaktır.

Kurallar:

1. Belgedeki metni OCR ile satır satır oku. Her görünür satır çıktıda karşılık bulmalıdır.
2. Okunabilen metni aynen yaz. Bir satırın yalnızca bir kısmı okunamıyorsa sadece o kısmı `[okunamadı]` ile değiştir. Satırın tamamı okunamıyorsa o satırın yerine `[okunamadı]` yaz.
3. Görselde yüksek güvenle okunabilen metni aktar. Yalnızca gerçekten okunamayan, düşük güvenli veya birden fazla makul okunuşa sahip ifadeleri `[okunamadı]` olarak işaretle; gereksiz yere `[okunamadı]` kullanma.
4. Belgede görünmeyen hiçbir kelime, satır, başlık veya bilgi ekleme. Metni tamamlama, yeniden kurma veya tahminle düzeltme.
5. Türkçe karakterleri, yazım biçimini, imlayı ve eski yazım biçimlerini koru; modernleştirme veya günümüz Türkçesine çeviri yapma.
6. Satır ve paragraf yapısını koru. Yalnızca tarama kaynaklı zorunlu durumlarda satırları birleştir.
7. Kaynakta madde işareti yoksa metni madde listesine dönüştürme. Kaynakta bulunmayan kalın, italik veya başka vurgu biçimleri ekleme.
8. Kaynakta aynen yazmıyorsa `Yüksek güvenle okunabilen kısımlar`, `Bu sayfa noter belgesinin devamıdır`, `ilişkin hükümler yer almaktadır`, `çeşitli bilgiler bulunmaktadır`, `tarama çözünürlüğü nedeniyle aktarılmamıştır` gibi açıklama, yorum veya özet cümleleri üretme.
9. Belgenin hiçbir bölümünü açıklama yazarak geçiştirme veya atlama. Tekrar eden bilgiler, dipnotlar, ekler, numaralandırmalar ve kenar notları korunmalıdır.
10. Kişi, kurum, yer adı, tarih, saat, ada, parsel, tapu, dava, karar, dosya ve diğer resmî numara bilgilerini değiştirme, normalleştirme veya birleştirme.
11. Aynı kişi veya kurumun farklı yazımlarını geçtiği biçimde bırak.
12. Belge birden fazla sayfaysa her sayfanın başına sırasıyla `[Sayfa 1]`, `[Sayfa 2]` vb. ekle. Belgede görünen gerçek sayfa numaralarını ayrıca koru.
13. Yalnızca belgede açıkça görülen başlıkları uygun Markdown başlığına (`#`, `##`, `###`) dönüştür. Bir başlık bu sayfada görünmüyorsa başka dosyadan veya önceki sayfadan taşıma.
14. Tablo varsa sütun ve satır yapısını mümkün olduğunca koruyarak Markdown tabloya dönüştür. Okunamayan hücreleri `[okunamadı]` yaz.
15. İmza, mühür, kaşe, el yazısı, çizim, kroki, fotoğraf ve benzeri metin dışı unsurları köşeli parantezle belirt. Örnek: `[ıslak imza]`, `[mühür]`, `[el yazısı not]`.
16. Görsel unsurların içindeki metin okunabiliyorsa aynen aktar; okunamıyorsa `[okunamadı]` kullan.
17. Metadata alanlarını yalnızca kaynak belgede açıkça görülen bilgilerle doldur. Bilgi yoksa boş bırak (`""` veya `[]`).
18. `source_original` alanını yüklenen kaynak dosyanın adından boşluklar, parantezler, tireler ve diğer işaretler dâhil birebir kopyala; URL kodlaması yapma.
19. Belgede açıkça anlaşılabiliyorsa `document_type` alanını doldur (ör. Tapu, Noter Belgesi, Mahkeme Kararı, Vekaletname, Mektup, Makbuz, Sözleşme). Emin olunamıyorsa boş bırak.
20. `people`, `places` ve `parcels` alanlarına yalnızca belgede açıkça görülen değerleri, yazımlarını değiştirmeden ekle. İçerikte açıkça görülen bir kişi, yer veya parsel varsa ilgili listeyi boş bırakma.
21. Belgede görünür bir başlık varsa `title` alanında ve içerik başlığında aynen kullan. Görünür başlık yoksa `title` alanında kaynak dosya adını uzantısız kullan ve içerik başlığını da aynı değerle oluştur; başka sayfadan başlık tahmin etme.
22. Çıktı yalnızca Markdown olmalı; açıklama, önsöz, değerlendirme, özür, süreç bilgisi veya kod bloğu kullanma.
23. Aynı iletide birden fazla bağımsız kaynak dosya varsa her birini ayrı belge kabul et ve sırayla işle. İlk dosyanın eksiksiz transkripsiyonu tamamlanmadan ikinci dosyaya başlama; belge içeriklerini birleştirme.
24. Yanıt sınırı nedeniyle tüm belgeler eksiksiz işlenemiyorsa belgeleri kısaltma veya özetleme. Yalnızca ilk kaynak belgeyi eksiksiz işle.
25. İndirilebilir dosya oluşturma özelliği destekleniyorsa her kaynak belge için kaynak dosya adıyla aynı ada sahip ayrı bir `.md` dosyası oluştur ve indirilebilir sun. Birden fazla belge eksiksiz işlenmişse tüm `.md` dosyalarını ayrıca tek bir `.zip` arşivi içinde sun. Desteklenmiyorsa yalnızca ilgili belgenin eksiksiz Markdown içeriğini ver.
26. Çıktıyı tamamlamadan önce her görünür metin bölgesinin ya transkripsiyonla ya da `[okunamadı]` ile karşılandığını sessizce kontrol et; bu kontrol hakkında çıktıya açıklama ekleme.

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

# Kaynakta Görünen Başlık veya Kaynak Dosya Adı

[Sayfa 1]

Belge metni...

[Sayfa 2]

Belge metni...
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
