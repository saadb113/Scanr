// Port of public/js/fingerprint.js — same djb2 hash so existing device-lock records stay valid.
function djb2(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash = hash >>> 0; // keep unsigned 32-bit
  }
  return hash.toString(36);
}

export function getDeviceFingerprint() {
  const parts = [
    navigator.userAgent || '',
    navigator.language || '',
    `${screen.width}x${screen.height}x${screen.colorDepth}`,
    (() => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone;
      } catch {
        return '';
      }
    })(),
    navigator.platform || '',
    String(navigator.hardwareConcurrency || ''),
    String(navigator.deviceMemory || ''),
  ];
  return djb2(parts.join('|'));
}
