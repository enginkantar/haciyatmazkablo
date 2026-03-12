// POST /api/payment/start
// iyzico CheckoutForm Initialize — ödeme oturumu başlatır, paymentPageUrl döner

const PRODUCT = {
  id:           'BASEMO-TC-240W',
  name:         'Hacıyatmaz Kablo Type-C 240W',
  priceNormal:  '821',
  priceDiscount:'799',
  category1:    'Elektronik',
  category2:    'Kablo',
};

// Instagram/TikTok in-app browser'lar bazen Origin header göndermez
// veya farklı origin gönderir — haciyatmazkablo.com içeriyorsa izin ver
function isAllowedOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return true; // Origin yoksa (in-app browser) izin ver
  return origin.includes('haciyatmazkablo.com') || origin.includes('localhost') || origin.includes('192.168.');
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
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
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

// ─── OPTIONS preflight ────────────────────────────────────────────────────────
export async function onRequestOptions(context) {
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

  if (!apiKey || !secretKey) {
    return jsonResp(request, { error: 'Ödeme sistemi yapılandırılmamış.' }, 503);
  }

  const clientIP = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
  if (!(await checkRateLimit(env.PAYMENT_KV, clientIP))) {
    return jsonResp(request, { error: 'Çok fazla istek. Lütfen bir dakika bekleyin.' }, 429);
  }

  let input;
  try { input = await request.json(); }
  catch { return jsonResp(request, { error: 'Geçersiz istek formatı.' }, 400); }

  const { name, email, phone, address, city, price: reqPrice } = input;
  if (!name?.trim() || !email?.trim() || !phone?.trim() || !address?.trim() || !city?.trim()) {
    return jsonResp(request, { error: 'Tüm alanlar zorunludur.' }, 400);
  }

  // İzin verilen fiyat değerleri: 799 (7 dakika indirim) veya 821 (normal)
  const ALLOWED_PRICES = [PRODUCT.priceNormal, PRODUCT.priceDiscount];
  const finalPrice = ALLOWED_PRICES.includes(String(reqPrice)) ? String(reqPrice) : PRODUCT.priceNormal;

  // E-posta ASCII kontrolü (ı, ğ, ş gibi Türkçe karakter iyzico'da hata verir)
  if (!/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(email.trim())) {
    return jsonResp(request, { error: 'Geçerli bir e-posta adresi girin (Türkçe karakter kullanmayın).' }, 400);
  }

  // Ad / Soyad
  const parts     = name.trim().split(/\s+/);
  const firstName = parts[0];
  const lastName  = parts.length > 1 ? parts.slice(1).join(' ') : parts[0];

  // Telefon: iyzico gsmNumber +90 formatı ister
  const cleanPhone = '+90' + phone.replace(/\s/g, '').replace(/^\+90/, '').replace(/^0/, '');

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
      email:               email.trim().toLowerCase(),
      identityNumber:      '11111111111',
      lastLoginDate:       new Date().toISOString().slice(0, 19).replace('T', ' '),
      registrationDate:    new Date().toISOString().slice(0, 19).replace('T', ' '),
      registrationAddress: address.trim(),
      city:                city.trim(),
      country:             'Turkey',
      ip:                  clientIP,
      zipCode:             '00000',
    },
    shippingAddress: {
      contactName: name.trim(),
      city:        city.trim(),
      country:     'Turkey',
      address:     address.trim(),
      zipCode:     '00000',
    },
    billingAddress: {
      contactName: name.trim(),
      city:        city.trim(),
      country:     'Turkey',
      address:     address.trim(),
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

  if (iyzData.status !== 'success' || !iyzData.paymentPageUrl) {
    console.error('[payment/start] iyzico error:', JSON.stringify(iyzData));
    return jsonResp(request, { error: 'Ödeme oturumu başlatılamadı. Lütfen tekrar deneyin.' }, 400);
  }

  // Token → KV (TTL: 30 dakika — iyzico session süresiyle eşleşiyor)
  await env.PAYMENT_KV.put(
    `token:${iyzData.token}`,
    JSON.stringify({
      conversationId,
      basketId,
      amount:           finalPrice,
      customerName:     name.trim(),
      customerEmail:    email.trim().toLowerCase(),
      customerPhone:    phone.trim(),
      customerAddress:  address.trim(),
      customerCity:     city.trim(),
      status:           'PENDING',
      createdAt:        new Date().toISOString(),
    }),
    { expirationTtl: 1800 }
  );

  return jsonResp(request, { paymentPageUrl: iyzData.paymentPageUrl });
}
