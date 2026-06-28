// ── Room-scoped encryption ──────────────────────────────────────────────────
// Derives an AES-GCM key from the room code (PBKDF2) so that names, task IDs,
// and notes are stored encrypted in Firebase. Anyone with the room code can
// decrypt; Firebase console / API access alone cannot read the plaintext.

const _keyCache = new Map();

async function getRoomKey(roomCode) {
  if (_keyCache.has(roomCode)) return _keyCache.get(roomCode);
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw", enc.encode(roomCode), "PBKDF2", false, ["deriveKey"]
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode("sp-poker-v1"), iterations: 100000, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  _keyCache.set(roomCode, key);
  return key;
}

function bufToB64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function b64ToBuf(b64) {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

async function encryptField(roomCode, plaintext) {
  if (plaintext == null || plaintext === "") return plaintext;
  const key = await getRoomKey(roomCode);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(String(plaintext)));
  return `enc:${bufToB64(iv)}:${bufToB64(cipherBuf)}`;
}

async function decryptField(roomCode, value) {
  if (typeof value !== "string" || !value.startsWith("enc:")) return value;
  const [, ivB64, cipherB64] = value.split(":");
  try {
    const key = await getRoomKey(roomCode);
    const iv = b64ToBuf(ivB64);
    const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, b64ToBuf(cipherB64));
    return new TextDecoder().decode(plainBuf);
  } catch {
    return "🔒";
  }
}
