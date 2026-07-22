// Dosya Dönüştür sayfasındaki "Promptu kopyala" yardımı için tek kaynak.
export const ocrMarkdownPrompt = `Aşağıdaki Markdown kaynak dosyasını KnowledgeOS için bağımsız belgelere ayır ve her belgeyi metadata ile ayrı Markdown dosyası olarak hazırla.

Amaç:

Yüklenen dosya, bir veya birden fazla belgenin Pandoc ile üretilmiş Markdown transkripsiyonudur. OCR yapma, metni yeniden yazma veya özetleme. Görev yalnızca belge sınırlarını tanımak, metni aynen korumak ve her bağımsız belgeye kaynakta açıkça görülebilen metadata eklemektir.

Belge sınırları:

1. Kaynak Markdown içindeki yalnızca seviye 2 başlıklar (\`## \`) bağımsız belge başlangıcıdır. Örnekler: \`## A-1/a\`, \`## C-2/l\`, \`## S.2\`.
2. Dosyanın başındaki \`# \` başlığı varsa arşiv/kaynak başlığıdır; tek başına bağımsız belge oluşturmaz.
3. Her \`## \` başlığı, bir sonraki \`## \` başlığına kadar olan tüm içeriğiyle birlikte tek bir belgedir. \`###\` ve daha alt başlıklar kendi belgesini başlatmaz.
4. Kaynakta hiç \`## \` yoksa tüm kaynak dosyayı tek bağımsız belge kabul et.
5. Her belge bloğunun içeriğini eksiksiz koru: metin, tablolar, dipnotlar, imza/mühür/kroki notları, tekrar eden alanlar ve alt başlıklar atlanmamalıdır.

İçerik kuralları:

6. Kaynakta bulunmayan hiçbir metin, tarih, kişi, yer, başlık, yorum veya açıklama ekleme. Metni düzeltme, modernleştirme, özetleme ya da yeniden sıralama.
7. Kaynaktaki Markdown yapısını koru. \`## \` belge kodu başlığı her çıktı dosyasında aynen kalmalıdır.
8. Bir bölümde bilgi yoksa metadata alanını boş bırak; tahmin etme.
9. Aynı kişi, yer veya parsel farklı yazımlarla geçiyorsa kaynakta geçtiği yazımı kullan; normalleştirme yapma.

Metadata kuralları:

10. Her çıktı dosyasının başında aşağıdaki geçerli YAML metadata bulunmalıdır.
11. \`document_code\` alanına ilgili \`## \` başlığındaki kodu yaz. Kaynakta \`## \` yoksa boş bırak.
12. \`title\` alanına belge içinde açıkça görülen anlamlı başlığı yaz. Yalnızca kod görünüyorsa kodu kullan.
13. \`source_original\` alanına yüklenen Markdown dosyasının adını aynen yaz.
14. \`document_type\`, \`date\`, \`people\`, \`places\` ve \`parcels\` alanlarını yalnızca o belge bloğunda açıkça görülen bilgilerle doldur.
15. Listeleri geçerli YAML biçiminde yaz: her değer ayrı satırda iki boşluk girintili \`- \` ile başlamalıdır. \`*\` kullanma.

Her dosyanın biçimi:

---
document_code: ""
title: ""
source_original: ""
ocr_status: "pandoc_markdown"
language: "tr"
document_type: ""
date: ""
people: []
places: []
parcels: []
notes: "Bu belge Pandoc Markdown kaynağından ayrıştırılmıştır."
---

## Kaynakta bulunan belge kodu

Kaynak belge metni...

Dosya üretimi:

16. Her bağımsız belge için ayrı bir \`.md\` dosyası oluştur.
17. Dosya adını, yüklenen Markdown dosyasının uzantısız adı ile belge kodunu birleştirerek oluştur. Örnek: \`merter-a-A-1-a.md\`.
18. Tüm üretilen \`.md\` dosyalarını tek bir indirilebilir \`.zip\` arşivinde sun.
19. Çıktı olarak açıklama, değerlendirme veya kod bloğu yazma; yalnızca indirilebilir dosyaları sun.
20. Tüm kaynak dosya teknik olarak okunamıyorsa veya tüm bağımsız belgeler eksiksiz üretilemiyorsa kısmi ZIP oluşturma. Yalnızca \`[İşlenemedi: kaynak Markdown dosyasının tamamı işlenemedi.]\` yaz.`;
