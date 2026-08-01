import { normalizeForSearch } from '@knowledgeos/ingestion';

export type DateSearchMode = 'DOCUMENT_DATE' | 'CONTENT_DATE' | 'BOTH';

export type DateSearchVariants = {
  iso: string;
  normalizedNumeric: string;
  textualVariants: string[];
};

const monthNames = [
  ['January', 'Ocak'],
  ['February', 'Şubat'],
  ['March', 'Mart'],
  ['April', 'Nisan'],
  ['May', 'Mayıs'],
  ['June', 'Haziran'],
  ['July', 'Temmuz'],
  ['August', 'Ağustos'],
  ['September', 'Eylül'],
  ['October', 'Ekim'],
  ['November', 'Kasım'],
  ['December', 'Aralık'],
] as const;

const normalizedMonthNumbers = new Map(
  monthNames.flatMap((names, index) =>
    names.map((name) => [normalizeForSearch(name), index + 1] as const),
  ),
);

/** Sorgudaki sayısal veya Türkçe/İngilizce metinsel tarihi doğrulayıp arama varyantlarına dönüştürür. */
export function extractDateSearchVariants(
  query: string,
): DateSearchVariants | undefined {
  const numeric = query.match(
    /\b(\d{4})-(\d{1,2})-(\d{1,2})\b|\b(\d{1,2})[./-](\d{1,2})[./-]((?:19|20)\d{2})\b/u,
  );
  const normalized = normalizeForSearch(query);
  const monthPattern = [...normalizedMonthNumbers.keys()].join('|');
  const textual = normalized.match(
    new RegExp(`(?:^|\\s)(\\d{1,2})\\s+(${monthPattern})\\s+((?:19|20)\\d{2})(?=\\s|$)`, 'u'),
  );
  const parts = numeric
    ? {
        year: Number(numeric[1] ?? numeric[6]),
        month: Number(numeric[2] ?? numeric[5]),
        day: Number(numeric[3] ?? numeric[4]),
      }
    : textual
      ? {
          year: Number(textual[3]),
          month: normalizedMonthNumbers.get(textual[2]) ?? 0,
          day: Number(textual[1]),
        }
      : undefined;

  if (!parts || !isValidDateParts(parts.year, parts.month, parts.day)) {
    return undefined;
  }

  const year = String(parts.year).padStart(4, '0');
  const month = String(parts.month).padStart(2, '0');
  const day = String(parts.day).padStart(2, '0');
  const [englishMonth, turkishMonth] = monthNames[parts.month - 1];

  return {
    iso: `${year}-${month}-${day}`,
    normalizedNumeric: `${parts.day} ${parts.month} ${parts.year}`,
    textualVariants: [
      `${parts.day}.${parts.month}.${parts.year}`,
      `${day}.${month}.${year}`,
      `${parts.day}/${parts.month}/${parts.year}`,
      `${day}/${month}/${year}`,
      `${parts.day}-${parts.month}-${parts.year}`,
      `${day}-${month}-${year}`,
      `${year}-${month}-${day}`,
      `${parts.day} ${englishMonth} ${parts.year}`,
      `${parts.day} ${turkishMonth} ${parts.year}`,
    ],
  };
}

/** Açık tarihli sorgunun belge metadata'sını mı yoksa olay içeriğini mi hedeflediğini belirler. */
export function inferDateSearchMode(
  query: string,
  hasExplicitDate = Boolean(extractDateSearchVariants(query)),
): DateSearchMode {
  const normalized = normalizeForSearch(query);
  const documentSignal =
    /\b(documents? dated|dated documents?|document date|how many documents?|count documents?|list documents?|issued on (?:this|that) date)\b/u.test(
      normalized,
    ) ||
    /\b(belge tarihi|tarihli|belgeler? tarihli|kac(?: adet)? belge|belgeleri listele|bu tarihte duzenlenen)\b/u.test(
      normalized,
    );
  const contentSignal =
    /\b(what (?:had )?happened|what occurred|what took place|which events?|was there an event|who died|who passed away|who was born|which action was performed)\b/u.test(
      normalized,
    ) ||
    /\b(ne oldu|hangi olay|olay oldu mu|ne gerceklesti|kim vefat etti|kim oldu|kim dogdu|hangi islem yapildi)\b/u.test(
      normalized,
    );

  // A bare archival year (for example "2024 tarihli belgeler") is still a
  // document-metadata request even though it cannot be normalized to a day.
  if (!hasExplicitDate) return documentSignal ? 'DOCUMENT_DATE' : 'BOTH';

  if (documentSignal && contentSignal) return 'BOTH';
  if (documentSignal) return 'DOCUMENT_DATE';
  if (contentSignal) return 'CONTENT_DATE';
  return 'BOTH';
}

/** Yıl, ay ve gün bileşenlerinin gerçek bir takvim tarihi oluşturduğunu denetler. */
function isValidDateParts(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
