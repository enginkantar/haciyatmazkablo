// Ödeme başarı sonrası tek kapı: kargo + fatura + Telegram + KV güncelle.
// Hem webhook hem notify-success (tarayıcı dönüşü) buradan geçer — idempotent.
import { kargoGonderiOlustur } from './kargo.js';
import { qnbIrsaliyeliFaturaKes } from './fatura.js';

export async function telegramGonder(env, message) {
  const botToken = env.TELEGRAM_BOT_TOKEN || env.TELEGRAM_BOT;
  if (!botToken || !env.TELEGRAM_CHAT_ID) {
    return { ok: false, manual: true, error: 'Telegram yapılandırması eksik' };
  }

  let sonHata = '';
  for (let deneme = 1; deneme <= 2; deneme += 1) {
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: message }),
          signal: AbortSignal.timeout(8000),
        }
      );
      if (response.ok) return { ok: true };
      sonHata = `Telegram HTTP ${response.status}`;
    } catch (error) {
      sonHata = error?.name === 'TimeoutError' ? 'Telegram zaman aşımı' : (error?.message || 'Telegram bağlantı hatası');
    }
  }
  return { ok: false, error: sonHata || 'Telegram bildirimi gönderilemedi' };
}

export async function fulfillPaidOrder(env, order, invoiceId, source) {
  if (order.notifiedAt) {
    return { ok: true, idempotent: true, notifiedAt: order.notifiedAt, order };
  }
  if (order.status !== 'PAID') {
    return { ok: false, note: `order status is ${order.status}`, order };
  }

  order.quantity = order.quantity || 1;
  order.package = order.package || 'Hacıyatmaz Kablo Tip C 240W';
  order.orderNo = order.orderNo || order.basketId;
  order.invoiceId = invoiceId;

  if (!order.kargoBarcode) {
    const kargo = await kargoGonderiOlustur(env, order).catch(e => ({ ok: false, error: e.message }));
    if (kargo.ok) {
      order.kargoBarcode = kargo.barcode;
      order.kargoHandler = kargo.handler;
      order.kargoError = '';
    } else {
      order.kargoError = kargo.error || 'Kargo oluşturulamadı';
    }
  }

  if (!order.faturaNo) {
    const fatura = await qnbIrsaliyeliFaturaKes(env, order).catch(e => ({ ok: false, error: e.message }));
    if (fatura.ok) {
      order.faturaNo = fatura.faturaNo;
      order.faturaUuid = fatura.uuid;
      order.faturaMock = !!fatura.mock;
      order.faturaError = '';
    } else {
      order.faturaError = fatura.error || 'Fatura oluşturulamadı';
    }
  }

  const notifiedAt = new Date().toISOString();
  order.notifiedAt = notifiedAt;
  order.status = (order.kargoBarcode && order.faturaNo) ? 'PROCESSED' : 'PROCESSED_WITH_WARNINGS';
  order.processedAt = notifiedAt;

  // Kart verisi loglanmaz; ödeme, müşteri ve teslimat özeti.
  console.log(`[order.paid:${source}]`, JSON.stringify({
    basketId: order.basketId,
    invoiceId,
    orderNo: order.orderNo,
    amount: order.amount,
    currency: 'TRY',
    product: order.package,
    customerName: order.customerName,
    customerEmail: order.customerEmail,
    customerPhone: order.customerPhone,
    customerAddress: order.customerAddress,
    customerTown: order.customerTown,
    customerCity: order.customerCity,
    kargoBarcode: order.kargoBarcode || '',
    kargoError: order.kargoError || '',
    faturaNo: order.faturaNo || '',
    faturaError: order.faturaError || '',
  }));

  const msg =
`🛍️ YENİ SİPARİŞ! (HalkÖde)

📦 Ürün: ${order.package}
💰 Tutar: ${order.amount} TL
🔖 Sipariş No: ${order.basketId}
💳 HalkÖde No: ${order.orderNo || '-'}

👤 Ad: ${order.customerName}
📧 E-posta: ${order.customerEmail}
📱 Telefon: ${order.customerPhone}

📍 Adres:
${order.customerAddress}
${order.customerTown} / ${order.customerCity}

🚚 Kargo: ${order.kargoBarcode || `Bekliyor (${order.kargoError || '-'})`}
🧾 Fatura: ${order.faturaNo || `Bekliyor (${order.faturaError || '-'})`}`;

  const telegram = await telegramGonder(env, msg);
  order.telegramNotified = telegram.ok;
  order.telegramError = telegram.ok ? '' : telegram.error;
  if (!telegram.ok) console.error(`[fulfill:${source}] Telegram bildirim hatası:`, telegram.error);

  await env.PAYMENT_KV.put(
    `order:${invoiceId}`,
    JSON.stringify(order),
    { expirationTtl: 86400 * 30 }
  );

  return { ok: true, notifiedAt, order };
}
