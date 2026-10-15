// Safe settings for the Android manifest, applied after `cap add android` / `cap sync`.
//   allowBackup=false      the phone must not copy the app's saved data (the sign-in) to a cloud backup
//   usesCleartextTraffic   false for a real app (only https); true only in test mode
const OPEN_TAG = /<application\b[^>]*>/s;

const setAttribute = (tag, name, value) => {
  const existing = new RegExp(`(\\s${name.replace(":", "\\:")}\\s*=\\s*)(["'])[^"']*\\2`);
  if (existing.test(tag)) return tag.replace(existing, `$1"${value}"`);
  return tag.replace(/<application\b/, `<application\n        ${name}="${value}"`);
};

export const hardenManifest = (xml, { dev = false } = {}) => {
  const match = OPEN_TAG.exec(xml);
  if (!match) throw new Error("No <application> tag found in AndroidManifest.xml");
  let tag = match[0];
  tag = setAttribute(tag, "android:allowBackup", "false");
  tag = setAttribute(tag, "android:usesCleartextTraffic", dev ? "true" : "false");
  return xml.replace(OPEN_TAG, () => tag);
};
