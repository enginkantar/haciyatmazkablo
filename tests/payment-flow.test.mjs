import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { onRequestOptions, onRequestPost as startPayment } from '../functions/api/payment/start.js';
import { onRequestPost as paymentCallback } from '../functions/api/payment/callback.js';

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

const originalFetch = globalThis.fetch;

try {
  const kv = new MockKV();
  let iyzicoInitializeBody;

  globalThis.fetch = async (_url, options) => {
    iyzicoInitializeBody = JSON.parse(options.body);
    return Response.json({
      status: 'success',
      token: 'start-token',
      checkoutFormContent: '<div id="iyzipay-checkout-form"></div>',
    });
  };

  const acceptedAt = new Date().toISOString();
  const startRequest = new Request('https://www.haciyatmazkablo.com/api/payment/start', {
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
  });

  const startResponse = await startPayment({
    request: startRequest,
    env: {
      IYZICO_API_KEY: 'test-key',
      IYZICO_SECRET_KEY: 'test-secret',
      IYZICO_BASE_URL: 'https://mock.iyzico.test',
      PAYMENT_KV: kv,
    },
  });

  assert.equal(startResponse.status, 200);
  assert.equal(iyzicoInitializeBody.price, '499.99');
  assert.equal(iyzicoInitializeBody.buyer.gsmNumber, '+905321234567');
  assert.equal(iyzicoInitializeBody.shippingAddress.city, 'İstanbul');
  assert.match(iyzicoInitializeBody.shippingAddress.address, /Kadıköy/);

  const storedStartOrder = JSON.parse(await kv.get('token:start-token'));
  assert.equal(storedStartOrder.customerPhone, '05321234567');
  assert.equal(storedStartOrder.customerTown, 'Kadıköy');
  assert.equal(storedStartOrder.termsVersion, '2026-07-14');

  const invalidOriginResponse = await onRequestOptions({
    request: new Request('https://www.haciyatmazkablo.com/api/payment/start', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example' },
    }),
  });
  assert.equal(invalidOriginResponse.status, 403);

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
    env: { IYZICO_API_KEY: 'x', IYZICO_SECRET_KEY: 'y', PAYMENT_KV: kv },
  });
  assert.equal(shortAddressResponse.status, 400);

  globalThis.fetch = async () => Response.json({
    status: 'success', token: 'redirect-only-token', paymentPageUrl: 'https://pay.example.test',
  });
  const redirectOnlyResponse = await startPayment({
    request: new Request('https://www.haciyatmazkablo.com/api/payment/start', {
      method: 'POST',
      headers: {
        Origin: 'https://www.haciyatmazkablo.com',
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '203.0.113.12',
      },
      body: JSON.stringify({
        name: 'Ali Veli', email: 'ali@example.com', phone: '05321234567',
        city: 'Çorum', district: 'Merkez', address: 'Bahçelievler Mahallesi No 2',
        acceptedTerms: { onBilgi: true, mesafeli: true, gizlilik: true }, acceptedAt,
      }),
    }),
    env: { IYZICO_API_KEY: 'x', IYZICO_SECRET_KEY: 'y', PAYMENT_KV: kv },
  });
  assert.equal(redirectOnlyResponse.status, 400, 'White-label akış harici ödeme sayfasına düşmemeli');

  const callbackKv = new MockKV();
  await callbackKv.put('token:callback-token', JSON.stringify({
    conversationId: 'conversation-1',
    basketId: 'B-ORDER01',
    amount: '499.99',
    customerName: 'Ayşe Yılmaz',
    customerEmail: 'ayse@example.com',
    customerPhone: '05321234567',
    customerAddress: 'Caferağa Mahallesi Moda Caddesi No: 1 D: 2',
    customerCity: 'İstanbul',
    customerTown: 'Kadıköy',
    status: 'PENDING',
  }));

  let retrieveCalls = 0;
  globalThis.fetch = async () => {
    retrieveCalls += 1;
    return Response.json({
      status: 'success',
      paymentStatus: 'SUCCESS',
      paymentId: 'payment-1',
      currency: 'TRY',
      basketId: 'B-ORDER01',
      conversationId: 'conversation-1',
      paidPrice: '499.99',
      price: '499.99',
      token: 'callback-token',
    });
  };

  const callbackRequest = () => new Request('https://www.haciyatmazkablo.com/api/payment/callback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: 'callback-token', conversationId: 'conversation-1' }),
  });

  const callbackResponse = await paymentCallback({
    request: callbackRequest(),
    env: {
      IYZICO_API_KEY: 'test-key',
      IYZICO_SECRET_KEY: 'test-secret',
      IYZICO_BASE_URL: 'https://mock.iyzico.test',
      PAYMENT_KV: callbackKv,
    },
  });

  assert.equal(callbackResponse.status, 302);
  assert.match(callbackResponse.headers.get('location'), /odeme-basarili/);
  assert.equal(retrieveCalls, 1);
  const processedOrder = JSON.parse(await callbackKv.get('token:callback-token'));
  assert.equal(processedOrder.status, 'PROCESSED_WITH_WARNINGS');
  assert.match(processedOrder.kargoError, /token yok/);
  assert.match(processedOrder.faturaError, /yapılandırması eksik/);
  assert.match(processedOrder.telegramError, /yapılandırması eksik/);

  const replayResponse = await paymentCallback({
    request: callbackRequest(),
    env: {
      IYZICO_API_KEY: 'test-key',
      IYZICO_SECRET_KEY: 'test-secret',
      IYZICO_BASE_URL: 'https://mock.iyzico.test',
      PAYMENT_KV: callbackKv,
    },
  });
  assert.equal(replayResponse.status, 302);
  assert.equal(retrieveCalls, 1, 'İşlenmiş sipariş iyzico veya entegrasyonları yeniden çağırmamalı');

  const tamperKv = new MockKV();
  await tamperKv.put('token:tampered-token', JSON.stringify({
    conversationId: 'conversation-2', basketId: 'B-ORDER02', amount: '499.99', status: 'PENDING',
  }));
  globalThis.fetch = async () => Response.json({
    status: 'success', paymentStatus: 'SUCCESS', paymentId: 'payment-2', currency: 'TRY',
    basketId: 'B-ORDER02', conversationId: 'conversation-2', paidPrice: '499.98', price: '499.99',
    token: 'tampered-token',
  });
  const tamperResponse = await paymentCallback({
    request: new Request('https://www.haciyatmazkablo.com/api/payment/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: 'tampered-token', conversationId: 'conversation-2' }),
    }),
    env: {
      IYZICO_API_KEY: 'test-key', IYZICO_SECRET_KEY: 'test-secret',
      IYZICO_BASE_URL: 'https://mock.iyzico.test', PAYMENT_KV: tamperKv,
    },
  });
  assert.match(tamperResponse.headers.get('location'), /amount_mismatch/);

  const [homeHtml, errorHtml, successHtml, feedXml, preInfoHtml] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../odeme-hatasi.html', import.meta.url), 'utf8'),
    readFile(new URL('../odeme-basarili.html', import.meta.url), 'utf8'),
    readFile(new URL('../google-feed.xml', import.meta.url), 'utf8'),
    readFile(new URL('../on-bilgilendirme-formu.html', import.meta.url), 'utf8'),
  ]);
  assert.match(homeHtml, /499,99 TL/);
  assert.match(successHtml, /499,99 TL/);
  assert.match(feedXml, /<g:price>499\.99 TRY<\/g:price>/);
  assert.match(preInfoHtml, /499,99 TL, KDV dahil/);
  assert.doesNotMatch(errorHtml, /Hiçbir ücret tahsil edilmedi/,
    'Teknik callback hatasında tahsilat gerçekleşmiş olabilir; genel hata sayfası kesin hüküm vermemeli');
  assert.match(errorHtml, /Tekrar denemeden önce banka hareketlerinizi kontrol edin/);

  console.log('payment-flow.test.mjs: all assertions passed');
} finally {
  globalThis.fetch = originalFetch;
}
