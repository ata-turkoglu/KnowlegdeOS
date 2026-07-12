const turkishLowerMap: Record<string, string> = {
  I: "ı",
  İ: "i"
};

export function normalizeText(input: string) {
  return input
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeForSearch(input: string) {
  const lowered = input
    .replace(/[Iİ]/g, (character) => turkishLowerMap[character])
    .toLocaleLowerCase("tr-TR");

  return lowered
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/ğ/g, "g")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ş/g, "s")
    .replace(/ü/g, "u")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
