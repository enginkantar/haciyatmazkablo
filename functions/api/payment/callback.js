// POST /api/payment/callback
// iyzico CheckoutForm Retrieve — ödeme sonucunu doğrular, başarı/hata sayfasına yönlendirir
//
// iyzico, kullanıcının browser'ını buraya form POST ile yönlendirir.
// Body: token + conversationId (application/x-www-form-urlencoded)
//
// NOT: Lokal testte iyzico, sandbox HTTPS sayfasından localhost'a POST gönderir.
// Chrome bunu izin verir (localhost potansiyel güvenilir origin sayılır).
// Redirect URL'leri dinamik hesaplanır: localhost'ta local, production'da production.

function getRedirectBase(request) {
  const host = request.headers.get('host') || 'www.haciyatmazkablo.com';
  // localhost, 127.0.0.1 veya LAN IP (192.168.x.x) → HTTP lokal
  if (host.startsWith('localhost') || host.startsWith('127.0.0.1') || host.startsWith('192.168.')) {
    return `http://${host}`;
  }
  return 'https://www.haciyatmazkablo.com';
}

// ─── PKI + HMAC (start.js ile aynı yardımcılar) ──────────────────────────────
function randomKey(len = 16) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}

function toPKI(val) {
  if (val === null || val === undefined) return '';
  if (Array.isArray(val)) return '[' + val.map(toPKI).join(', ') + ']';
  if (typeof val === 'object') {
    const parts = [];
    for (const [k, v] of Object.entries(val)) {
      if (v === null || v === undefined) continue;
      if (Array.isArray(v))           parts.push(`${k}=[${v.map(toPKI).join(', ')}]`);
      else if (typeof v === 'object') parts.push(`${k}=${toPKI(v)}`);
      else                            parts.push(`${k}=${v}`);
    }
    return '[' + parts.join(', ') + ']';
  }
  return String(val);
}

async function iyzicoAuthHeader(apiKey, secretKey, rnd, uri, body) {
  const payload = rnd + uri + JSON.stringify(body);
  const keyMat  = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secretKey),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sigBuf = await crypto.subtle.sign('HMAC', keyMat, new TextEncoder().encode(payload));
  const sigHex = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
  const auth   = `apiKey:${apiKey}&randomKey:${rnd}&signature:${sigHex}`;
  return 'IYZWSv2 ' + btoa(auth);
}

// ─── iyzico response signature doğrulama ─────────────────────────────────────
// Alan sırası (iyzipay SDK samples.js'ten): paymentStatus:paymentId:currency:basketId:conversationId:paidPrice:price:token
// Encoding: hex(HMAC-SHA256(secretKey, fields.join(':')))
async function verifyResponseSignature(secretKey, data) {
  if (!data.signature) return true; // signature dönmüyorsa geç (bazı sandbox yanıtlarında olmayabilir)

  const candidate = [
    data.paymentStatus,
    data.paymentId,
    data.currency,
    data.basketId,
    data.conversationId,
    String(data.paidPrice),
    String(data.price),
    data.token,
  ].filter(v => v !== undefined && v !== null && v !== 'undefined').join(':');

  const keyMat  = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secretKey),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sigBuf  = await crypto.subtle.sign('HMAC', keyMat, new TextEncoder().encode(candidate));
  const computed = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('');

  if (computed !== data.signature) {
    console.warn('[payment/callback] Signature mismatch — computed:', computed, 'received:', data.signature);
    return false;
  }
  return true;
}

function redirect(url) {
  return Response.redirect(url, 302);
}

// ─── Ortak işlem mantığı ──────────────────────────────────────────────────────
async function processCallback(request, env, token, conversationId) {
  const base       = getRedirectBase(request);
  // Cloudflare Pages clean URL'leri tercih eder — .html olmadan kullan (ekstra 308 redirect önler)
  const SUCCESS    = `${base}/odeme-basarili`;
  const ERROR      = `${base}/odeme-hatasi`;

  const apiKey    = env.IYZICO_API_KEY;
  const secretKey = env.IYZICO_SECRET_KEY;
  const baseUrl   = env.IYZICO_BASE_URL || 'https://api.iyzipay.com';

  // Config guard — KV veya secret yoksa kod ilerlemeden patlar
  if (!apiKey || !secretKey || !env.PAYMENT_KV) {
    console.error('[payment/callback] missing configuration');
    return redirect(`${ERROR}?reason=config`);
  }

  if (!token) {
    return redirect(`${ERROR}?reason=no_token`);
  }

  // KV'den token'ı al
  const kvRaw = await env.PAYMENT_KV.get(`token:${token}`);
  if (!kvRaw) {
    return redirect(`${ERROR}?reason=expired`);
  }

  let kvData;
  try { kvData = JSON.parse(kvRaw); }
  catch { return redirect(`${ERROR}?reason=internal`); }

  // Idempotency — daha önce işlendiyse tekrar işleme
  if (kvData.status === 'PROCESSED') {
    return redirect(`${SUCCESS}?order=${kvData.basketId}`);
  }

  // conversationId eşleşmeli (replay koruması)
  if (conversationId && kvData.conversationId !== conversationId) {
    console.warn('[payment/callback] conversationId mismatch');
    return redirect(`${ERROR}?reason=invalid`);
  }

  // ─── CF Retrieve ────────────────────────────────────────────────────────────
  const retrieveBody = {
    locale:         'tr',
    conversationId: kvData.conversationId,
    token,
  };

  const retrieveUri   = '/payment/iyzipos/checkoutform/auth/ecom/detail';
  const rnd           = randomKey();
  const authorization = await iyzicoAuthHeader(apiKey, secretKey, rnd, retrieveUri, retrieveBody);

  let retrieveData;
  try {
    const resp = await fetch(
      `${baseUrl}${retrieveUri}`,
      {
        method:  'POST',
        headers: {
          Authorization:  authorization,
          'x-iyzi-rnd':   rnd,
          'Content-Type': 'application/json',
          Accept:         'application/json',
        },
        body: JSON.stringify(retrieveBody),
      }
    );
    retrieveData = await resp.json();
  } catch (err) {
    console.error('[payment/callback] retrieve fetch error:', err);
    return redirect(`${ERROR}?reason=retrieve_error`);
  }

  console.log('[payment/callback] iyzico retrieve:', JSON.stringify(retrieveData));

  // Response signature doğrula
  const sigValid = await verifyResponseSignature(secretKey, retrieveData);
  if (!sigValid) {
    console.error('[payment/callback] Signature doğrulama başarısız:', JSON.stringify(retrieveData));
    return redirect(`${ERROR}?reason=sig_invalid`);
  }

  // Amount doğrula
  if (retrieveData.paidPrice && String(retrieveData.paidPrice) !== String(kvData.amount)) {
    console.error('[payment/callback] Tutar uyuşmazlığı:', retrieveData.paidPrice, '!=', kvData.amount);
    return redirect(`${ERROR}?reason=amount_mismatch`);
  }

  // Payment status kontrolü
  if (retrieveData.paymentStatus !== 'SUCCESS') {
    console.warn('[payment/callback] Ödeme başarısız:', retrieveData.paymentStatus);
    await env.PAYMENT_KV.put(
      `token:${token}`,
      JSON.stringify({ ...kvData, status: 'FAILED', failedAt: new Date().toISOString(), reason: retrieveData.paymentStatus }),
      { expirationTtl: 3600 }
    );
    return redirect(`${ERROR}?reason=payment_failed`);
  }

  // ─── Başarılı ───────────────────────────────────────────────────────────────
  await env.PAYMENT_KV.put(
    `token:${token}`,
    JSON.stringify({
      ...kvData,
      status:      'PROCESSED',
      paymentId:   retrieveData.paymentId,
      processedAt: new Date().toISOString(),
    }),
    { expirationTtl: 86400 } // 24 saat audit için
  );

  // ─── Telegram bildirimi ───────────────────────────────────────────────────
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    const msg =
`🛍️ YENİ SİPARİŞ!

📦 Ürün: Hacıyatmaz Kablo Type-C 240W
💰 Tutar: ${kvData.amount} TL
🔖 Sipariş No: ${kvData.basketId}

👤 Ad: ${kvData.customerName}
📧 E-posta: ${kvData.customerEmail}
📱 Telefon: ${kvData.customerPhone}

📍 Adres:
${kvData.customerAddress}
${kvData.customerCity}`;

    try {
      await fetch(
        `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            chat_id: env.TELEGRAM_CHAT_ID,
            text:    msg,
          }),
        }
      );
    } catch (e) {
      console.error('[callback] Telegram bildirim hatası:', e.message);
    }
  }

  return redirect(`${SUCCESS}?order=${kvData.basketId}`);
}

// ─── POST handler (iyzico form POST) ──────────────────────────────────────────
export async function onRequestPost(context) {
  const { request, env } = context;

  // iyzico form POST (application/x-www-form-urlencoded) parse
  let token, conversationId;
  try {
    const form = await request.formData();
    token          = form.get('token');
    conversationId = form.get('conversationId');
  } catch {
    const base = getRedirectBase(request);
    return redirect(`${base}/odeme-hatasi?reason=parse_error`);
  }

  return processCallback(request, env, token, conversationId);
}

// ─── GET handler (bazı tarayıcı/iyzico konfigürasyonlarında GET redirect gelir) ─
// Örn: iyzico callbackUrl?token=xxx&conversationId=yyy şeklinde yönlendirirse
export async function onRequestGet(context) {
  const { request, env } = context;
  const url            = new URL(request.url);
  const token          = url.searchParams.get('token');
  const conversationId = url.searchParams.get('conversationId');

  if (!token) {
    // Token yoksa — muhtemelen doğrudan ziyaret; anasayfaya yönlendir
    return redirect(getRedirectBase(request) + '/');
  }

  return processCallback(request, env, token, conversationId);
}
