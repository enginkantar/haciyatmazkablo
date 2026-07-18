# Hacıyatmaz Kablo — Canlıya Alma Kontrolü

## 1. Zorunlu Cloudflare yapılandırması

`wrangler.toml` içindeki `PAYMENT_KV` binding'i ödeme oturumları ve idempotency için kullanılır.
Cloudflare Pages proje ayarlarında aşağıdaki değerler şifreli değişken olarak tanımlanmalıdır:

- `IYZICO_API_KEY`
- `IYZICO_SECRET_KEY`
- `IYZICO_BASE_URL=https://api.iyzipay.com`
- `IYZICO_CALLBACK_URL=https://www.haciyatmazkablo.com/api/payment/callback`
- `TURNSTILE_SECRET` (Cloudflare Turnstile server-side secret, when bot verification is enabled)

Canlıya geçmeden önce sandbox adresinin üretim adresiyle değiştiğini özellikle doğrulayın.

## 2. Sipariş sonrası entegrasyonlar

Telegram:

- `TELEGRAM_BOT_TOKEN` (mevcut Pages secret `TELEGRAM_BOT` adıyla da kabul edilir)
- `TELEGRAM_CHAT_ID`

Basit Kargo:

- `BASITKARGO_TOKEN`
- `BASITKARGO_HANDLER` (`YURTICI`, `ARAS`, `MNG`, `SURAT`, `PTT`, `ECONOMIC` veya hesapta tanımlı değer)
- `KARGO_SAGLAYICI=basitkargo`

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
- yalnız gömülü iyzico formunun kabul edilmesi;
- `821` ile `821.00` tutarlarının eşdeğer kabul edilmesi;
- kurcalanmış tutarın reddi;
- işlenmiş callback'in entegrasyonları ikinci kez çağırmaması.
- eksik kargo/fatura yapılandırmasının `PROCESSED_WITH_WARNINGS` olarak kaydedilmesi.

## 4. Canlı duman testi

1. Düşük riskli gerçek bir sipariş oluşturun.
2. Kart alanının modal içinde kaldığını doğrulayın.
3. iyzico panelinde ödeme ve sipariş numarasını eşleştirin.
4. Cloudflare loglarında `order.paid` kaydını kontrol edin.
5. Telegram mesajı, Basit Kargo barkodu ve QNB fatura numarasının aynı sipariş numarasını taşıdığını doğrulayın.
6. Başarılı sayfayı yenileyin; ikinci kargo/fatura oluşmamalıdır.

Callback dış servis çağrılarını süreyle sınırlar. Kargo veya fatura oluşturulamazsa ödeme yine başarılı
kalır; sipariş KV'de `PROCESSED_WITH_WARNINGS` olarak, hata ayrıntılarıyla tutulur ve Telegram mesajında
"Bekliyor" olarak görünür. Bu durum siparişin ücretinin alındığını fakat operasyonel işlem gerektiğini belirtir.

Müşteri/admin e-postası, müşteri kişisel verilerinin harici e-posta sağlayıcısına aktarımı için açık onay alındıktan sonra etkinleştirilecektir.
