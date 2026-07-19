// POST /api/payment/notify-success — tarayıcı dönüşü (odeme-basarili sayfası).
// Müşteri beyanına güvenilmez: PAID'e geçirmeden önce sağlayıcıdan
// checkstatus ile sunucu-sunucu teyit alınır.
import { validateHash, checkOrderStatus } from '../../lib/halkode.js';
import { fulfillPaidOrder } from '../../lib/fulfill.js';

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    let body;
    try { body = await request.json(); }
    catch { return jsonResp({ error: 'Invalid JSON' }, 400); }

    const { order_id, order_no, invoice_id, payment_status, status, hash_key } = body;
    const invoiceId = String(invoice_id || '').trim();
    const incomingOrderId = String(order_id || order_no || '').trim();
    const incomingStatus = status ?? (String(payment_status) === '1' ? 'Completed' : '');
    const isSuccessHint = String(payment_status ?? '') === '1' || incomingStatus === 'Completed';

    if (!env.PAYMENT_KV) return jsonResp({ error: 'KV not configured' }, 503);
    if (!invoiceId) return jsonResp({ ok: false, note: 'invoice not found' });

    const orderRaw = await env.PAYMENT_KV.get(`order:${invoiceId}`, { type: 'text' });
    if (!orderRaw) return jsonResp({ ok: false, note: 'order not found' });

    let order;
    try { order = JSON.parse(orderRaw); }
    catch { return jsonResp({ error: 'Invalid order data' }, 500); }

    if (order.status === 'PENDING') {
      if (!isSuccessHint) return jsonResp({ ok: false, note: 'payment confirmation pending' }, 409);

      if (hash_key && env.HALKODE_APP_SECRET) {
        const validated = await validateHash(hash_key, incomingStatus || 'Completed', incomingOrderId || order.orderNo || '', invoiceId, env.HALKODE_APP_SECRET);
        if (!validated) console.warn('[notify] hash geçersiz — checkstatus ile teyit edilecek:', invoiceId);
      }

      const statusCheck = await checkOrderStatus(env, invoiceId);
      if (!statusCheck.ok) {
        return jsonResp({ ok: false, note: statusCheck.error || 'payment confirmation pending' }, 409);
      }

      order.status = 'PAID';
      order.paidAt = new Date().toISOString();
      order.orderNo = incomingOrderId || statusCheck.orderId || order.orderNo || '';
      await env.PAYMENT_KV.put(`order:${invoiceId}`, JSON.stringify(order), { expirationTtl: 86400 * 30 });
    }

    if (order.status !== 'PAID' && order.status !== 'PROCESSED' && order.status !== 'PROCESSED_WITH_WARNINGS') {
      return jsonResp({ ok: false, note: `order status is ${order.status}` });
    }

    const fulfillment = await fulfillPaidOrder(env, order, invoiceId, 'browser');
    const o = fulfillment.order || order;
    return jsonResp({
      ok: true,
      idempotent: !!fulfillment.idempotent,
      amount: o.amount,
      currency: o.currency || 'TRY',
      orderNo: o.basketId || o.orderNo || invoiceId,
      siparis: {
        orderNo: o.basketId || o.orderNo || '',
        tutar: o.amount,
        ad: o.customerName,
        email: o.customerEmail,
        telefon: o.customerPhone,
        sehir: o.customerCity,
        ilce: o.customerTown,
        adres: o.customerAddress,
        kargoBarkod: o.kargoBarcode || '',
        faturaNo: o.faturaNo || '',
      },
    });
  } catch (err) {
    console.error('[notify] exception:', err.message);
    return jsonResp({ error: err.message }, 500);
  }
}
