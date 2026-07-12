const turkishCharacterMap: Record<string, string> = {
  ç: "c",
  Ç: "c",
  ğ: "g",
  Ğ: "g",
  ı: "i",
  I: "i",
  İ: "i",
  ö: "o",
  Ö: "o",
  ş: "s",
  Ş: "s",
  ü: "u",
  Ü: "u"
};

export function slugify(value: string) {
  const normalized = value
    .trim()
    .replace(/[çÇğĞıIİöÖşŞüÜ]/g, (character) => turkishCharacterMap[character])
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "workspace";
}
