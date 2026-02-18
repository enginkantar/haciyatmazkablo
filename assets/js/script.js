// =====================================================
// BASEMO TYPE-C 240W - JAVASCRIPT
// Payment Integration with Iyzico
// =====================================================

// Iyzico Pay Link (UPDATE WITH YOUR ACTUAL LINK)

const IYZICO_PAY_LINK = 'https://iyzi.link/AKc7ug';

// Menu linklarına event listener ekle
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 BASEMO Landing Page Loaded');
    
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

// DOM Initialization
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 BASEMO Landing Page Loaded');
    console.log('Payment Provider: Iyzico');
    
    // Payment Button
    const paymentBtn = document.getElementById('paymentBtn');
    if (paymentBtn) {
        paymentBtn.addEventListener('click', handlePayment);
    }
    
    // Keyboard Shortcuts
    document.addEventListener('keydown', function(e) {
        if (e.key.toLowerCase() === 'o') {
            openOrderModal();
        }
        if (e.key.toLowerCase() === 'w') {
            window.open('https://wa.me/905534759032', '_blank');
        }
    });
});

// ===== PAYMENT HANDLER =====
function handlePayment() {
    const form = document.getElementById('orderForm');
    
    // Validate form
    if (!form.checkValidity()) {
        showAlert('Lütfen tüm alanları doğru şekilde doldurunuz!', 'warning');
        form.reportValidity();
        return;
    }
    
    // Get form data
    const customerName = document.getElementById('customerName').value.trim();
    const customerEmail = document.getElementById('customerEmail').value.trim();
    const customerPhone = document.getElementById('customerPhone').value.trim();
    const customerAddress = document.getElementById('customerAddress').value.trim();
    
    // Validate phone format
    if (!validatePhone(customerPhone)) {
        showAlert('Geçerli bir telefon numarası girin (05XX XXX XXXX)', 'warning');
        return;
    }
    
    // Validate email
    if (!validateEmail(customerEmail)) {
        showAlert('Geçerli bir e-posta adresi girin', 'warning');
        return;
    }
    
    // Log order info
    const orderData = {
        name: customerName,
        email: customerEmail,
        phone: customerPhone,
        address: customerAddress,
        product: 'BASEMO Type-C 240W',
        price: 989,
        currency: 'TRY',
        timestamp: new Date().toISOString()
    };
    
    console.log('📦 Sipariş Bilgileri:', orderData);
    
    // Show loading state
    const btn = document.getElementById('paymentBtn');
    const btnText = btn.innerText;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>İşleniyor...';
    
    // Simulate processing (1.5 seconds)
    setTimeout(() => {
        redirectToPayment(orderData);
        
        // Reset button
        btn.disabled = false;
        btn.innerText = btnText;
    }, 1500);
}

// ===== REDIRECT TO IYZICO =====
function redirectToPayment(orderData) {
    // Build payment URL with parameters
    const params = new URLSearchParams({
        customerName: orderData.name,
        customerEmail: orderData.email,
        customerPhone: orderData.phone,
        customerAddress: orderData.address,
        product: orderData.product,
        price: orderData.price,
        currency: orderData.currency
    });
    
    const paymentUrl = `${IYZICO_PAY_LINK}?${params.toString()}`;
    
    console.log('💳 Ödeme URL\'si:', paymentUrl);
    
    // Show success notification
    showAlert('Ödeme sayfasına yönlendiriliyorsunuz...', 'success');
    
    // Redirect to Iyzico (opens in new window)
    setTimeout(() => {
        window.open(paymentUrl, '_blank');
        
        // Close modal
        const modal = bootstrap.Modal.getInstance(document.getElementById('orderModal'));
        if (modal) {
            modal.hide();
        }
        
        // Reset form
        document.getElementById('orderForm').reset();
    }, 500);
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
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

function validatePhone(phone) {
    // Turkish phone format: 05XX XXX XXXX or +90XXX XXX XXXX
    const phoneRegex = /^(\+90|0)[0-9]{10}$|^(05\d{2}\s\d{3}\s\d{4}|0\d{3}\s\d{3}\s\d{4})$/;
    const cleanPhone = phone.replace(/\s/g, '');
    return phoneRegex.test(cleanPhone) && cleanPhone.length >= 10;
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
const phoneInput = document.getElementById('customerPhone');
if (phoneInput) {
    phoneInput.addEventListener('input', function() {
        // Auto-format phone number
        let value = this.value.replace(/\D/g, '');
        if (value.length > 0) {
            if (value.startsWith('0')) {
                if (value.length > 3) {
                    value = value.slice(0, 4) + ' ' + value.slice(4, 7) + ' ' + value.slice(7, 11);
                }
            } else if (value.startsWith('9')) {
                value = '0' + value;
                if (value.length > 3) {
                    value = value.slice(0, 4) + ' ' + value.slice(4, 7) + ' ' + value.slice(7, 11);
                }
            }
        }
        this.value = value;
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
    price: 989,
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
console.log('%cPrice: ₺989 | Currency: TRY | Product: BASEMO Type-C 240W', 'font-size: 11px; color: #999;');
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
