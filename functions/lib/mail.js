// Sipariş e-postaları — Zoho Mail API (birincil) → Resend (yedek).
// hydrozidtr.com'daki doğrulanmış akışın portu. Zoho OAuth secrets Pages'te
// tanımlı (ZOHO_CLIENT_ID/SECRET/REDIRECT_URI/REFRESH_TOKEN); opsiyonel:
// ZOHO_FROM_EMAIL, ORDER_ALERT_EMAILS, RESEND_API_KEY, RESEND_FROM_EMAIL.

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function getOrderAlertEmails(env) {
  const raw = env.ORDER_ALERT_EMAILS || '';
  const parsed = raw.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
  if (parsed.length) return parsed;
  return ['haciyatmazkablo@gmail.com', 'enginkantar@gmail.com'];
}

export function mailConfigured(env) {
  return !!(env.RESEND_API_KEY || (env.ZOHO_REFRESH_TOKEN && env.ZOHO_CLIENT_ID && env.ZOHO_CLIENT_SECRET));
}

// ─── Zoho Mail API ───────────────────────────────────────────────────────────
async function getZohoAccessToken(env) {
  const cacheKey = 'zoho:access_token';
  if (env.PAYMENT_KV) {
    const cached = await env.PAYMENT_KV.get(cacheKey, { type: 'json' });
    if (cached?.access_token && cached?.expires_at && cached.expires_at > Date.now() + 60000) {
      return cached.access_token;
    }
  }

  const tokenUrl = new URL('https://accounts.zoho.com/oauth/v2/token');
  tokenUrl.searchParams.set('grant_type', 'refresh_token');
  tokenUrl.searchParams.set('refresh_token', env.ZOHO_REFRESH_TOKEN);
  tokenUrl.searchParams.set('client_id', env.ZOHO_CLIENT_ID);
  tokenUrl.searchParams.set('client_secret', env.ZOHO_CLIENT_SECRET);
  if (env.ZOHO_REDIRECT_URI) tokenUrl.searchParams.set('redirect_uri', env.ZOHO_REDIRECT_URI);

  const res = await fetch(tokenUrl, { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  const accessToken = data?.access_token || '';
  const expiresIn = Number(data?.expires_in || 3600);
  if (!accessToken) {
    console.error('[zoho] token error:', res.status, JSON.stringify(data).slice(0, 240));
    return '';
  }

  if (env.PAYMENT_KV) {
    await env.PAYMENT_KV.put(cacheKey, JSON.stringify({
      access_token: accessToken,
      expires_at: Date.now() + Math.max(300, expiresIn - 60) * 1000,
    }), { expirationTtl: Math.max(300, expiresIn - 60) });
  }
  return accessToken;
}

async function getZohoAccount(env, accessToken) {
  const cacheKey = 'zoho:account';
  if (env.PAYMENT_KV) {
    const cached = await env.PAYMENT_KV.get(cacheKey, { type: 'json' });
    if (cached?.accountId && cached?.email && cached?.emailAddress) return cached;
  }

  const res = await fetch('https://mail.zoho.com/api/accounts', {
    headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}`, 'Accept': 'application/json' },
  });
  const data = await res.json().catch(() => ({}));
  const list = Array.isArray(data?.data) ? data.data : [];
  const wanted = (env.ZOHO_FROM_EMAIL || '').trim().toLowerCase();
  const picked = (wanted && list.find(a => {
    const emails = [
      a.primaryEmailAddress, a.mailboxAddress, a.incomingUserName,
      ...(Array.isArray(a.emailAddress) ? a.emailAddress.map(e => e.mailId) : []),
    ].filter(Boolean).map(x => String(x).toLowerCase());
    return emails.includes(wanted);
  })) || list[0];
  const account = picked ? {
    accountId: picked.accountId || picked.id || picked.account_id || '',
    email: picked.primaryEmailAddress
      || picked.mailboxAddress
      || picked.incomingUserName
      || (Array.isArray(picked.emailAddress) ? picked.emailAddress.find(e => e.isPrimary)?.mailId : '')
      || (Array.isArray(picked.emailAddress) ? picked.emailAddress[0]?.mailId : '')
      || '',
    mailboxAddress: picked.mailboxAddress || '',
    emailAddress: Array.isArray(picked.emailAddress) ? picked.emailAddress : [],
  } : null;

  if (account?.accountId && account?.email && env.PAYMENT_KV) {
    await env.PAYMENT_KV.put(cacheKey, JSON.stringify(account), { expirationTtl: 86400 });
  }
  return account;
}

function chooseZohoSender(env, account) {
  const preferred = (env.ZOHO_FROM_EMAIL || '').trim().toLowerCase();
  const addresses = new Set([
    account?.email, account?.primaryEmailAddress, account?.mailboxAddress, account?.incomingUserName,
    ...(Array.isArray(account?.emailAddress) ? account.emailAddress.map(e => e.mailId) : []),
  ].filter(Boolean).map(x => String(x).toLowerCase()));

  if (preferred && addresses.has(preferred)) return preferred;
  if (account?.primaryEmailAddress) return account.primaryEmailAddress;
  if (account?.mailboxAddress) return account.mailboxAddress;
  if (account?.incomingUserName) return account.incomingUserName;
  return account?.email || '';
}

async function sendZohoEmail(env, { to, subject, html }) {
  try {
    const accessToken = await getZohoAccessToken(env);
    if (!accessToken) return { ok: false, error: 'access token alınamadı' };

    const account = await getZohoAccount(env, accessToken);
    if (!account?.accountId || !account?.email) return { ok: false, error: 'Zoho account bulunamadı' };

    const res = await fetch(`https://mail.zoho.com/api/accounts/${account.accountId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Zoho-oauthtoken ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        fromAddress: chooseZohoSender(env, account),
        toAddress: to,
        subject,
        content: html,
        mailFormat: 'html',
        askReceipt: 'no',
        encoding: 'UTF-8',
      }),
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 240)}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ─── Zoho → Resend fallback ──────────────────────────────────────────────────
export async function sendEmail(env, { to, subject, html, replyTo }) {
  if (env.ZOHO_REFRESH_TOKEN && env.ZOHO_CLIENT_ID && env.ZOHO_CLIENT_SECRET) {
    const zoho = await sendZohoEmail(env, { to, subject, html });
    if (zoho.ok) return true;
    console.warn('[zoho] fallback to resend:', zoho.error || 'unknown error');
  }

  if (!env.RESEND_API_KEY) return false;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.RESEND_FROM_EMAIL || 'Hacıyatmaz Kablo <siparis@haciyatmazkablo.com>',
        to: [to],
        subject,
        html,
        reply_to: replyTo || 'haciyatmazkablo@gmail.com',
      }),
    });
    if (!res.ok) {
      console.error('[resend] failed:', res.status, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error('[resend] exception:', e.message);
    return false;
  }
}

// ─── Sipariş e-postaları (operatör + müşteri) ────────────────────────────────
export async function sendOrderEmails(env, order, invoiceId) {
  if (!mailConfigured(env)) {
    return { ok: false, error: 'mail yapılandırması eksik' };
  }

  const eName = escapeHtml(order.customerName);
  const eEmail = escapeHtml(order.customerEmail);
  const ePhone = escapeHtml(order.customerPhone);
  const eCity = escapeHtml(order.customerCity);
  const eTown = escapeHtml(order.customerTown);
  const eAddress = escapeHtml(order.customerAddress);
  const orderNo = escapeHtml(order.basketId || order.orderNo || invoiceId);
  const trDate = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });

  const adminHtml = `
<h2>Yeni Sipariş — Hacıyatmaz Kablo</h2>
<table style="font-family:sans-serif;font-size:14px;border-collapse:collapse">
  <tr><td style="padding:6px 12px;color:#666">Müşteri</td><td style="padding:6px 12px"><strong>${eName}</strong></td></tr>
  <tr><td style="padding:6px 12px;color:#666">E-posta</td><td style="padding:6px 12px">${eEmail}</td></tr>
  <tr><td style="padding:6px 12px;color:#666">Telefon</td><td style="padding:6px 12px">${ePhone}</td></tr>
  <tr><td style="padding:6px 12px;color:#666">Şehir / İlçe</td><td style="padding:6px 12px">${eCity} / ${eTown}</td></tr>
  <tr><td style="padding:6px 12px;color:#666">Adres</td><td style="padding:6px 12px">${eAddress}</td></tr>
  <tr><td style="padding:6px 12px;color:#666">Ürün</td><td style="padding:6px 12px">Hacıyatmaz Kablo Tip C 240W (${Number(order.quantity) || 1} adet)</td></tr>
  <tr><td style="padding:6px 12px;color:#666">Tutar</td><td style="padding:6px 12px"><strong>${escapeHtml(order.amount)} TL</strong></td></tr>
  <tr><td style="padding:6px 12px;color:#666">Sipariş No</td><td style="padding:6px 12px"><strong>${orderNo}</strong></td></tr>
  <tr><td style="padding:6px 12px;color:#666">HalkÖde No</td><td style="padding:6px 12px">${escapeHtml(order.orderNo || '-')}</td></tr>
  <tr><td style="padding:6px 12px;color:#666">Kargo</td><td style="padding:6px 12px"><strong>${escapeHtml(order.kargoBarcode || ('— ' + (order.kargoError || '')))}</strong> ${escapeHtml(order.kargoHandler || '')}</td></tr>
  <tr><td style="padding:6px 12px;color:#666">Fatura No</td><td style="padding:6px 12px"><strong>${escapeHtml(order.faturaNo || '—')}</strong>${order.faturaError ? ' — ' + escapeHtml(order.faturaError) : ''}</td></tr>
  <tr><td style="padding:6px 12px;color:#666">Tarih</td><td style="padding:6px 12px">${trDate}</td></tr>
</table>`;

  const customerHtml = `
<div style="font-family:sans-serif;background:#0a0a0a;color:#cbd5e1;padding:40px 24px;max-width:560px;margin:0 auto;border-radius:16px">
  <h1 style="color:#ffc107;font-size:1.4rem;margin-bottom:8px">Siparişiniz Alındı!</h1>
  <p style="color:#94a3b8;margin-bottom:24px">Sayın <strong style="color:#fff">${eName}</strong>, ödemeniz başarıyla tamamlandı.</p>
  <table style="font-size:14px;border-collapse:collapse;width:100%">
    <tr><td style="padding:8px 0;color:#64748b;width:140px">Sipariş No</td><td style="padding:8px 0;color:#fff;font-weight:700">${orderNo}</td></tr>
    <tr><td style="padding:8px 0;color:#64748b">Ürün</td><td style="padding:8px 0;color:#fff">Hacıyatmaz Kablo Tip C 240W — ${Number(order.quantity) || 1} adet</td></tr>
    <tr><td style="padding:8px 0;color:#64748b">Tutar</td><td style="padding:8px 0;color:#25d366;font-weight:700">${escapeHtml(order.amount)} TL</td></tr>
    <tr><td style="padding:8px 0;color:#64748b">Teslimat Adresi</td><td style="padding:8px 0;color:#cbd5e1">${eCity} / ${eTown} — ${eAddress}</td></tr>
    ${order.kargoBarcode ? `<tr><td style="padding:8px 0;color:#64748b">Kargo Takip</td><td style="padding:8px 0;color:#cbd5e1;font-family:monospace">${escapeHtml(order.kargoBarcode)} ${escapeHtml(order.kargoHandler || '')}</td></tr>` : ''}
  </table>
  <p style="margin-top:24px;color:#94a3b8;font-size:0.9rem">Siparişiniz en kısa sürede kargoya verilecek; kargo takip bilgileri ayrıca iletilecektir.</p>
  <p style="margin-top:8px;color:#94a3b8;font-size:0.9rem">Sorularınız için: <a href="mailto:haciyatmazkablo@gmail.com" style="color:#ffc107">haciyatmazkablo@gmail.com</a> veya WhatsApp <a href="https://wa.me/905534759032" style="color:#ffc107">+90 553 475 9032</a></p>
  <div style="text-align:center;padding:16px 0 8px;font-size:12px;color:#6b7280;line-height:1.8;border-top:1px solid #2a2a2a;margin-top:24px">
    <p style="margin:0;font-weight:700;color:#e5e7eb;font-size:14px">Hacıyatmaz Kablo</p>
    <p style="margin:4px 0">Batu Teknoloji · E-Commerce M Power Series</p>
    <p style="margin:4px 0"><a href="https://www.haciyatmazkablo.com" style="color:#94a3b8;text-decoration:none">www.haciyatmazkablo.com</a></p>
  </div>
</div>`;

  const jobs = getOrderAlertEmails(env).map(to => sendEmail(env, {
    to,
    subject: `[Hacıyatmaz Kablo] Yeni Sipariş — ${eName} / ${orderNo}`,
    html: adminHtml,
  }));

  if (order.customerEmail) {
    jobs.push(sendEmail(env, {
      to: order.customerEmail,
      subject: 'Hacıyatmaz Kablo — Siparişiniz Alındı',
      html: customerHtml,
    }));
  }

  const results = await Promise.allSettled(jobs);
  const failures = results.filter(r => r.status === 'rejected' || r.value === false).length;
  if (failures) console.warn('[mail] gönderim hatası sayısı:', failures);
  return { ok: failures === 0, failures };
}
