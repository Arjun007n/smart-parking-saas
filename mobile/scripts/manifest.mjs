// Safe settings for the Android manifest, applied after `cap add android` / `cap sync`.
//   allowBackup=false      the phone must not copy the app's saved data (the sign-in) to a cloud backup
//   usesCleartextTraffic   false for a real app (only https); true only in test mode
//   networkSecurityConfig  res/xml/network_security_config.xml: the same rule for every network call (below)
//   debuggable             never set in the manifest (a release build must not be debuggable)
const OPEN_TAG = /<application\b[^>]*>/s;

const setAttribute = (tag, name, value) => {
  const existing = new RegExp(`(\\s${name.replace(":", "\\:")}\\s*=\\s*)(["'])[^"']*\\2`);
  if (existing.test(tag)) return tag.replace(existing, `$1"${value}"`);
  return tag.replace(/<application\b/, `<application\n        ${name}="${value}"`);
};

export const NETWORK_SECURITY_REF = "@xml/network_security_config";

// res/xml/network_security_config.xml: plain http is switched off for a real app and allowed only in test mode.
export const networkSecurityConfig = ({ dev = false } = {}) => `<?xml version="1.0" encoding="utf-8"?>
<!-- Written by scripts/harden-android.mjs. ${dev ? "TEST MODE (APP_DEV=1): plain http is allowed. Never ship this." : "Release: only https is allowed."} -->
<network-security-config>
    <base-config cleartextTrafficPermitted="${dev ? "true" : "false"}">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>
</network-security-config>
`;

export const hardenManifest = (xml, { dev = false } = {}) => {
  const match = OPEN_TAG.exec(xml);
  if (!match) throw new Error("No <application> tag found in AndroidManifest.xml");
  let tag = match[0];
  tag = setAttribute(tag, "android:allowBackup", "false");
  tag = setAttribute(tag, "android:usesCleartextTraffic", dev ? "true" : "false");
  tag = setAttribute(tag, "android:networkSecurityConfig", NETWORK_SECURITY_REF);
  tag = tag.replace(/\s+android:debuggable\s*=\s*(["'])[^"']*\1/, "");
  return xml.replace(OPEN_TAG, () => tag);
};
