import type { IngestionResult } from '@knowledgeos/ingestion';

export type IngestionQualityIssue = {
  chunkIndex: number;
  code: 'TOO_SHORT' | 'DUPLICATE' | 'OCR_ARTIFACTS' | 'LOW_TEXT_DENSITY';
  severity: 'warning' | 'error';
};

export type IngestionQualityReport = {
  checkedChunkCount: number;
  issueCount: number;
  issues: IngestionQualityIssue[];
};

const minimumUsefulLength = 40;
const densityCheckMinimumLength = 80;
const minimumVisibleCharacterRatio = 0.35;

/**
 * Chunk içeriğini uzunluk, tekrar, kontrol karakterleri ve görünür metin
 * yoğunluğu bakımından deterministik olarak denetler.
 *
 * Bu fonksiyon içeriği değiştirmez. Yalnızca OCR düzeltme ve ingestion
 * telemetry katmanlarının kullanabileceği kalite sorunlarını raporlar.
 */
export function inspectIngestionQuality(
  chunks: IngestionResult['chunks'],
): IngestionQualityReport {
  const issues: IngestionQualityIssue[] = [];
  const seen = new Set<string>();

  for (const chunk of chunks) {
    const compact = compactWhitespace(chunk.content);
    const normalized = compactWhitespace(chunk.normalizedContent);

    if (compact.length < minimumUsefulLength) {
      addIssue(issues, {
        chunkIndex: chunk.chunkIndex,
        code: 'TOO_SHORT',
        severity: 'warning',
      });
    }

    // Boş normalize içerikler birbirinin tekrarı sayılmaz. Aksi durumda
    // içeriksiz birden fazla chunk yanlış DUPLICATE uyarısı üretir.
    if (normalized) {
      if (seen.has(normalized)) {
        addIssue(issues, {
          chunkIndex: chunk.chunkIndex,
          code: 'DUPLICATE',
          severity: 'warning',
        });
      } else {
        seen.add(normalized);
      }
    }

    const artifactCount = countOcrArtifacts(chunk.content);
    if (artifactCount > 0) {
      addIssue(issues, {
        chunkIndex: chunk.chunkIndex,
        code: 'OCR_ARTIFACTS',
        severity: artifactCount > 3 ? 'error' : 'warning',
      });
    }

    if (
      compact.length >= densityCheckMinimumLength &&
      visibleCharacterRatio(chunk.content, compact.length) <
        minimumVisibleCharacterRatio
    ) {
      addIssue(issues, {
        chunkIndex: chunk.chunkIndex,
        code: 'LOW_TEXT_DENSITY',
        severity: 'warning',
      });
    }
  }

  return {
    checkedChunkCount: chunks.length,
    issueCount: issues.length,
    issues,
  };
}

/**
 * Bir kalite sorununu aynı chunk ve kod için en fazla bir kez rapora ekler.
 */
function addIssue(
  issues: IngestionQualityIssue[],
  issue: IngestionQualityIssue,
) {
  const existing = issues.find(
    (item) => item.chunkIndex === issue.chunkIndex && item.code === issue.code,
  );

  if (!existing) {
    issues.push(issue);
    return;
  }

  // Aynı sorun daha sonra daha yüksek şiddetle bulunursa mevcut kayıt
  // warning seviyesinden error seviyesine yükseltilir.
  if (existing.severity === 'warning' && issue.severity === 'error') {
    existing.severity = 'error';
  }
}

/**
 * Metindeki ardışık boşlukları tek boşluğa indirip dış boşlukları temizler.
 */
function compactWhitespace(value: string) {
  return value.replace(/\s+/gu, ' ').trim();
}

/**
 * Unicode replacement karakteri ve yazdırılamayan kontrol karakterlerinin
 * toplam sayısını döndürür.
 */
function countOcrArtifacts(value: string) {
  return (
    value.match(/\uFFFD|[\u0000-\u0008\u000B\u000C\u000E-\u001F]/gu) ?? []
  ).length;
}

/**
 * Harf ve rakamların kompakt içerik uzunluğuna oranını hesaplar.
 *
 * Sıfıra bölünme ihtimalinde 0 döndürür.
 */
function visibleCharacterRatio(originalContent: string, compactLength: number) {
  if (compactLength <= 0) return 0;

  const visibleCount = (originalContent.match(/[\p{L}\p{N}]/gu) ?? []).length;

  return visibleCount / compactLength;
}
