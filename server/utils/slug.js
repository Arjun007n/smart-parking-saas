// "10 Tips for Parking Operators!" -> "10-tips-for-parking-operators"
const slugify = (text) =>
  String(text || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");

// Finds a slug that `exists` (async) says is free, adding -2, -3, ... if needed.
const uniqueSlug = async (text, exists) => {
  const base = slugify(text) || "post";
  if (!(await exists(base))) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}-${n}`;
    if (!(await exists(candidate))) return candidate;
  }
  return `${base}-${Date.now()}`;
};

module.exports = { slugify, uniqueSlug };
