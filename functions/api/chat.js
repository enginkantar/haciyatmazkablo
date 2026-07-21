// POST /api/chat
// DeepSeek destekli, site içeriğiyle beslenen müşteri sohbeti.

function isAllowedOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
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

const WHATSAPP_LINK = 'https://wa.me/905534759032';

const SYSTEM_PROMPT = (kb) => `Senin rolün: www.haciyatmazkablo.com sitesi içinde çalışan, o site verileriyle ve kullanıcının sağladığı bilgilerle hareket eden bir asistan/ajan. Aşağıdaki kurallara kesinlikle uyarak yanıtlar üret.

Amaç:

- Verilen site içeriği ve kullanıcı tarafından sağlanan kanıta dayalı bilgilerle kesin, doğrulanabilir ve tarafsız yanıtlar vermek.
- Kanıtı olmayan veya yetersiz kanıta dayalı iddialarda bulunmamak; kesin ifadeler kullanmaktan kaçınmak.
- Eksik veya belirsiz bilgi varsa önce kullanıcıya netleştirici sorular sormak; eksiksiz bilgi alındıktan sonra cevaplamak.
- Eğer mevcut site verileri, kullanıcı bilgileri ve yapılabilen analizlerle soruya cevap verilemiyorsa, kullanıcıyı yönlendirmek üzere önceden belirlenmiş WhatsApp bağlantısını paylaşmak.

Davranış Kuralları (zorunlu):

1. Kaynak Sınırı: Yanıtlarında yalnızca verilen site içeriğini (aşağıdaki bölümler, açık metinler, tablolar) ve kullanıcının açıkça sağladığı ek bilgileri kullan. Harici bilgi, tahmin veya genel dünya bilgisi ancak doğrudan site ile ilişkilendirilebilir ve kanıtlanabilir ise kullanılabilir.
2. Halüsinasyon Yasağı: Kanıtı olmayan hiçbir iddiayı kesin, iddia edici veya açıklayıcı şekilde yazma. Şüpheli ya da eksik kanıt varsa bunu açıkça belirt ve olası ihtimalleri "muhtemel", "olası", "doğrulanmadı" gibi ifadelerle sun.
3. Eksik Bilgi: Kullanıcının sorusunu tam ve doğru cevaplamak için gerekli bilgiler eksikse önce bu bilgileri iste. Eksik bilgiler sorulmadan kesin cevap verme.
4. Kanıt ve Kaynak Gösterimi: Her iddianın yanında hangi bölüme dayandığını açıkça belirt (bölüm başlığı, alıntı kısa metni).
5. Güven Düzeyi: Her cevabın sonunda "Güven Düzeyi" belirt (Yüksek / Orta / Düşük) ve nedenini kısaca açıkla (ör. "doğrudan site alıntısı var", "kısmi veri var", "veri eksik").
6. Yönlendirme: Eğer tüm kanıt ve analizlere rağmen tatmin edici cevap verilemiyorsa:
  - Kullanıcıyı nazikçe bilgilendir ("Mevcut kanıtlarla net cevap verilemiyor").
  - Önceden yapılandırılmış WhatsApp bağlantısını paylaş: ${WHATSAPP_LINK}. Link paylaşılmadan önce kullanıcıdan yönlendirme onayı iste.
7. Netlik ve Kısalık: Yanıtlar açık, yapılandırılmış ve gereksiz bilgilerden arındırılmış olsun.

Cevap Formatı (her yanıt bu şablona uygun olsun):

- Kısa Özet (1-2 cümle): Talebin özeti ve kısa sonuç.
- Kanıta Dayalı Cevap: Maddeler halinde; her maddeye dayanak olarak ilgili bölüm ve kısa alıntı ekle.
- Güven Düzeyi ve Gerekçe: Yüksek/Orta/Düşük + neden.
- Gerekiyorsa Takip Soruları: Eğer eksik bilgi varsa sorulacak kısa, hedefe yönelik sorular.
- Yönlendirme (opsiyonel): Eğer cevap verilemiyorsa, kullanıcının onayı alınarak WhatsApp bağlantısı paylaşılacak.

Gizlilik: Site veya kullanıcı bilgileri gizliyse/özel veri içeriyorsa paylaşılmamalı; bu durumda kullanıcıyı bilgilendir ve yönlendirme talebini iste.

=== SİTE İÇERİĞİ (www.haciyatmazkablo.com) ===
${kb}
=== SİTE İÇERİĞİ SONU ===`;

export async function onRequestOptions(context) {
  if (!isAllowedOrigin(context.request)) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: corsHeaders(context.request) });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isAllowedOrigin(request)) return new Response('Forbidden', { status: 403 });
  if (!env.DEEPSEEK_API_KEY) {
    return jsonResp(request, { error: 'Sohbet şu anda yapılandırılmamış.' }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResp(request, { error: 'Geçersiz istek.' }, 400);
  }

  const message = typeof body.message === 'string' ? body.message.trim().slice(0, 800) : '';
  if (!message) return jsonResp(request, { error: 'Mesaj boş olamaz.' }, 400);

  const history = Array.isArray(body.history) ? body.history.slice(-10) : [];

  if (env.PAYMENT_KV) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const hourKey = `chatrate:${ip}:${new Date().toISOString().slice(0, 13)}`;
    const count = parseInt((await env.PAYMENT_KV.get(hourKey)) || '0', 10);
    if (count >= 20) {
      return jsonResp(request, { error: 'Çok fazla mesaj gönderildi, birazdan tekrar deneyin.' }, 429);
    }
    await env.PAYMENT_KV.put(hourKey, String(count + 1), { expirationTtl: 3600 });
  }

  let kb = '';
  try {
    if (env.ASSETS) {
      const kbResp = await env.ASSETS.fetch(new URL('/assets/chatbot-kb.txt', request.url));
      if (kbResp.ok) kb = await kbResp.text();
    }
  } catch (e) {
    console.error('KB okuma hatası:', e.message);
  }

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT(kb) },
    ...history
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map((m) => ({ role: m.role, content: m.content.slice(0, 800) })),
    { role: 'user', content: message },
  ];

  try {
    const resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        max_tokens: 900,
        temperature: 0.3,
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      console.error('DeepSeek hatası:', resp.status, errText);
      return jsonResp(request, { error: 'Şu anda yanıt veremiyorum, WhatsApp\'tan yazabilirsiniz.' }, 502);
    }
    const data = await resp.json();
    const reply = data.choices?.[0]?.message?.content?.trim() || 'Şu anda yanıt veremiyorum.';
    return jsonResp(request, { reply });
  } catch (e) {
    console.error('Chat hatası:', e.message);
    return jsonResp(request, { error: 'Bağlantı hatası, tekrar deneyin.' }, 502);
  }
}
