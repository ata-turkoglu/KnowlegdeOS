// OCR yardım penceresindeki metni yalnızca bu dosyadan güncelleyin.
export const ocrMarkdownPrompt = `Aşağıdaki taranmış belgeyi KnowledgeOS uyumlu Markdown formatına çevir.

Amaç:

Bu çıktı, KnowledgeOS bilgi tabanında kalıcı dijital arşiv ve arama amacıyla kullanılacaktır. Görev bir özetleme veya içerik çıkarımı değil, belgenin diplomatik transkripsiyonunu üretmektir: görseldeki metni okuma sırasına göre, mümkün olduğunca kelimesi kelimesine ve orijinal yapısına sadık biçimde aktar. Amaç, insan doğrulaması öncesinde düzenlenebilir ve mümkün olduğunca eksiksiz bir ilk taslak oluşturmaktır.

Kurallar:

1. Belgedeki metni OCR ile satır satır oku. Her görünür satır çıktıda karşılık bulmalıdır.
2. Okunabilen metni aynen yaz. Bir satırın yalnızca bir kısmı okunamıyorsa sadece o kısmı \`[okunamadı]\` ile değiştir. Satırın tamamı okunamıyorsa o satırın yerine \`[okunamadı]\` yaz.
3. Görselde yüksek güvenle okunabilen metni aktar. Yalnızca gerçekten okunamayan, düşük güvenli veya birden fazla makul okunuşa sahip ifadeleri \`[okunamadı]\` olarak işaretle; gereksiz yere \`[okunamadı]\` kullanma.
4. Belgede görünmeyen hiçbir kelime, satır, başlık veya bilgi ekleme. Metni tamamlama, yeniden kurma veya tahminle düzeltme.
5. Türkçe karakterleri, yazım biçimini, imlayı ve eski yazım biçimlerini koru; modernleştirme veya günümüz Türkçesine çeviri yapma.
6. Satır ve paragraf yapısını koru. Yalnızca tarama kaynaklı zorunlu durumlarda satırları birleştir.
7. Kaynakta madde işareti yoksa metni madde listesine dönüştürme. Kaynakta bulunmayan kalın, italik veya başka vurgu biçimleri ekleme.
8. Kaynakta aynen yazmıyorsa \`Yüksek güvenle okunabilen kısımlar\`, \`Bu sayfa noter belgesinin devamıdır\`, \`ilişkin hükümler yer almaktadır\`, \`çeşitli bilgiler bulunmaktadır\`, \`tarama çözünürlüğü nedeniyle aktarılmamıştır\` gibi açıklama, yorum veya özet cümleleri üretme.
9. Belgenin hiçbir bölümünü açıklama yazarak geçiştirme veya atlama. Tekrar eden bilgiler, dipnotlar, ekler, numaralandırmalar ve kenar notları korunmalıdır.
10. Kişi, kurum, yer adı, tarih, saat, ada, parsel, tapu, dava, karar, dosya ve diğer resmî numara bilgilerini değiştirme, normalleştirme veya birleştirme.
11. Aynı kişi veya kurumun farklı yazımlarını geçtiği biçimde bırak.
12. Kaynak dosyanın tamamını, yanıtı oluşturmadan önce baştan sona incele; yalnızca ilk sayfayı, ilk formu veya ilk tekrar eden belgeyi işleyip durma. Belge birden fazla sayfaysa her fiziksel sayfanın başına sırasıyla \`[Sayfa 1]\`, \`[Sayfa 2]\` vb. ekle. Belgede görünen gerçek sayfa numaralarını ayrıca koru.
13. Yalnızca belgede açıkça görülen başlıkları uygun Markdown başlığına (\`#\`, \`##\`, \`###\`) dönüştür. Bir başlık bu sayfada görünmüyorsa başka dosyadan veya önceki sayfadan taşıma.
14. Tablo varsa sütun ve satır yapısını mümkün olduğunca koruyarak Markdown tabloya dönüştür. Okunamayan hücreleri \`[okunamadı]\` yaz.
15. İmza, mühür, kaşe, el yazısı, çizim, kroki, fotoğraf ve benzeri metin dışı unsurları köşeli parantezle belirt. Örnek: \`[ıslak imza]\`, \`[mühür]\`, \`[el yazısı not]\`.
16. Görsel unsurların içindeki metin okunabiliyorsa aynen aktar; okunamıyorsa \`[okunamadı]\` kullan.
17. Metadata alanlarını yalnızca kaynak belgede açıkça görülen bilgilerle doldur. Bilgi yoksa boş bırak (\`""\` veya \`[]\`).
18. \`source_original\` alanını yüklenen kaynak dosyanın adından boşluklar, parantezler, tireler ve diğer işaretler dâhil birebir kopyala; URL kodlaması yapma.
19. Belgede açıkça anlaşılabiliyorsa \`document_type\` alanını doldur (ör. Tapu, Noter Belgesi, Mahkeme Kararı, Vekaletname, Mektup, Makbuz, Sözleşme). Emin olunamıyorsa boş bırak.
20. \`people\`, \`places\` ve \`parcels\` alanlarına yalnızca belgede açıkça görülen değerleri, yazımlarını değiştirmeden ekle. İçerikte açıkça görülen bir kişi, yer veya parsel varsa ilgili listeyi boş bırakma. Listeleri geçerli YAML biçiminde yaz: her değer ayrı satırda iki boşluk girintili \`- \` ile başlamalıdır; \`*\` kullanma ve bir listenin altına başka metadata alanı girintileme.
21. Belgede görünür bir başlık varsa \`title\` alanında ve içerik başlığında aynen kullan. Görünür başlık yoksa \`title\` alanında kaynak dosya adını uzantısız kullan ve içerik başlığını da aynı değerle oluştur; başka sayfadan başlık tahmin etme.
22. Çıktı yalnızca Markdown olmalı; açıklama, önsöz, değerlendirme, özür, süreç bilgisi veya kod bloğu kullanma.
23. Aynı iletide birden fazla bağımsız kaynak dosya varsa her birini ayrı belge kabul et ve sırayla işle. İlk dosyanın eksiksiz transkripsiyonu tamamlanmadan ikinci dosyaya başlama; belge içeriklerini birleştirme. Tek bir DOCX/PDF içinde birbirinden bağımsız tapu, form, ek veya karar belgeleri varsa her birini ayrı belge kabul et; tek YAML metadata altında birleştirme.
24. Yanıt sınırı nedeniyle birden fazla bağımsız belge eksiksiz işlenemiyorsa belgeleri kısaltma veya özetleme. Yalnızca ilk bağımsız belgeyi eksiksiz işle. Kaynak dosya uzun bir derlemeyse, sonraki bağımsız belgeler için kısmi veya birleşik bir \`.md\` dosyası oluşturma.
25. İndirilebilir dosya oluşturma özelliği destekleniyorsa her bağımsız belge için ayrı bir \`.md\` dosyası oluştur ve indirilebilir sun. Kaynak dosya bir derlemeyse dosya adına belge üzerindeki ayırt edici kodu ekle (ör. \`MERTER B - B-1-a.md\`). Desteklenmiyorsa yalnızca ilk bağımsız belgenin eksiksiz Markdown içeriğini ver.
26. Çıktıyı tamamlamadan önce her görünür metin bölgesinin ya transkripsiyonla ya da \`[okunamadı]\` ile karşılandığını sessizce kontrol et; bu kontrol hakkında çıktıya açıklama ekleme.
27. Tamamlanmış dosyada son kaynak sayfaya kadar kesintisiz \`[Sayfa N]\` etiketleri bulunmalıdır. Sayfa etiketleri veya belge blokları arasında açıklanmamış bir sıçrama varsa çıktı eksiktir; yeniden kontrol et.
28. Kaynakta aynı türden birden çok tapu/form varsa her birinin başlığını, alanlarını, imzalarını, mühürlerini, kroki notlarını ve tekrar eden dipnotlarını ayrı ayrı aktar. Bir önceki formda yer aldığı gerekçesiyle sonraki formun tekrar eden alanlarını çıkarma.
29. Kaynak dosyanın tamamını teknik olarak okuyamıyor veya tamamını tek yanıtta üretemiyorsan kısmi Markdown ya da kısmi indirilebilir dosya verme. Bu istisnai durumda yalnızca \`[İşlenemedi: kaynak dosyanın tamamı okunamadı veya tek yanıta sığmadı.]\` yaz.

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

Belge metni...`;
