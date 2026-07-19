// POST /api/payment/webhook — HalkÖde server-to-server bildirimi.
// Hash doğrulanamazsa "ödendi" bildirimi sağlayıcıdan checkstatus ile teyit edilir.
import { validateHash, checkOrderStatus } from '../../lib/halkode.js';
import { fulfillPaidOrder, telegramGonder } from '../../lib/fulfill.js';

function ack(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const contentType = request.headers.get('content-type') || '';
    let data = {};
    if (contentType.includes('application/x-www-form-urlencoded')) {
      data = Object.fromEntries(await request.formData());
    } else if (contentType.includes('application/json')) {
      data = await request.json();
    } else {
      return new Response(JSON.stringify({ error: 'Invalid content type' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const { invoice_id, order_id, status, payment_status, status_description, hash_key } = data;
    console.log('[webhook] received:', JSON.stringify({ invoice_id, order_id, status, payment_status }));

    if (!invoice_id) return ack({ success: false, error: 'Missing invoice_id' });
    if (!env.HALKODE_APP_SECRET || !env.PAYMENT_KV) {
      console.error('[webhook] not configured');
      return ack({ success: false, error: 'Not configured' });
    }

    let hashValid = false;
    if (hash_key) {
      hashValid = !!(await validateHash(hash_key, status, order_id, invoice_id, env.HALKODE_APP_SECRET));
      if (!hashValid) {
        console.error('[webhook] HASH VALIDATION FAILED:', invoice_id);
        await telegramGonder(env, `⚠️ HASH VALIDATION FAILED (haciyatmazkablo)\ninvoice_id: ${invoice_id}\norder_id: ${order_id}\nstatus: ${status}`);
      }
    }

    const orderRaw = await env.PAYMENT_KV.get(`order:${invoice_id}`);
    if (!orderRaw) {
      console.warn('[webhook] order not found:', invoice_id);
      const isSuccess = (payment_status == 1 || status === 'Completed');
      await telegramGonder(env,
`${isSuccess ? '✅' : '❌'} HACIYATMAZ ÖDEME ${isSuccess ? 'BAŞARILI' : 'BAŞARISIZ'}
⚠️ KV'de sipariş bulunamadı (TTL dolmuş olabilir)
invoice_id: ${invoice_id}
order_id: ${order_id || '-'}
status: ${status || '-'} / payment_status: ${payment_status || '-'}`);
      return ack({ success: true, note: 'Order not found but acknowledged' });
    }

    let order;
    try { order = JSON.parse(orderRaw); }
    catch { return ack({ success: false, error: 'Invalid order data' }); }

    // Idempotency
    if (order.status === 'PAID' || order.status === 'FAILED' ||
        order.status === 'PROCESSED' || order.status === 'PROCESSED_WITH_WARNINGS') {
      return ack({ success: true, invoice_id, status: order.status, idempotent: true });
    }

    const isSuccess = (payment_status == 1 || status === 'Completed');

    // Sahte "ödendi" webhook koruması: hash geçersizse sağlayıcıdan teyit al.
    if (isSuccess && !hashValid) {
      const statusCheck = await checkOrderStatus(env, invoice_id);
      if (!statusCheck.ok) {
        console.error('[webhook] sağlayıcı teyidi başarısız:', invoice_id, statusCheck.error);
        await telegramGonder(env, `🚨 SAHTE WEBHOOK ŞÜPHESİ (haciyatmazkablo)\ninvoice_id: ${invoice_id}\nHash geçersiz + sağlayıcı teyidi başarısız: ${statusCheck.error || '-'}\nSipariş PAID yapılmadı.`);
        return ack({ success: false, error: 'Payment not confirmed by provider' });
      }
    }

    const updatedOrder = isSuccess
      ? { ...order, status: 'PAID', orderNo: order_id || order.orderNo || '', paidAt: new Date().toISOString() }
      : { ...order, status: 'FAILED', failedAt: new Date().toISOString(), failureReason: status_description || '' };

    await env.PAYMENT_KV.put(
      `order:${invoice_id}`,
      JSON.stringify(updatedOrder),
      { expirationTtl: isSuccess ? 86400 * 30 : 86400 * 7 }
    );

    if (isSuccess) {
      await fulfillPaidOrder(env, updatedOrder, invoice_id, 'webhook');
    }

    return ack({ success: true, invoice_id, order_no: order_id, status: isSuccess ? 'paid' : 'failed' });
  } catch (err) {
    console.error('[webhook] exception:', err.message);
    return ack({ success: false, error: err.message });
  }
}
