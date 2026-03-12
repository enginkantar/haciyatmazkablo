// =====================================================
// BASEMO TYPE-C 240W - JAVASCRIPT
// Payment Integration with Iyzico
// =====================================================

// Iyzico Pay Link (UPDATE WITH YOUR ACTUAL LINK)
const IYZICO_PAY_LINK = 'https://iyzi.link/AKc7ug';

// =====================================================
// COUNTDOWN TIMER & DYNAMIC PRICE
// =====================================================
const PRICE_NORMAL    = '821';
const PRICE_DISCOUNT  = '799';
const TIMER_TOTAL_SEC = 7 * 60; // 420 saniye

let currentPrice      = PRICE_DISCOUNT; // Sayfa açılışında indirimli fiyat
let timerSecondsLeft  = TIMER_TOTAL_SEC;
let timerInterval     = null;

function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function updatePriceLabels(price) {
  document.querySelectorAll('.dynamic-price').forEach(el => {
    el.textContent = price;
  });
}

function startCountdownTimer() {
  const countdown = document.getElementById('timerCountdown');
  const bar       = document.getElementById('timerBar');
  const banner    = document.getElementById('timerBanner');
  if (!countdown) return;

  // Başlangıç durumu: indirimli fiyat göster
  currentPrice = PRICE_DISCOUNT;
  updatePriceLabels(PRICE_DISCOUNT);
  countdown.textContent = formatTime(timerSecondsLeft);
  if (bar) bar.style.width = '100%';

  timerInterval = setInterval(() => {
    timerSecondsLeft--;

    if (timerSecondsLeft <= 0) {
      timerSecondsLeft = 0;
      clearInterval(timerInterval);

      // Süre doldu → normal fiyata geç
      currentPrice = PRICE_NORMAL;
      updatePriceLabels(PRICE_NORMAL);

      if (countdown) countdown.textContent = '0:00';
      if (bar) bar.style.width = '0%';
      if (banner) {
        banner.classList.add('expired');
        const inner = banner.querySelector('.timer-inner');
        if (inner) {
          inner.innerHTML =
            '<span>🔥</span>' +
            '<span class="timer-label">Stoklar Tükenmek Üzere :</span>' +
            '<span class="timer-label">Süre doldu →</span>' +
            '<span class="timer-price-badge" style="background:#888;color:#fff;">821 TL</span>';
        }
      }
      return;
    }

    if (countdown) countdown.textContent = formatTime(timerSecondsLeft);
    const pct = (timerSecondsLeft / TIMER_TOTAL_SEC) * 100;
    if (bar) bar.style.width = pct + '%';
  }, 1000);
}

// =====================================================
// DOM READY — TIMER + MENÜ + PAYMENT INIT
// =====================================================
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 BASEMO Landing Page Loaded');

    // Geri sayım sayacını başlat
    startCountdownTimer();

    const navbarCollapse = document.getElementById('navbarNav');
    
    if (navbarCollapse) {
        // Tüm nav-link'leri seç
        const navLinks = navbarCollapse.querySelectorAll('.nav-link');
        
        navLinks.forEach(link => {
            link.addEventListener('click', function() {
                // Link'e tıklanınca menu kapat
                const bsCollapse = new bootstrap.Collapse(navbarCollapse, {
                    toggle: false
                });
                bsCollapse.hide();
                console.log('✅ Menu kapatıldı');
            });
        });
    }
});

// DOM Initialization — Payment button + Keyboard Shortcuts
document.addEventListener('DOMContentLoaded', function() {
    console.log('Payment Provider: Iyzico');

    // Payment Button
    const paymentBtn = document.getElementById('paymentBtn');
    if (paymentBtn) {
        paymentBtn.addEventListener('click', handlePayment);
    }

    // Keyboard Shortcuts — input/textarea/select odaktayken çalışma
    document.addEventListener('keydown', function(e) {
        const tag = document.activeElement && document.activeElement.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (e.key.toLowerCase() === 'o') {
            openOrderModal();
        }
        if (e.key.toLowerCase() === 'w') {
            window.open('https://wa.me/905534759032', '_blank');
        }
    });

    // ── Step indicator animation on modal open ────────
    const orderModal = document.getElementById('orderModal');
    if (orderModal) {
        orderModal.addEventListener('shown.bs.modal', function() {
            // Her açılışta sıfırla
            ['step1', 'step2', 'step3'].forEach(id => {
                const el = document.getElementById(id);
                if (el) { el.style.opacity = 0; el.style.transform = 'translateX(-20px)'; }
            });
            ['stepLine1', 'stepLine2'].forEach(id => {
                const el = document.getElementById(id);
                if (el) { el.style.opacity = 0; el.style.transform = 'scaleX(0)'; }
            });

            if (typeof anime === 'undefined') return;

            anime.timeline({ easing: 'easeOutBack', duration: 380 })
                .add({ targets: '#step1',     opacity: [0,1], translateX: [-22, 0] }, 80)
                .add({ targets: '#stepLine1', opacity: [0,1], scaleX: [0,1],
                       transformOrigin: 'left center', easing: 'easeInOutSine', duration: 280 }, 380)
                .add({ targets: '#step2',     opacity: [0,1], translateX: [-22, 0] }, 580)
                .add({ targets: '#stepLine2', opacity: [0,1], scaleX: [0,1],
                       transformOrigin: 'left center', easing: 'easeInOutSine', duration: 280 }, 880)
                .add({ targets: '#step3',     opacity: [0,1], translateX: [-22, 0] }, 1080);
        });
    }
});

// ===== PAYMENT HANDLER =====
async function handlePayment() {
    const form = document.getElementById('orderForm');

    if (!form.checkValidity()) {
        showAlert('Lütfen tüm alanları doğru şekilde doldurunuz!', 'warning');
        form.reportValidity();
        return;
    }

    const customerName    = document.getElementById('customerName').value.trim();
    const customerEmail   = document.getElementById('customerEmail').value.trim();
    const customerPhone   = document.getElementById('customerPhone').value.trim();
    const customerAddress = document.getElementById('customerAddress').value.trim();
    const customerCity    = document.getElementById('customerCity').value.trim();

    if (!validatePhone(customerPhone)) {
        showAlert('Geçerli bir telefon numarası girin (05XXXXXXXXX — 11 haneli)', 'warning');
        return;
    }
    if (!validateEmail(customerEmail)) {
        showAlert('Geçerli bir e-posta adresi girin', 'warning');
        return;
    }
    if (!customerCity) {
        showAlert('Lütfen şehrinizi girin', 'warning');
        return;
    }

    const btn       = document.getElementById('paymentBtn');
    const inner     = document.getElementById('paymentBtnInner');
    const innerText = inner ? inner.innerHTML : '';
    btn.disabled    = true;
    if (inner) inner.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>İşleniyor...';

    try {
        const resp = await fetch('/api/payment/start', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name:    customerName,
                email:   customerEmail,
                phone:   customerPhone,
                address: customerAddress,
                city:    customerCity,
                price:   currentPrice,   // 799 (timer aktifse) veya 821
            }),
        });

        const data = await resp.json();

        if (!resp.ok || !data.paymentPageUrl) {
            throw new Error(data.error || 'Ödeme başlatılamadı.');
        }

        // Modal kapat, formu sıfırla
        const modal = bootstrap.Modal.getInstance(document.getElementById('orderModal'));
        if (modal) modal.hide();
        document.getElementById('orderForm').reset();

        showAlert('🔒 iyzico güvenli ödeme sayfasına yönlendiriliyorsunuz...', 'success');

        // Instagram/TikTok in-app dahil tüm browser'larda çalışır (fetch içinde redirect değil)
        setTimeout(() => { window.location.href = data.paymentPageUrl; }, 800);

    } catch (err) {
        console.error('Ödeme hatası:', err);
        showAlert(err.message || 'Bir hata oluştu. Lütfen tekrar deneyin.', 'warning');
        btn.disabled = false;
        if (inner) inner.innerHTML = innerText;
    }
}
// ===== MOBILE MENU AUTO-CLOSE =====
document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', function() {
        const navbarCollapse = document.querySelector('.navbar-collapse');
        if (navbarCollapse.classList.contains('show')) {
            const toggler = document.querySelector('.navbar-toggler');
            toggler.click(); // Menu'yü kapat
        }
    });
});

// ===== VALIDATION FUNCTIONS =====
function validateEmail(email) {
    // Sadece ASCII + standart e-posta formatı (ı, ğ, ş gibi Türkçe karakter reddedilir)
    const emailRegex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
    return emailRegex.test(email);
}

function validatePhone(phone) {
    // Türk GSM: 05XXXXXXXXX — 11 hane, boşluksuz
    const clean = phone.replace(/\s/g, '');
    return /^05[0-9]{9}$/.test(clean);
}

// ===== ALERT NOTIFICATIONS =====
function showAlert(message, type = 'info') {
    const alertHTML = `
        <div class="alert alert-${type === 'success' ? 'success' : type === 'warning' ? 'warning' : 'info'} alert-dismissible fade show position-fixed" 
             role="alert" 
             style="top: 20px; right: 20px; z-index: 9999; min-width: 300px;">
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        </div>
    `;
    
    const alertContainer = document.createElement('div');
    alertContainer.innerHTML = alertHTML;
    document.body.appendChild(alertContainer);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        const alert = alertContainer.querySelector('.alert');
        if (alert) {
            const bsAlert = new bootstrap.Alert(alert);
            bsAlert.close();
            alertContainer.remove();
        }
    }, 5000);
}

// ===== UTILITY FUNCTIONS =====
function openOrderModal() {
    const modal = new bootstrap.Modal(document.getElementById('orderModal'));
    modal.show();
}

// ===== SMOOTH SCROLL =====
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
        const href = this.getAttribute('href');
        if (href !== '#' && document.querySelector(href)) {
            e.preventDefault();
            document.querySelector(href).scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});

// ===== FORM ENHANCEMENTS =====

// ── Yardımcı: input glow durumu ──────────────────────────
function setFieldGlow(el, state) {
    if (state === 'valid') {
        el.style.borderColor = '#25d366';
        el.style.boxShadow  = '0 0 0 3px rgba(37,211,102,0.25)';
    } else if (state === 'invalid') {
        el.style.borderColor = '#ff4444';
        el.style.boxShadow  = '0 0 0 3px rgba(255,68,68,0.25)';
    } else {
        el.style.borderColor = '#333';
        el.style.boxShadow  = '';
    }
}

// ── Ad Soyad ─────────────────────────────────────────────
const nameInput = document.getElementById('customerName');
if (nameInput) {
    nameInput.addEventListener('input', function() {
        const v = this.value.trim();
        if (v.length === 0)      setFieldGlow(this, 'neutral');
        else if (v.length >= 3)  setFieldGlow(this, 'valid');
        else                     setFieldGlow(this, 'invalid');
    });
    nameInput.addEventListener('blur', function() {
        if (!this.value.trim()) setFieldGlow(this, 'neutral');
    });
}

// ── E-posta ───────────────────────────────────────────────
const emailInput = document.getElementById('customerEmail');
if (emailInput) {
    emailInput.addEventListener('input', function() {
        const v = this.value.trim();
        if (v.length === 0)          setFieldGlow(this, 'neutral');
        else if (validateEmail(v))   setFieldGlow(this, 'valid');
        else                         setFieldGlow(this, 'invalid');
    });
    emailInput.addEventListener('blur', function() {
        if (!this.value.trim()) setFieldGlow(this, 'neutral');
    });
}

// ── Telefon ───────────────────────────────────────────────
const phoneInput = document.getElementById('customerPhone');
if (phoneInput) {
    phoneInput.addEventListener('input', function() {
        let digits = this.value.replace(/\D/g, '');
        // +90 yapıştırma: 905XXXXXXXXX → 05XXXXXXXXX
        if (digits.startsWith('90') && digits.length >= 11) digits = '0' + digits.slice(1, 11);
        // 9... → 05... normalize
        if (digits.startsWith('9') && digits.length >= 10) digits = '0' + digits.slice(0, 10);
        // 11 hanede kes
        if (digits.length > 11) digits = digits.slice(0, 11);
        this.value = digits;

        if (digits.length === 0)                              setFieldGlow(this, 'neutral');
        else if (digits.length >= 2 && !digits.startsWith('05')) setFieldGlow(this, 'invalid');
        else if (digits.length === 11)                        setFieldGlow(this, 'valid');
        else                                                  setFieldGlow(this, 'neutral');
    });
    phoneInput.addEventListener('paste', function() {
        setTimeout(() => phoneInput.dispatchEvent(new Event('input')), 0);
    });
    phoneInput.addEventListener('blur', function() {
        if (!this.value) setFieldGlow(this, 'neutral');
    });
}

// ── Şehir (select) ────────────────────────────────────────
const citySelect = document.getElementById('customerCity');
if (citySelect) {
    citySelect.addEventListener('change', function() {
        if (this.value) setFieldGlow(this, 'valid');
        else            setFieldGlow(this, 'neutral');
    });
}

// ── Adres ─────────────────────────────────────────────────
const addressInput = document.getElementById('customerAddress');
if (addressInput) {
    addressInput.addEventListener('input', function() {
        const v = this.value.trim();
        if (v.length === 0)       setFieldGlow(this, 'neutral');
        else if (v.length >= 10)  setFieldGlow(this, 'valid');
        else                      setFieldGlow(this, 'invalid');
    });
    addressInput.addEventListener('blur', function() {
        if (!this.value.trim()) setFieldGlow(this, 'neutral');
    });
}

// ===== ANALYTICS (Optional) =====
function trackEvent(eventName, eventData) {
    console.log(`📊 Event: ${eventName}`, eventData);
    
    // If you use Google Analytics, add here:
    // gtag('event', eventName, eventData);
}

// Track page load
trackEvent('page_view', {
    page_title: 'BASEMO Type-C 240W Landing Page',
    product: 'BASEMO-TYPE-C-240W',
    price: 821,
    currency: 'TRY'
});

// Track button clicks
document.querySelectorAll('button[data-bs-toggle="modal"]').forEach(btn => {
    btn.addEventListener('click', function() {
        trackEvent('open_order_modal', {
            button_text: this.innerText
        });
    });
});


// ===== CONSOLE GREETING =====
console.log('%c🚀 BASEMO Type-C 240W Landing Page', 'font-size: 18px; color: #ffc107; font-weight: bold;');
console.log('%cPayment Provider: Iyzico Pay Link', 'font-size: 12px; color: #666;');
console.log('%cPrice: ₺821 | Currency: TRY | Product: BASEMO Type-C 240W', 'font-size: 11px; color: #999;');
console.log('%c📞 Support: 0553 475 90 32 (WhatsApp) | 💬 Email: info@batumedikal.com', 'font-size: 11px; color: #666;');
console.log('%cKeyboard Shortcuts: O = Order, W = WhatsApp', 'font-size: 11px; color: #999;');


function openVideoPlayer() {
  console.log('▶️ Video açılıyor');
  const videoOverlay = document.getElementById('videoOverlay');
  const videoPlayer = document.getElementById('videoPlayer');
  
  videoOverlay.style.display = 'flex';
  
  // Biraz delay ver
  setTimeout(() => {
    videoPlayer.play().catch(error => {
      console.warn('Autoplay blocked:', error);
    });
  }, 100);
}

function closeVideoPlayer() {
  console.log('✖️ Video kapatılıyor');

  const overlay = document.getElementById('videoOverlay');
  const video = document.getElementById('videoPlayer');
  const btn = document.getElementById('videoPlayBtn');

  video.pause();
  video.currentTime = 0;

  overlay.style.display = 'none';
  if (btn) btn.style.display = 'flex';
}

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeVideoPlayer();
});
