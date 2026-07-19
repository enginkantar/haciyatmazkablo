// POST /api/payment/start
// HalkÖde white-label ödeme — siparişi KV'ye yazar, markalı kart sayfasının
// linkini döner. Kart verisi bu sunucuya HİÇ gelmez; /odeme.html formu
// doğrudan HalkÖde paySmart3D'ye POST eder.

const PRODUCT = {
  id:           'BASEMO-TC-240W',
  name:         'Hacıyatmaz Kablo Tip C 240W',
  priceNormal:  '499.99',
  category1:    'Elektronik',
  category2:    'Kablo',
};

function isAllowedOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return true; // ödeme sağlayıcı dönüşleri ve bazı uygulama içi tarayıcılar
  try {
    const { hostname } = new URL(origin);
    return hostname === 'haciyatmazkablo.com' ||
      hostname === 'www.haciyatmazkablo.com' ||
      hostname === 'haciyatmazkablo.pages.dev' ||
      hostname.endsWith('.haciyatmazkablo.pages.dev') ||
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

// ─── Turnstile bot doğrulaması ────────────────────────────────────────────────
async function verifyTurnstile(secret, token, ip) {
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set('remoteip', ip);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
    });
    const data = await res.json();
    return data.success === true;
  } catch (e) {
    console.error('[turnstile] verify error:', e.message);
    return false;
  }
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

  if (!env.HALKODE_APP_ID || !env.HALKODE_APP_SECRET || !env.HALKODE_MERCHANT_KEY || !env.PAYMENT_KV) {
    console.error('[payment/start] missing HalkÖde configuration');
    return jsonResp(request, { error: 'Ödeme sistemi yapılandırılmamış.' }, 503);
  }

  const clientIP = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
  if (!(await checkRateLimit(env.PAYMENT_KV, clientIP))) {
    return jsonResp(request, { error: 'Çok fazla istek. Lütfen bir dakika bekleyin.' }, 429);
  }

  let input;
  try { input = await request.json(); }
  catch { return jsonResp(request, { error: 'Geçersiz istek formatı.' }, 400); }

  if (env.TURNSTILE_SECRET) {
    const tsToken = input?.turnstileToken || input?.['cf-turnstile-response'] || '';
    if (!(await verifyTurnstile(env.TURNSTILE_SECRET, tsToken, clientIP))) {
      return jsonResp(request, { error: 'Güvenlik doğrulaması başarısız. Sayfayı yenileyip tekrar deneyin.' }, 403);
    }
  }

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

  if (!/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(email)) {
    return jsonResp(request, { error: 'Geçerli bir e-posta adresi girin (Türkçe karakter kullanmayın).' }, 400);
  }

  const phoneDigits = phone.replace(/\D/g, '').replace(/^90/, '').replace(/^0/, '');
  if (!/^5\d{9}$/.test(phoneDigits)) {
    return jsonResp(request, { error: 'Telefon numarası 05XXXXXXXXX biçiminde olmalıdır.' }, 400);
  }
  const localPhone = '0' + phoneDigits;

  const invoiceId = crypto.randomUUID();
  const basketId  = 'B-' + crypto.randomUUID().slice(0, 8).toUpperCase();

  await env.PAYMENT_KV.put(
    `order:${invoiceId}`,
    JSON.stringify({
      invoiceId,
      basketId,
      orderNo:          '',
      amount:           finalPrice,
      currency:         'TRY',
      quantity:         1,
      package:          PRODUCT.name,
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
    { expirationTtl: 604800 }
  );

  return jsonResp(request, {
    link: `/odeme?invoice_id=${encodeURIComponent(invoiceId)}`,
    invoice_id: invoiceId,
  });
}
