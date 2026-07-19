import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { onRequestOptions, onRequestPost as startPayment } from '../functions/api/payment/start.js';
import { onRequestGet as whitelabelInit } from '../functions/api/payment/whitelabel-init.js';
import { onRequestPost as paymentWebhook } from '../functions/api/payment/webhook.js';
import { onRequestPost as notifySuccess } from '../functions/api/payment/notify-success.js';

class MockKV {
  constructor() {
    this.values = new Map();
  }

  async get(key, options) {
    const value = this.values.get(key) ?? null;
    if (options?.type === 'json' && value) return JSON.parse(value);
    return value;
  }

  async put(key, value) {
    this.values.set(key, String(value));
  }
}

const HALKODE_ENV = {
  HALKODE_APP_ID: 'app-id',
  HALKODE_APP_SECRET: 'app-secret',
  HALKODE_MERCHANT_KEY: '$2y$10$testmerchantkey',
};

// HalkÖde API mock: token + checkstatus
function mockHalkodeFetch({ checkstatusOk = true } = {}) {
  return async (url) => {
    const u = String(url);
    if (u.includes('/api/token')) {
      return Response.json({ data: { token: 'halkode-token' } });
    }
    if (u.includes('/api/checkstatus')) {
      return checkstatusOk
        ? Response.json({ status_code: 100, transaction_status: 'Completed', order_id: 'HK-123' })
        : Response.json({ status_code: 0, status_description: 'not paid' });
    }
    throw new Error('unexpected fetch: ' + u);
  };
}

const originalFetch = globalThis.fetch;

try {
  // ─── /api/payment/start ──────────────────────────────────────────────────
  const kv = new MockKV();
  const acceptedAt = new Date().toISOString();

  const startResponse = await startPayment({
    request: new Request('https://www.haciyatmazkablo.com/api/payment/start', {
      method: 'POST',
      headers: {
        Origin: 'https://www.haciyatmazkablo.com',
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '203.0.113.10',
      },
      body: JSON.stringify({
        name: 'Ayşe Yılmaz',
        email: 'ayse@example.com',
        phone: '+90 532 123 45 67',
        city: 'İstanbul',
        district: 'Kadıköy',
        address: 'Caferağa Mahallesi Moda Caddesi No: 1 D: 2',
        acceptedTerms: { onBilgi: true, mesafeli: true, gizlilik: true },
        acceptedAt,
      }),
    }),
    env: { ...HALKODE_ENV, PAYMENT_KV: kv },
  });

  assert.equal(startResponse.status, 200);
  const startData = JSON.parse(await startResponse.text());
  assert.match(startData.link, /^\/odeme\.html\?invoice_id=/);
  const invoiceId = startData.invoice_id;
  assert.ok(invoiceId);

  const storedOrder = JSON.parse(await kv.get(`order:${invoiceId}`));
  assert.equal(storedOrder.amount, '499.99');
  assert.equal(storedOrder.customerPhone, '05321234567');
  assert.equal(storedOrder.customerTown, 'Kadıköy');
  assert.equal(storedOrder.status, 'PENDING');
  assert.match(storedOrder.basketId, /^B-/);

  // Origin kontrolleri
  const invalidOriginResponse = await onRequestOptions({
    request: new Request('https://www.haciyatmazkablo.com/api/payment/start', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example' },
    }),
  });
  assert.equal(invalidOriginResponse.status, 403);

  const previewOriginResponse = await onRequestOptions({
    request: new Request('https://097958ee.haciyatmazkablo.pages.dev/api/payment/start', {
      method: 'OPTIONS',
      headers: { Origin: 'https://097958ee.haciyatmazkablo.pages.dev' },
    }),
  });
  assert.equal(previewOriginResponse.status, 204);

  // Kısa adres reddi
  const shortAddressResponse = await startPayment({
    request: new Request('https://www.haciyatmazkablo.com/api/payment/start', {
      method: 'POST',
      headers: {
        Origin: 'https://www.haciyatmazkablo.com',
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '203.0.113.11',
      },
      body: JSON.stringify({
        name: 'Ali Veli', email: 'ali@example.com', phone: '05321234567',
        city: 'Çorum', district: 'Merkez', address: 'Kısa',
        acceptedTerms: { onBilgi: true, mesafeli: true, gizlilik: true }, acceptedAt,
      }),
    }),
    env: { ...HALKODE_ENV, PAYMENT_KV: kv },
  });
  assert.equal(shortAddressResponse.status, 400);

  // ─── /api/payment/whitelabel-init ────────────────────────────────────────
  const initResponse = await whitelabelInit({
    request: new Request(`https://www.haciyatmazkablo.com/api/payment/whitelabel-init?invoice_id=${invoiceId}`),
    env: { ...HALKODE_ENV, PAYMENT_KV: kv },
  });
  assert.equal(initResponse.status, 200);
  const initData = JSON.parse(await initResponse.text());
  assert.equal(initData.total, '499.99');
  assert.equal(initData.currency_code, 'TRY');
  assert.match(initData.action_url, /paySmart3D$/);
  assert.ok(initData.hash_key && initData.hash_key.split(':').length === 3, 'hash_key sağlayıcı formatında olmalı');
  assert.match(initData.return_url, /odeme-basarili$/);

  const missingInit = await whitelabelInit({
    request: new Request('https://www.haciyatmazkablo.com/api/payment/whitelabel-init?invoice_id=yok-boyle-siparis'),
    env: { ...HALKODE_ENV, PAYMENT_KV: kv },
  });
  assert.equal(missingInit.status, 404);

  // ─── /api/payment/webhook: hash'siz "ödendi" → checkstatus teyidiyle PAID ─
  globalThis.fetch = mockHalkodeFetch({ checkstatusOk: true });
  const webhookResponse = await paymentWebhook({
    request: new Request('https://www.haciyatmazkablo.com/api/payment/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        invoice_id: invoiceId, order_id: 'HK-123', status: 'Completed', payment_status: '1',
      }),
    }),
    env: { ...HALKODE_ENV, PAYMENT_KV: kv },
  });
  assert.equal(webhookResponse.status, 200);
  const webhookData = JSON.parse(await webhookResponse.text());
  assert.equal(webhookData.status, 'paid');

  const paidOrder = JSON.parse(await kv.get(`order:${invoiceId}`));
  assert.ok(['PROCESSED', 'PROCESSED_WITH_WARNINGS'].includes(paidOrder.status), `beklenmedik durum: ${paidOrder.status}`);
  assert.equal(paidOrder.orderNo, 'HK-123');
  assert.ok(paidOrder.notifiedAt, 'fulfillment çalışmış olmalı');
  // Kargo/fatura env yok → uyarıyla işlenmeli, sipariş kaybolmamalı
  assert.ok(paidOrder.kargoError, 'kargo yapılandırması olmadan hata kaydı düşmeli');

  // Idempotency: aynı webhook ikinci kez gelirse tekrar işlenmez
  const replayResponse = await paymentWebhook({
    request: new Request('https://www.haciyatmazkablo.com/api/payment/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        invoice_id: invoiceId, order_id: 'HK-123', status: 'Completed', payment_status: '1',
      }),
    }),
    env: { ...HALKODE_ENV, PAYMENT_KV: kv },
  });
  const replayData = JSON.parse(await replayResponse.text());
  assert.equal(replayData.idempotent, true);

  // ─── Sahte webhook: checkstatus teyidi yoksa PAID yapılmaz ────────────────
  const fakeKv = new MockKV();
  await fakeKv.put('order:fake-invoice', JSON.stringify({
    invoiceId: 'fake-invoice', basketId: 'B-FAKE', amount: '499.99', status: 'PENDING',
    customerName: 'X', customerEmail: 'x@example.com', customerPhone: '05321234567',
    customerAddress: 'Bir mahalle bir sokak 1', customerCity: 'İstanbul', customerTown: 'Kadıköy',
  }));
  globalThis.fetch = mockHalkodeFetch({ checkstatusOk: false });
  const fakeResponse = await paymentWebhook({
    request: new Request('https://www.haciyatmazkablo.com/api/payment/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoice_id: 'fake-invoice', order_id: 'HK-999', status: 'Completed', payment_status: '1' }),
    }),
    env: { ...HALKODE_ENV, PAYMENT_KV: fakeKv },
  });
  const fakeData = JSON.parse(await fakeResponse.text());
  assert.equal(fakeData.success, false);
  assert.equal(JSON.parse(await fakeKv.get('order:fake-invoice')).status, 'PENDING', 'teyitsiz sipariş PAID olmamalı');

  // ─── /api/payment/notify-success: tarayıcı dönüşü + checkstatus teyidi ────
  const notifyKv = new MockKV();
  await notifyKv.put('order:notify-invoice', JSON.stringify({
    invoiceId: 'notify-invoice', basketId: 'B-NTF01', amount: '499.99', status: 'PENDING',
    customerName: 'Ayşe Yılmaz', customerEmail: 'ayse@example.com', customerPhone: '05321234567',
    customerAddress: 'Caferağa Mahallesi Moda Caddesi No: 1 D: 2', customerCity: 'İstanbul', customerTown: 'Kadıköy',
  }));
  globalThis.fetch = mockHalkodeFetch({ checkstatusOk: true });
  const notifyResponse = await notifySuccess({
    request: new Request('https://www.haciyatmazkablo.com/api/payment/notify-success', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoice_id: 'notify-invoice', order_no: 'HK-456', payment_status: '1' }),
    }),
    env: { ...HALKODE_ENV, PAYMENT_KV: notifyKv },
  });
  assert.equal(notifyResponse.status, 200);
  const notifyData = JSON.parse(await notifyResponse.text());
  assert.equal(notifyData.ok, true);
  assert.equal(notifyData.orderNo, 'B-NTF01');
  assert.equal(notifyData.siparis.ad, 'Ayşe Yılmaz');

  // Başarı teyidi olmadan dönüş → PAID yapılmaz
  const pendingKv = new MockKV();
  await pendingKv.put('order:pending-invoice', JSON.stringify({
    invoiceId: 'pending-invoice', basketId: 'B-PND01', amount: '499.99', status: 'PENDING',
  }));
  const pendingResponse = await notifySuccess({
    request: new Request('https://www.haciyatmazkablo.com/api/payment/notify-success', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoice_id: 'pending-invoice' }),
    }),
    env: { ...HALKODE_ENV, PAYMENT_KV: pendingKv },
  });
  assert.equal(pendingResponse.status, 409);

  // ─── Statik dosya kontrolleri ─────────────────────────────────────────────
  const [homeHtml, odemeHtml, errorHtml, successHtml, feedXml, preInfoHtml] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../odeme.html', import.meta.url), 'utf8'),
    readFile(new URL('../odeme-hatasi.html', import.meta.url), 'utf8'),
    readFile(new URL('../odeme-basarili.html', import.meta.url), 'utf8'),
    readFile(new URL('../google-feed.xml', import.meta.url), 'utf8'),
    readFile(new URL('../on-bilgilendirme-formu.html', import.meta.url), 'utf8'),
  ]);
  assert.match(homeHtml, /499,99 TL/);
  assert.match(homeHtml, /script\.js\?v=20260719-halkode/);
  assert.match(odemeHtml, /whitelabel-init/);
  assert.match(odemeHtml, /cc_no/);
  assert.match(successHtml, /notify-success/);
  assert.match(successHtml, /499,99 TL/);
  assert.match(feedXml, /<g:price>499\.99 TRY<\/g:price>/);
  assert.match(preInfoHtml, /499,99 TL, KDV dahil/);
  assert.doesNotMatch(errorHtml, /Hiçbir ücret tahsil edilmedi/,
    'Teknik hata durumunda tahsilat gerçekleşmiş olabilir; genel hata sayfası kesin hüküm vermemeli');
  assert.match(errorHtml, /Tekrar denemeden önce banka hareketlerinizi kontrol edin/);

  console.log('payment-flow.test.mjs: all assertions passed');
} finally {
  globalThis.fetch = originalFetch;
}
