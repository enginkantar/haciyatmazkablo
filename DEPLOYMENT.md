# Hacıyatmaz Kablo — Canlıya Alma Kontrolü

## 1. Zorunlu Cloudflare yapılandırması

`wrangler.toml` içindeki `PAYMENT_KV` binding'i ödeme oturumları ve idempotency için kullanılır.
Cloudflare Pages proje ayarlarında aşağıdaki değerler şifreli değişken olarak tanımlanmalıdır:

- `HALKODE_APP_ID` (HalkÖde "Uygulama Anahtarı")
- `HALKODE_APP_SECRET` (HalkÖde "Uygulama Parolası")
- `HALKODE_MERCHANT_KEY` (HalkÖde "Üyeişyeri Anahtarı", `$2y$10$...` ile başlar)
- `TURNSTILE_SECRET` (Cloudflare Turnstile server-side secret, when bot verification is enabled)
- Opsiyonel: `WEBHOOK_SECRET` (HalkÖde webhook anahtarı), `BASE_URL` (varsayılan https://www.haciyatmazkablo.com), `GOOGLE_MAPS_API_KEY` (adres autocomplete'i Google Places'a geçirir; yoksa OSM kullanılır)

Ödeme akışı: sipariş formu → `/api/payment/start` → `/odeme` white-label kart sayfası →
HalkÖde `paySmart3D` (3D Secure) → dönüş `/odeme-basarili` (`notify-success` + sunucu-sunucu
`checkstatus` teyidi) ve `/api/payment/webhook`. Kart verisi sitemizin sunucusuna uğramaz.

## 2. Sipariş sonrası entegrasyonlar

Telegram:

- `TELEGRAM_BOT_TOKEN` (mevcut Pages secret `TELEGRAM_BOT` adıyla da kabul edilir)
- `TELEGRAM_CHAT_ID`

Kargo (aktif: Kargonomi + HepsiJET pinli):

- `KARGO_SAGLAYICI=kargonomi`
- `KARGONOMI_TOKEN`
- `KARGONOMI_SAGLAYICI=hepsijet` (pin; o bölgede yoksa en ucuz sağlayıcı seçilir)
- `KARGO_GONDERICI_VKN`, `KARGO_GONDERICI_TEL`, `KARGO_GONDERICI_ADRES`,
  `KARGO_GONDERICI_STATE_ID`, `KARGO_GONDERICI_CITY_ID` (Çorum=19, Merkez=639),
  opsiyonel `KARGO_GONDERICI_UNVAN`
- Alternatif: `KARGO_SAGLAYICI=basitkargo` + `BASITKARGO_TOKEN` + `BASITKARGO_HANDLER`

QNB e-Arşiv:

- `QNB_WS_KULLANICI`
- `QNB_WS_SIFRE`
- `QNB_EFATURA_USER_WS`
- `QNB_EFATURA_CONNECTOR_WS`
- `QNB_GONDERICI_VKN`
- `QNB_ERP_KODU`
- `QNB_FATURA_SERI=HKT`

Testte `QNB_MOCK=1` kullanılabilir. Canlı ortamda bu değişken kaldırılmalı veya `0` yapılmalıdır.

## 3. Test kapıları

```sh
npm test
npm run test:syntax
git diff --check
```

Regresyon testi şunları doğrular:

- fiyatın yalnız sunucudan alınması;
- `+90` telefonun `05XXXXXXXXX` biçimine dönüştürülmesi;
- kısa adres ve yabancı Origin reddi;
- whitelabel-init'in sağlayıcı formatında hash üretmesi;
- hash'siz "ödendi" webhook'unun checkstatus teyidiyle işlenmesi;
- teyitsiz (sahte) webhook'un siparişi PAID yapmaması;
- işlenmiş webhook'un entegrasyonları ikinci kez çağırmaması (idempotency);
- eksik kargo/fatura yapılandırmasının `PROCESSED_WITH_WARNINGS` olarak kaydedilmesi.

## 4. Canlı duman testi

1. Düşük riskli gerçek bir sipariş oluşturun.
2. `/odeme` kart sayfasından 3D Secure ekranının açıldığını doğrulayın.
3. HalkÖde panelinde ödeme ve sipariş numarasını eşleştirin.
4. Cloudflare loglarında `order.paid` kaydını kontrol edin.
5. Telegram mesajı, Basit Kargo barkodu ve QNB fatura numarasının aynı sipariş numarasını taşıdığını doğrulayın.
6. Başarılı sayfayı yenileyin; ikinci kargo/fatura oluşmamalıdır.

Callback dış servis çağrılarını süreyle sınırlar. Kargo veya fatura oluşturulamazsa ödeme yine başarılı
kalır; sipariş KV'de `PROCESSED_WITH_WARNINGS` olarak, hata ayrıntılarıyla tutulur ve Telegram mesajında
"Bekliyor" olarak görünür. Bu durum siparişin ücretinin alındığını fakat operasyonel işlem gerektiğini belirtir.

Müşteri/admin e-postası, müşteri kişisel verilerinin harici e-posta sağlayıcısına aktarımı için açık onay alındıktan sonra etkinleştirilecektir.
