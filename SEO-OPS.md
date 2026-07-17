# Hacıyatmaz Kablo SEO/GEO Operasyonları

## Komutlar

```sh
npm run seo:sitemap       # Canonical HTML sayfalarından sitemap üretir
npm run seo:sitemap:check # Commit edilmiş sitemap güncel mi kontrol eder
npm run seo:check         # robots, key, canonical, sitemap ve iç link kontrolü
npm run indexnow:dry      # Gönderilecek URL listesini ağ çağrısı yapmadan gösterir
npm run indexnow          # Sitemap URL'lerini IndexNow'a gönderir
```

`indexnow-key.txt` bilerek public'tir. IndexNow doğrulaması bu dosyanın canlı sitede erişilebilir olmasını gerektirir; gizli anahtar değildir.

GitHub Actions, `master` dalına HTML/asset/SEO değişikliği geldiğinde `seo:check`, sitemap güncellik kontrolü ve IndexNow gönderimini otomatik çalıştırır. Site deploy'u tamamlanmadan istek gönderilse bile IndexNow URL'leri daha sonra tarayabilir; canlı key dosyası ve sitemap aynı deploy'da bulunmalıdır.

## Shopify Ürün Sayfası Sınırı

Shopify ürün URL'si kesinleşene kadar mevcut ana sayfa ürünün geçici ticari kanonik noktasıdır. Shopify URL'si hazır olduğunda tek seferlik geçiş sırası:

1. Kesin public URL ve custom domain kararını kaydet.
2. Ürün adı, fiyat, görseller, stok, iade ve kargo bilgisinin ticari kaynağını Shopify yap.
3. `Product`/`Offer` schema ve `google-feed.xml` ürün linkini aynı URL ve fiyatla güncelle.
4. Ana sayfa ve tüm içerik CTA'larını Shopify ürün URL'sine yönlendir.
5. Eski ana sayfa ürün akışını ya Shopify'a 301 ile taşı ya da ana sayfayı yalnızca marka/rehber giriş noktası bırak; iki farklı ürün sayfasını aynı sorguya yarıştırma.
6. Shopify'ın kendi sitemap'inde ürün URL'sinin oluştuğunu kontrol et. Farklı host üzerindeki Shopify URL'sini bu sitenin sitemap'ine ekleme.
7. Geçişten sonra eski ve yeni URL'leri IndexNow + Google Search Console üzerinden gönder.

Shopify URL'si aynı custom domain altında bir path olacaksa (`/products/...`), Cloudflare Pages ve Shopify routing kararı deploy'dan önce netleştirilmelidir. `*.myshopify.com` üzerinde kalacaksa ürün URL'si ayrı host olarak yönetilir.
