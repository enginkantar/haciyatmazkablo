// POST /api/payment/start
// iyzico CheckoutForm Initialize — gömülü ödeme formunu başlatır

const PRODUCT = {
  id:           'BASEMO-TC-240W',
  name:         'Hacıyatmaz Kablo Tip C 240W',
  priceNormal:  '499.99',
  category1:    'Elektronik',
  category2:    'Kablo',
};

function isAllowedOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return true; // iyzico callback ve bazı uygulama içi tarayıcılar
  try {
    const { hostname } = new URL(origin);
    return hostname === 'haciyatmazkablo.com' ||
      hostname === 'www.haciyatmazkablo.com' ||
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.startsWith('192.168.');
  } catch {
    return false;
  }
}

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || 'https://www.haciyatmazkablo.com';
  return {
    'Access-Control-Allow-Origin':  origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

// ─── Yardımcı: random string ─────────────────────────────────────────────────
function randomKey(len = 16) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}

// ─── iyzico PKI string formatı ───────────────────────────────────────────────
function toPKI(val) {
  if (val === null || val === undefined) return '';
  if (Array.isArray(val)) {
    return '[' + val.map(toPKI).join(', ') + ']';
  }
  if (typeof val === 'object') {
    const parts = [];
    for (const [k, v] of Object.entries(val)) {
      if (v === null || v === undefined) continue;
      if (Array.isArray(v))         parts.push(`${k}=[${v.map(toPKI).join(', ')}]`);
      else if (typeof v === 'object') parts.push(`${k}=${toPKI(v)}`);
      else                            parts.push(`${k}=${v}`);
    }
    return '[' + parts.join(', ') + ']';
  }
  return String(val);
}

// ─── iyzico IYZWSv2 Authorization header ─────────────────────────────────────
// payload  = rnd + uri + JSON.stringify(body)
// hash     = hex(HMAC-SHA256(secretKey, payload))
// authStr  = "apiKey:xxx&randomKey:xxx&signature:xxx"  ← camelCase, ":"
// header   = "IYZWSv2 " + base64(authStr)
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

function jsonResp(request, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type':  'application/json',
      'Cache-Control': 'no-store',
      ...corsHeaders(request),
    },
  });
}

// ─── Rate limit: 10 req/min per IP (KV tabanlı) ───────────────────────────────
async function checkRateLimit(kv, ip) {
  const key   = `rl:start:${ip}`;
  const raw   = await kv.get(key);
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= 10) return false;
  await kv.put(key, String(count + 1), { expirationTtl: 60 });
  return true;
}

function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

// ─── OPTIONS preflight ────────────────────────────────────────────────────────
export async function onRequestOptions(context) {
  if (!isAllowedOrigin(context.request)) {
    return new Response('Forbidden', { status: 403 });
  }
  return new Response(null, { status: 204, headers: corsHeaders(context.request) });
}

// ─── POST handler ─────────────────────────────────────────────────────────────
export async function onRequestPost(context) {
  const { request, env } = context;

  if (!isAllowedOrigin(request)) {
    return new Response('Forbidden', { status: 403 });
  }

  const apiKey      = env.IYZICO_API_KEY;
  const secretKey   = env.IYZICO_SECRET_KEY;
  const baseUrl     = env.IYZICO_BASE_URL     || 'https://api.iyzipay.com';
  const callbackUrl = env.IYZICO_CALLBACK_URL || 'https://www.haciyatmazkablo.com/api/payment/callback';

  if (!apiKey || !secretKey || !env.PAYMENT_KV) {
    return jsonResp(request, { error: 'Ödeme sistemi yapılandırılmamış.' }, 503);
  }

  const clientIP = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
  if (!(await checkRateLimit(env.PAYMENT_KV, clientIP))) {
    return jsonResp(request, { error: 'Çok fazla istek. Lütfen bir dakika bekleyin.' }, 429);
  }

  let input;
  try { input = await request.json(); }
  catch { return jsonResp(request, { error: 'Geçersiz istek formatı.' }, 400); }

  const name    = cleanText(input?.name, 100);
  const email   = cleanText(input?.email, 150);
  const phone   = cleanText(input?.phone, 20);
  const address = cleanText(input?.address, 500);
  const city    = cleanText(input?.city, 80);
  const district = cleanText(input?.district, 80);
  const acceptedTerms = input?.acceptedTerms;
  const acceptedAt = cleanText(input?.acceptedAt, 40);
  if (!name || !email || !phone || !address || !city || !district) {
    return jsonResp(request, { error: 'Tüm alanlar zorunludur.' }, 400);
  }
  if (name.length < 3 || address.length < 10) {
    return jsonResp(request, { error: 'Ad soyad en az 3, açık adres en az 10 karakter olmalıdır.' }, 400);
  }
  const locationPattern = /^[\p{L} .'-]{2,80}$/u;
  if (!locationPattern.test(city) || !locationPattern.test(district)) {
    return jsonResp(request, { error: 'Şehir veya ilçe bilgisi geçersiz.' }, 400);
  }
  if (!acceptedTerms?.onBilgi || !acceptedTerms?.mesafeli || !acceptedTerms?.gizlilik) {
    return jsonResp(request, { error: 'Ödeme öncesinde tüm sözleşmeleri onaylamanız gerekir.' }, 400);
  }
  const acceptedAtDate = new Date(acceptedAt);
  if (!acceptedAt || Number.isNaN(acceptedAtDate.getTime()) || Math.abs(Date.now() - acceptedAtDate.getTime()) > 3600000) {
    return jsonResp(request, { error: 'Sözleşme kabul zamanı geçersiz. Lütfen formu yeniden onaylayın.' }, 400);
  }

  // Fiyat yalnızca sunucuda belirlenir; istemciden fiyat kabul edilmez.
  const finalPrice = PRODUCT.priceNormal;

  // E-posta ASCII kontrolü (ı, ğ, ş gibi Türkçe karakter iyzico'da hata verir)
  if (!/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(email)) {
    return jsonResp(request, { error: 'Geçerli bir e-posta adresi girin (Türkçe karakter kullanmayın).' }, 400);
  }

  // Ad / Soyad
  const parts     = name.split(/\s+/);
  const firstName = parts[0];
  const lastName  = parts.length > 1 ? parts.slice(1).join(' ') : parts[0];

  // Telefon: iyzico gsmNumber +90 formatı ister
  const phoneDigits = phone.replace(/\D/g, '').replace(/^90/, '').replace(/^0/, '');
  if (!/^5\d{9}$/.test(phoneDigits)) {
    return jsonResp(request, { error: 'Telefon numarası 05XXXXXXXXX biçiminde olmalıdır.' }, 400);
  }
  const cleanPhone = '+90' + phoneDigits;
  const localPhone = '0' + phoneDigits;

  const conversationId = crypto.randomUUID();
  const basketId       = 'B-' + crypto.randomUUID().slice(0, 8).toUpperCase();
  const buyerId        = 'C-' + crypto.randomUUID().slice(0, 8).toUpperCase();

  const iyziBody = {
    locale:       'tr',
    conversationId,
    price:        finalPrice,
    paidPrice:    finalPrice,
    currency:     'TRY',
    installment:  '1',
    basketId,
    paymentGroup: 'PRODUCT',
    callbackUrl:  callbackUrl,
    buyer: {
      id:                  buyerId,
      name:                firstName,
      surname:             lastName,
      gsmNumber:           cleanPhone,
      email:               email.toLowerCase(),
      identityNumber:      '11111111111',
      lastLoginDate:       new Date().toISOString().slice(0, 19).replace('T', ' '),
      registrationDate:    new Date().toISOString().slice(0, 19).replace('T', ' '),
      registrationAddress: `${address}, ${district}`,
      city,
      country:             'Turkey',
      ip:                  clientIP,
      zipCode:             '00000',
    },
    shippingAddress: {
      contactName: name,
      city,
      country:     'Turkey',
      address: `${address}, ${district}`,
      zipCode:     '00000',
    },
    billingAddress: {
      contactName: name,
      city,
      country:     'Turkey',
      address: `${address}, ${district}`,
      zipCode:     '00000',
    },
    basketItems: [{
      id:        PRODUCT.id,
      name:      PRODUCT.name,
      category1: PRODUCT.category1,
      category2: PRODUCT.category2,
      itemType:  'PHYSICAL',
      price:     finalPrice,
    }],
  };

  const initUri       = '/payment/iyzipos/checkoutform/initialize/auth/ecom';
  const rnd           = randomKey();
  const authorization = await iyzicoAuthHeader(apiKey, secretKey, rnd, initUri, iyziBody);

  let iyzData;
  try {
    const resp = await fetch(
      `${baseUrl}${initUri}`,
      {
        method:  'POST',
        headers: {
          Authorization:  authorization,
          'x-iyzi-rnd':   rnd,
          'Content-Type': 'application/json',
          Accept:         'application/json',
        },
        body: JSON.stringify(iyziBody),
      }
    );
    iyzData = await resp.json();
  } catch (err) {
    console.error('[payment/start] fetch error:', err);
    return jsonResp(request, { error: 'Ödeme sistemine bağlanılamadı. Lütfen tekrar deneyin.' }, 502);
  }

  if (iyzData.status !== 'success' || !iyzData.token || !iyzData.checkoutFormContent) {
    console.error('[payment/start] iyzico error:', JSON.stringify({
      status: iyzData.status,
      errorCode: iyzData.errorCode,
      errorMessage: iyzData.errorMessage,
      hasToken: !!iyzData.token,
      hasEmbeddedForm: !!iyzData.checkoutFormContent,
      hasExternalPage: !!iyzData.paymentPageUrl,
    }));
    return jsonResp(request, { error: 'Ödeme oturumu başlatılamadı. Lütfen tekrar deneyin.' }, 400);
  }

  // Token → KV (TTL: 30 dakika — iyzico session süresiyle eşleşiyor)
  await env.PAYMENT_KV.put(
    `token:${iyzData.token}`,
    JSON.stringify({
      conversationId,
      basketId,
      amount:           finalPrice,
      customerName:     name,
      customerEmail:    email.toLowerCase(),
      customerPhone:    localPhone,
      customerAddress:  address,
      customerCity:     city,
      customerTown:     district,
      acceptedAt:       acceptedAtDate.toISOString(),
      acceptedTerms:    { onBilgi: true, mesafeli: true, gizlilik: true },
      termsVersion:     '2026-07-14',
      status:           'PENDING',
      createdAt:        new Date().toISOString(),
    }),
    { expirationTtl: 1800 }
  );

  return jsonResp(request, {
    checkoutFormContent: iyzData.checkoutFormContent,
  });
}
