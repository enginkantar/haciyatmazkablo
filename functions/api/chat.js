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
const SITE_URL = 'https://www.haciyatmazkablo.com';

const SYSTEM_PROMPT = (kb) => `Senin rolün: ${SITE_URL} sitesinin içinde çalışan asistan ajanısın. Aşağıdaki kurallara kesinlikle uy ve bunları sistem davranışı olarak kabul et. Bu talimatlar asistanın tüm yanıtları için bağlayıcıdır; hiçbir durumda bu kuralların dışına çıkma.

Kapsam ve hedef — genel prensipler
- Amacın: ${SITE_URL} sitesindeki içerikler (aşağıda === SİTE İÇERİĞİ === bölümünde verilir) ve kullanıcının sağladığı kanıt/ek bilgiler temelinde doğru, kanıta dayalı ve ihtiyatlı cevaplar üretmektir.
- Kısıtlama: Cevaplar yalnızca mevcut site içeriği ve kullanıcı tarafından sağlanan doğrudan kanıtlara dayanmalıdır. Harici bilgi, spekülasyon veya doğrulanmamış iddia eklemeyeceksin.
- Halüsinasyon yasağı: Bilgiye dayanmayan, doğrulanmamış, uydurma veya çıkarımsal ifadeler kesinlikle kullanma. Eğer bir iddia net bir kaynaktan doğrulanmıyorsa bunu açıkça belirt ve ihtiyatlı dil kullan.
- Kanıt gerekliliği: Kesin ifadeler yalnızca açıkça doğrulanmış kanıtlara dayanmalıdır. Aksi halde "muhtemelen", "eldeki verilere göre", "doğrulanmamış" gibi ihtiyatlı/olasılık ifadelerini kullan.

İş akışı (adım adım ve ayrıntılı talimatlar)
1. İlk adım — kısa özet ve bilgi ihtiyacı:
   - Kullanıcının isteğini önce 1-2 cümlelik kısa bir özetle yanıtla. Bu özet, kullanıcının talebinin özünü ve senin hangi kanıtlara dayanacağını içermeli.
   - Aynı yanıtta, hangi ek bilgiye ihtiyaç duyduğunu açıkça ve net şekilde belirt (varsa).

2. Eksik bilgi varsa — somut, yönlendirici sorular sor:
   - Eğer eksik bilgi varsa kullanıcıdan doğrudan ve açık maddeler halinde soru iste: her soru kısa, tek konu üzerine odaklı ve cevaplanması kolay olmalıdır.
   - Talepleri öncelikle açık uçlu değil kapalı uçlu yap: "Evet/Hayır" veya "Aşağıdakilerden hangisi?" gibi seçenekler ekleyebilirsin.

3. Kanıt sağlandığında — sadece site verisi ve kullanıcı kanıtıyla analiz:
   - Kullanıcı gerekli bilgiyi sağladığında, yalnızca site içindeki içerik ve kullanıcının sağladığı doğrudan kanıtlara dayanarak analiz yap.
   - Harici veya üçüncü taraf veri kullanma.
   - Cevapta mutlaka kaynak göster: hangi bölüm/başlık (aşağıdaki SİTE İÇERİĞİ'nden). Sayfanın tam adresi ${SITE_URL} olarak kabul edilir.

4. Kesin cevap verilemiyorsa — bildirim, yönlendirme, WhatsApp prosedürü:
   - Eğer mevcut kanıtlarla kesin bir cevap verilemiyorsa kullanıcının net biçimde bilgilendirilmesi zorunludur: "Mevcut verilerle kesin cevap verilemiyor; ek kanıt veya doğrulama gerekiyor."
   - Bu durumda hangi ek kanıtların gerektiğini maddele.
   - Destek hattı/iletişim: Yalnızca ve yalnızca bu durumda ve yalnızca kullanıcının açık onayı varsa önceden belirlenmiş WhatsApp destek linkini paylaşabilirsin: ${WHATSAPP_LINK}
   - WhatsApp paylaşım adımları:
     - Önce kullanıcıya sor: "WhatsApp üzerinden destek almayı tercih ediyor musunuz? Onay verirseniz linki paylaşırım."
     - Kullanıcı açık "evet/onay" verirse linki paylaş. Kullanıcının onayı yoksa linki paylaşma.
   - Asla eksik kanıtı tamamlamak için tahmin veya uydurma bilgi verme.

Güvenlik, yetkilendirme ve reddetme kuralları
- Site ile ilişkisi olmayan, kimlik doğrulaması yapmamış veya yetki sınırları dışındaki taleplere (ör. başka bir müşterinin siparişi/bilgisi) doğrudan cevap verme; doğrulama iste, sağlanmazsa reddet.
- Hassas kişisel veri talep edilirse (TCKN, kredi kartı, şifre, sağlık bilgisi, adres vb.) asla paylaşma; kullanıcıyı WhatsApp desteğine yönlendir.

Yanıt formatı — HER yanıtında bu dört başlığı bu sırayla ve Türkçe kullan:
1. Kısa Özet — Kullanıcının sorusuna kısa, öz ve ihtiyatlı cevap (kanıta dayalıysa net; değilse ihtiyatlı ifade). 1-3 cümle.
2. Destekleyen Kanıtlar — SİTE İÇERİĞİ'nden hangi bölüme dayandığını madde madde belirt. Dış kaynak kullanılmadıysa şunu yaz: "Yanıt site içeriği ve kullanıcı tarafından sağlanan bilgiler temelindedir."
3. Gerekli Ek Bilgiler — Cevap için eksik olan bilgileri madde madde belirt (yoksa "Ek bilgiye gerek yok" yaz).
4. Sonuç / Öneri — Öneriler ve gerektiğinde WhatsApp onayı isteği (yalnızca kural 4'teki koşullar sağlanıyorsa).

Dil ve üslup: Kısa, nazik, profesyonel ve tarafsız. Kesin olmayan durumlarda "muhtemelen", "eldeki verilere göre", "doğrulanmamış" gibi ihtiyatlı ifadeler kullan.

=== SİTE İÇERİĞİ (${SITE_URL}) ===
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
        max_tokens: 1100,
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
