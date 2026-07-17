# Düşük Sürtünmeli Tasarım Yenileme Planı

## Hedef

Referans olarak verilecek site adresinin görsel dilini ve sayfa ritmini Hacıyatmaz Kablo'ya uyarlamak; mevcut organik URL'leri, içerikleri, ödeme güvenliğini ve Shopify geçiş sınırını bozmamak.

## Referans URL Geldiğinde

1. Referans URL'yi masaüstü ve mobilde incele.
2. Hero, navigasyon, ürün sunumu, güven blokları, sosyal kanıt, CTA, SSS ve footer bölümlerini bir ekran/section envanterine çıkar.
3. Renk, font, grid, spacing, border-radius, gölge, animasyon ve responsive kırılma noktalarını ayrı bir tasarım token tablosuna yaz.
4. Hacıyatmaz'ın mevcut görselleri, gerçek teknik iddiaları, fiyat kaynağı ve yasal metinleriyle eşleştir; referans siteden içerik veya asset kopyalama.
5. Önce yalnızca `/index.html` ve ona bağlı CSS üzerinde yeni tasarımı uygula. `/blog/`, `/rehber/`, `/kablo/`, `/cihazlar/` ve `/kullanim/` URL'lerine dokunma.
6. Shopify ürün URL'si kesinleşmediyse CTA hedeflerini tek bir config noktasıyla değiştirilebilir bırak; URL'yi tahmin ederek yayına alma.
7. Her kırılabilecek eski URL için redirect/canonical/sitemap kontrolünü çalıştır.

## Uygulama Sırası

### Faz 0 — Koruma

- Mevcut sitemap URL envanterini dondur.
- Shopify ürün URL'si ve fiyat kaynağını netleştir.
- Mevcut `npm test`, `npm run test:syntax`, `npm run seo:check` sonuçlarını baseline olarak kaydet.

### Faz 1 — Görsel kabuk

- `index.html` hero, nav, CTA, trust ve footer'ı referans görsel dile taşı.
- Ürün sayfasına giden CTA'yı tek hedefte birleştir.
- İçerik metnini ve JSON-LD anlamını değiştirmeden sadece yerleşim/typography/interaction değiştir.

### Faz 2 — Dönüşüm ve Shopify

- Shopify ürün URL'sini CTA, `Product` schema, feed ve paylaşım metadata'sına aynı anda uygula.
- Mobil sticky CTA, ödeme/güven sinyalleri ve gerçek fiyatı test et.
- Kendi ödeme modalı kaldırılacaksa önce başarı/hata/ölçüm akışını Shopify ile eşleştir; iki checkout'u aynı anda ana CTA yapma.

### Faz 3 — QA ve yayın

- 390, 768, 1024 ve 1440 px ekranlarda screenshot karşılaştırması.
- `npm run seo:check`, `npm run seo:sitemap:check`, `npm test`, `npm run test:syntax`.
- Lighthouse/Core Web Vitals, schema, canonical, robots, sitemap, CTA ve Shopify checkout smoke test.
- Önce staging/preview, sonra tek production deploy.

## Başarı Kriterleri

- Eski indexlenebilir içerik URL'lerinde 404 veya canonical kayması yok.
- Ana ürün CTA'sı tek ve doğru Shopify URL'sine gidiyor.
- Fiyat, feed, schema ve Shopify sayfası aynı değeri gösteriyor.
- Mobilde ilk ekranda ürün, vaat, güven ve CTA görünür.
- Tasarım değişikliği SEO içerik katmanından bağımsız geri alınabilir.
