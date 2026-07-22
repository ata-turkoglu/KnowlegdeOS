export function buildEntityExtractionPrompt(content: string) {
  return `Sen KnowledgeOS için yerel çalışan bilgi çıkarım motorusun.

Kurallar:
- Sadece verilen belge metnine dayan.
- Bilgi uydurma.
- Türkçe karakterleri koru.
- Emin olmadığın alanları boş dizi veya null bırak.
- Cevabı sadece JSON olarak ver, açıklama ekleme.

JSON şeması:
{
  "people": ["Kişi adı"],
  "aliases": [
    { "canonical": "Ana kişi adı", "aliases": ["Diğer yazımlar"] }
  ],
  "places": ["Yer adı"],
  "parcels": ["Parsel/ada/pafta bilgisi"],
  "dates": ["Tarih"],
  "organizations": ["Kurum adı"],
  "documentType": "Belge tipi veya null",
  "relationships": [
    {
      "source": "Entity adı",
      "relation": "ilişki",
      "target": "Entity adı",
      "evidence": "Belgeden kısa kanıt"
    }
  ],
  "summary": "Belgenin kısa Türkçe özeti"
}

Belge:
"""${content.slice(0, 8000)}"""`;
}
