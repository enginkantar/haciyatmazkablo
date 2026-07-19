// HalkÖde (Platformode) API yardımcıları
// Kaynak: hydrozidtr.com worker'ındaki doğrulanmış entegrasyon — birebir aynı
// hash/token protokolü. Secrets: HALKODE_APP_ID, HALKODE_APP_SECRET,
// HALKODE_MERCHANT_KEY (Cloudflare Pages → Settings → Variables and Secrets).

const PLATFORMODE_DEFAULT_BASE = 'https://app.halkode.com.tr/ccpayment';
const TOKEN_KV_KEY = 'token:halkode';

export function getPlatformodeBase(env) {
  return (env.PLATFORMODE_ACCESS_URL || env.PLATFORMODE_BASE_URL || env.HALKODE_BASE_URL || PLATFORMODE_DEFAULT_BASE)
    .replace(/\/+$/, '');
}

export async function getToken(env, platformodeBase) {
  const cached = await env.PAYMENT_KV.get(TOKEN_KV_KEY, { type: 'text' });
  if (cached) return cached;

  const resp = await fetch(`${platformodeBase}/api/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ app_id: env.HALKODE_APP_ID, app_secret: env.HALKODE_APP_SECRET }),
  });
  if (!resp.ok) throw new Error(`Token HTTP ${resp.status}`);

  const data = await resp.json();
  const token = data?.data?.token;
  if (!token) throw new Error(`Token yok: ${data?.status_description || 'bilinmiyor'}`);

  await env.PAYMENT_KV.put(TOKEN_KV_KEY, token, { expirationTtl: 110 * 60 });
  return token;
}

// ─── Hash üretimi (AES-CBC, sağlayıcı formatı) ───────────────────────────────
async function generatePlatformodeHashKey(dataParts, appSecret) {
  const iv = randomHex(16);
  const salt = randomHex(4);
  const password = await sha1(appSecret);
  const saltWithPassword = await sha256(password + salt);

  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(saltWithPassword.slice(0, 32)),
    { name: 'AES-CBC' }, false, ['encrypt']
  );
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv: new TextEncoder().encode(iv.slice(0, 16)) },
    key,
    new TextEncoder().encode(dataParts.join('|'))
  );

  const bundle = `${iv}:${salt}:${bytesToBase64(new Uint8Array(encrypted))}`;
  return bundle.replace(/\//g, '__');
}

export async function generatePaySmart3dHashKey(total, installment, currencyCode, merchantKey, invoiceId, appSecret) {
  return generatePlatformodeHashKey([
    String(Number(total).toFixed(2)),
    String(installment),
    String(currencyCode),
    String(merchantKey),
    String(invoiceId),
  ], appSecret);
}

export async function generateCheckStatusHashKey(invoiceId, merchantKey, appSecret) {
  return generatePlatformodeHashKey([String(invoiceId), String(merchantKey)], appSecret);
}

// ─── Webhook/dönüş hash doğrulama ────────────────────────────────────────────
export async function validateHash(hashKey, expStatus, expOrderId, expInvoiceId, appSecret) {
  try {
    const processed = String(hashKey || '').replace(/__/g, '/');
    const parts = processed.split(':');
    if (parts.length !== 3) return null;

    const [ivHex, saltHex, encBase64] = parts;
    const secretSha1 = await sha1(appSecret);
    const keyHex = await sha256(secretSha1 + saltHex);

    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(keyHex.slice(0, 32)),
      { name: 'AES-CBC' }, false, ['decrypt']
    );
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-CBC', iv: new TextEncoder().encode(ivHex.slice(0, 16)) },
      key,
      base64ToBytes(encBase64)
    );

    const text = new TextDecoder().decode(decrypted);
    const p = text.split('|');
    const decStatus = p[0] || '';
    const decInvoiceId = p[2] || '';
    const decOrderId = p[3] || p[2] || '';

    if (!timingSafeEqual(decStatus, expStatus)) return null;
    if (!timingSafeEqual(decOrderId, String(expOrderId))) return null;
    if (!timingSafeEqual(decInvoiceId, expInvoiceId)) return null;
    return text;
  } catch (e) {
    console.error('[halkode] hash decrypt error:', e.message);
    return null;
  }
}

// ─── Sunucu-sunucu ödeme durumu teyidi ───────────────────────────────────────
export async function checkOrderStatus(env, invoiceId) {
  try {
    const platformodeBase = getPlatformodeBase(env);
    const token = await getToken(env, platformodeBase);
    const hash_key = await generateCheckStatusHashKey(invoiceId, env.HALKODE_MERCHANT_KEY, env.HALKODE_APP_SECRET);
    const res = await fetch(`${platformodeBase}/api/checkstatus`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ invoice_id: invoiceId, merchant_key: env.HALKODE_MERCHANT_KEY, hash_key }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, raw: data };
    const statusCode = Number(data?.status_code || 0);
    const transactionStatus = String(data?.transaction_status || '');
    if (statusCode === 100 || transactionStatus.toLowerCase() === 'completed') {
      return { ok: true, orderId: data?.order_id || '', raw: data };
    }
    return { ok: false, error: data?.status_description || data?.message || 'order status not completed', raw: data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ─── Küçük yardımcılar ───────────────────────────────────────────────────────
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

async function sha1(input) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(input));
  return bytesToHex(new Uint8Array(buf));
}

async function sha256(input) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return bytesToHex(new Uint8Array(buf));
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function randomHex(length) {
  const bytes = new Uint8Array(Math.ceil(length / 2));
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, length);
}
