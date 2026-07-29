import assert from "node:assert/strict";
import test from "node:test";
import { ingestMarkdown, normalizeForSearch, type ExtractedEntity } from "@knowledgeos/ingestion";
import { resolveDocumentEntityAliases } from "../../src/services/entities.js";

test("deterministic extraction rejects institutions as people and keeps full uppercase surnames", () => {
  const ingestion = ingestMarkdown(`---
people:
  - "Hüseyin Hüsnü SUBAŞI"
  - "D. T. Kooperatifi"
places:
  - "Sarıyer-Kilyos"
parcels:
  - "1 pafta"
  - "41 parsel"
property_descriptions:
  - "Sarıyer-Kilyos 1 pafta, 41 parsel sayılı taşınmaz"
---
Hüseyin Hüsnü SUBAŞI, Sarıyer Sulh Hukuk Mahkemesi Satış Memurluğu nezdinde işlem yaptı.
Akbank Merter şubesindeki 1575 nolu hesaba çekilmiş 27.12.1988 tarihli kayıt,
Bakırköy Üçüncü Noteri ve Güngören Belediyesi kayıtları,
Sarıyer-Kilyos 1 pafta, 41 parsel sayılı taşınmaza ilişkindir.`);

  const people = ingestion.entities.filter((entity) => entity.type === "PERSON").map((entity) => entity.normalizedValue);
  assert.ok(people.includes("huseyin husnu subasi"));
  assert.ok(!people.some((value) => /mahkeme|memurlugu|akbank|noter|belediye/.test(value)));
  assert.ok(!people.includes("d t kooperatifi"));
  assert.ok(ingestion.entities.some((entity) => entity.type === "ORGANIZATION" && entity.normalizedValue === "d t kooperatifi"));
  const dates = ingestion.entities.filter((entity) => entity.type === "DATE").map((entity) => entity.normalizedValue);
  assert.ok(dates.includes("27 12 1988"));
  assert.ok(!dates.includes("1575"));
  const parcels = ingestion.entities.filter((entity) => entity.type === "PARCEL").map((entity) => entity.normalizedValue);
  assert.ok(parcels.includes("1 pafta"));
  assert.ok(parcels.includes("41 parsel"));
});

test("property extraction stores place, pafta and parsel as one reference", () => {
  const ingestion = ingestMarkdown(`---
places:
  - "Sarıyer-Kilyos"
property_descriptions:
  - "Sarıyer-Kilyos 1 pafta, 41 parsel sayılı taşınmaz"
---
Sarıyer-Kilyos 1 pafta, 41 parsel sayılı taşınmaz satılmıştır.`);
  assert.deepEqual(ingestion.propertyReferences[0], {
    place: "Sarıyer-Kilyos",
    normalizedPlace: "sariyer kilyos",
    sheet: "1",
    block: null,
    parcel: "41",
    normalizedKey: "sariyer kilyos|1|-|41",
    evidenceSnippet: "Sarıyer-Kilyos 1 pafta, 41 parsel sayılı taşınmaz",
    confidence: 0.98,
    source: "FRONTMATTER"
  });
});

test("frontmatter canonical people absorb compatible regex fragments as aliases", () => {
  const entity = (value: string, source: ExtractedEntity["source"], confidence: number): ExtractedEntity => ({
    type: "PERSON",
    value,
    normalizedValue: normalizeForSearch(value),
    evidenceSnippet: value,
    confidence,
    source
  });
  const resolved = resolveDocumentEntityAliases([
    entity("E. Ruhi Öztürk", "FRONTMATTER", 0.98),
    entity("Ruhi Öztürk", "REGEX", 0.72),
    entity("E. Ruhi", "REGEX", 0.74)
  ]);
  assert.deepEqual(resolved.entities.map((item) => item.value), ["E. Ruhi Öztürk"]);
  assert.deepEqual(resolved.aliases.map((item) => item.alias).sort(), ["E. Ruhi", "Ruhi Öztürk"]);
});
