// GET /api/payment/whitelabel-init?invoice_id=...
// /odeme.html kart formu için hazır alanlar + paySmart3D hash'i döner.
import { getPlatformodeBase, generatePaySmart3dHashKey } from '../../lib/halkode.js';

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const url = new URL(request.url);
    const invoiceId = (url.searchParams.get('invoice_id') || '').trim();
    if (!invoiceId) return jsonResp({ error: 'invoice_id required' }, 400);
    if (!env.PAYMENT_KV) return jsonResp({ error: 'KV not configured' }, 503);
    if (!env.HALKODE_APP_ID || !env.HALKODE_APP_SECRET || !env.HALKODE_MERCHANT_KEY) {
      return jsonResp({ error: 'Ödeme sistemi yapılandırılmamış.' }, 503);
    }

    const raw = await env.PAYMENT_KV.get(`order:${invoiceId}`, { type: 'text' });
    if (!raw) return jsonResp({ error: 'Sipariş bulunamadı ya da süresi doldu.' }, 404);

    const order = JSON.parse(raw);
    const total = Number(order.amount || 0).toFixed(2);
    const nameParts = String(order.customerName || '').trim().split(/\s+/);
    const firstName = nameParts.slice(0, -1).join(' ') || String(order.customerName || '').trim();
    const lastName = nameParts.slice(-1)[0] || '-';
    const baseUrl = env.BASE_URL || 'https://www.haciyatmazkablo.com';
    const platformodeBase = getPlatformodeBase(env);

    const hashKey = await generatePaySmart3dHashKey(
      total, 1, 'TRY', env.HALKODE_MERCHANT_KEY, invoiceId, env.HALKODE_APP_SECRET
    );

    return jsonResp({
      action_url: `${platformodeBase}/api/paySmart3D`,
      invoice_id: invoiceId,
      invoice_description: `Hacıyatmaz Kablo Tip C 240W - Sipariş ${order.basketId || ''}`.trim(),
      total,
      merchant_key: env.HALKODE_MERCHANT_KEY,
      currency_id: 1,
      currency_code: 'TRY',
      items: [{
        name: 'Haciyatmaz Kablo Tip C 240W',
        price: total,
        quantity: 1,
        description: '240W E-Marker cipli Tip C kablo',
      }],
      return_url: `${baseUrl}/odeme-basarili`,
      cancel_url: `${baseUrl}/odeme-hatasi`,
      response_method: 'GET',
      name: firstName,
      surname: lastName,
      bill_address1: String(order.customerAddress || '').trim().substring(0, 100),
      bill_city: String(order.customerCity || '').trim(),
      bill_state: String(order.customerCity || '').trim(),
      bill_country: 'TURKEY',
      bill_postcode: '',
      bill_email: String(order.customerEmail || '').trim().toLowerCase(),
      bill_phone: String(order.customerPhone || '').trim(),
      sale_web_hook_key: env.WEBHOOK_SECRET || '',
      ip: request.headers.get('CF-Connecting-IP') || '',
      saved_card: 0,
      maturity_period: 0,
      payment_frequency: 0,
      installments_number: 1,
      transaction_type: 'Auth',
      hash_key: hashKey,
      order_id: order.orderNo || '',
      basket_id: order.basketId || '',
      amount_label: total,
    });
  } catch (e) {
    console.error('[whitelabel-init] error:', e.message);
    return jsonResp({ error: e.message }, 500);
  }
}
