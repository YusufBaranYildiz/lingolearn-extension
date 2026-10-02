// LingoLearn - Content Script (Otomatik Metin & Resim Kelime Algılama Asistanı)
(function () {
  'use strict';

  if (window.__lingoLearnInitialized) return;
  window.__lingoLearnInitialized = true;

  // Shadow DOM kök elemanı
  let rootElement = null;
  let shadowRoot = null;
  let activeBadge = null;
  let activeCard = null;
  let currentSelectionText = '';
  let currentContextSentence = '';

  // Sayfa metin tarama durumu
  let hasScannedPage = false;
  let detectedWordCount = 0;
  let scannerPillElement = null;
  let highlightsVisible = true;

  // Resim OCR durumu
  let activeImgBadge = null;
  let currentHoveredImg = null;
  let imgHoverTimeout = null;
  let activeOcrModal = null;
  let lastTargetImg = null;
  let activeCropOverlay = null;

  // Varsayılan ayarlar
  let settings = {
    isEnabled: true,
    triggerMode: 'badge', // 'badge' veya 'instant'
    doubleClickLookup: true, // Çift tıklamayla doğrudan anlam göster
    altClickLookup: true, // Alt tuşuna basarak tıklamada kelime algıla
    autoScanWords: true, // Sayfadaki yabancı kelimeleri otomatik fark et
    imageOcrEnabled: true, // Resimlerdeki kelimeleri okuma modu
    autoPronounce: false
  };

  // Çok temel İngilizce bağlaç, edat ve zamirler (Öğrenilmek istenen kelimelerin öne çıkması için filtrelenir)
  const STOP_WORDS = new Set([
    'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i', 'it', 'for', 'not', 'on', 'with',
    'he', 'as', 'you', 'do', 'at', 'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she',
    'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what', 'so', 'up', 'out', 'if',
    'about', 'who', 'get', 'which', 'go', 'me', 'when', 'make', 'can', 'like', 'time', 'no', 'just', 'him',
    'know', 'take', 'into', 'year', 'your', 'some', 'could', 'them', 'see', 'other', 'than', 'then', 'now',
    'look', 'only', 'come', 'its', 'over', 'think', 'also', 'back', 'after', 'use', 'two', 'how', 'our',
    'way', 'even', 'want', 'because', 'any', 'these', 'give', 'day', 'most', 'us', 'are', 'is', 'was',
    'were', 'been', 'has', 'had', 'did', 'does', 'am', 'shall', 'should', 'may', 'might', 'must'
  ]);

  // Ayarları yükle ve dinle
  function loadSettings() {
    chrome.storage.local.get(
      ['isEnabled', 'triggerMode', 'doubleClickLookup', 'altClickLookup', 'autoScanWords', 'imageOcrEnabled', 'autoPronounce', 'words'],
      (res) => {
        if (res.isEnabled !== undefined) settings.isEnabled = res.isEnabled;
        if (res.triggerMode !== undefined) settings.triggerMode = res.triggerMode;
        if (res.doubleClickLookup !== undefined) settings.doubleClickLookup = res.doubleClickLookup;
        if (res.altClickLookup !== undefined) settings.altClickLookup = res.altClickLookup;
        if (res.autoScanWords !== undefined) settings.autoScanWords = res.autoScanWords;
        if (res.imageOcrEnabled !== undefined) settings.imageOcrEnabled = res.imageOcrEnabled;
        if (res.autoPronounce !== undefined) settings.autoPronounce = res.autoPronounce;

        if (settings.isEnabled && settings.autoScanWords && !hasScannedPage) {
          initPageAutoScanner(res.words || []);
        }
      }
    );
  }

  loadSettings();

  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
      if (changes.isEnabled) {
        settings.isEnabled = changes.isEnabled.newValue;
        if (!settings.isEnabled) {
          removeElements();
          removeImgBadge();
          closeOcrModal();
          hideScannerPill();
          document.body.classList.add('lingo-highlights-hidden');
        } else {
          document.body.classList.remove('lingo-highlights-hidden');
          if (settings.autoScanWords && !hasScannedPage) {
            chrome.storage.local.get(['words'], res => initPageAutoScanner(res.words || []));
          }
        }
      }
      if (changes.triggerMode) settings.triggerMode = changes.triggerMode.newValue;
      if (changes.doubleClickLookup) settings.doubleClickLookup = changes.doubleClickLookup.newValue;
      if (changes.altClickLookup) settings.altClickLookup = changes.altClickLookup.newValue;
      if (changes.imageOcrEnabled) settings.imageOcrEnabled = changes.imageOcrEnabled.newValue;
      if (changes.autoScanWords) {
        settings.autoScanWords = changes.autoScanWords.newValue;
        if (settings.autoScanWords) {
          document.body.classList.remove('lingo-highlights-hidden');
          if (!hasScannedPage) {
            chrome.storage.local.get(['words'], res => initPageAutoScanner(res.words || []));
          } else if (scannerPillElement) {
            scannerPillElement.style.display = 'flex';
          }
        } else {
          document.body.classList.add('lingo-highlights-hidden');
          hideScannerPill();
        }
      }
      if (changes.autoPronounce) settings.autoPronounce = changes.autoPronounce.newValue;
    }
  });

  // ==========================================
  // 1. OTOMATİK METİN TARAMA MOTORU
  // ==========================================
  function initPageAutoScanner(savedWords = []) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => scanAndHighlightPage(savedWords));
    } else {
      setTimeout(() => scanAndHighlightPage(savedWords), 500);
    }
  }

  function scanAndHighlightPage(savedWords = []) {
    if (hasScannedPage || !settings.isEnabled || !settings.autoScanWords) return;
    hasScannedPage = true;

    const savedWordsSet = new Set(savedWords.map(w => w.original.trim().toLowerCase()));

    const contentContainers = document.querySelectorAll('article, main, .content, #content, p, li, h1, h2, h3, h4, h5, h6, blockquote');
    const targetContainers = contentContainers.length > 0 ? Array.from(contentContainers) : [document.body];

    const wordRegex = /\b[a-zA-Z]{3,}\b/g;
    let totalDetected = 0;

    targetContainers.forEach(container => {
      if (container.closest('#lingolearn-extension-root, .lingo-scanner-pill, pre, code, script, style, textarea, input, svg, nav, footer')) {
        return;
      }

      const walker = document.createTreeWalker(
        container,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: (node) => {
            const parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;
            const tag = parent.tagName.toLowerCase();
            if (['script', 'style', 'noscript', 'textarea', 'input', 'select', 'button', 'code', 'pre', 'svg'].includes(tag)) {
              return NodeFilter.FILTER_REJECT;
            }
            if (parent.closest('#lingolearn-extension-root') || parent.classList.contains('lingo-detected-word')) {
              return NodeFilter.FILTER_REJECT;
            }
            if (!node.textContent || node.textContent.trim().length < 3) {
              return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
          }
        }
      );

      const textNodes = [];
      while (walker.nextNode()) {
        textNodes.push(walker.currentNode);
      }

      textNodes.forEach(node => {
        const text = node.textContent;
        let match;
        const matches = [];

        while ((match = wordRegex.exec(text)) !== null) {
          const word = match[0];
          const lower = word.toLowerCase();

          if (!STOP_WORDS.has(lower) && lower.length >= 3) {
            matches.push({ word, index: match.index, length: word.length });
          }
        }

        if (matches.length > 0) {
          const fragment = document.createDocumentFragment();
          let lastIdx = 0;

          matches.forEach(m => {
            if (m.index > lastIdx) {
              fragment.appendChild(document.createTextNode(text.substring(lastIdx, m.index)));
            }

            const span = document.createElement('span');
            span.className = 'lingo-detected-word';
            span.textContent = m.word;
            span.dataset.word = m.word;

            if (savedWordsSet.has(m.word.toLowerCase())) {
              span.classList.add('lingo-saved');
              span.title = 'LingoLearn: Defterinizde Kayıtlı Kelime';
            } else {
              span.title = 'LingoLearn: Anlamını ve telaffuzunu görmek için tıklayın';
            }

            fragment.appendChild(span);
            lastIdx = m.index + m.length;
            totalDetected++;
          });

          if (lastIdx < text.length) {
            fragment.appendChild(document.createTextNode(text.substring(lastIdx)));
          }

          if (node.parentNode) {
            node.parentNode.replaceChild(fragment, node);
          }
        }
      });
    });

    detectedWordCount = totalDetected;

    if (detectedWordCount > 0) {
      renderScannerPill(detectedWordCount);
    }
  }

  function renderScannerPill(count) {
    if (scannerPillElement) {
      scannerPillElement.remove();
    }

    const pill = document.createElement('div');
    pill.className = 'lingo-scanner-pill';
    pill.id = 'lingo-scanner-pill';
    pill.innerHTML = `
      <div class="lingo-scanner-pill-icon">
        <svg viewBox="0 0 24 24" width="16" height="16">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/>
        </svg>
      </div>
      <span class="lingo-scanner-text"><strong>${count}</strong> yabancı kelime fark edildi</span>
      <button class="lingo-scanner-toggle-btn" id="lingo-toggle-highlights-btn" title="Vurguları Gizle / Göster">
        ${highlightsVisible ? 'Gizle' : 'Göster'}
      </button>
      <button class="lingo-scanner-close-btn" id="lingo-close-scanner-pill" title="Kapat">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    `;

    document.body.appendChild(pill);
    scannerPillElement = pill;

    const toggleBtn = pill.querySelector('#lingo-toggle-highlights-btn');
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      highlightsVisible = !highlightsVisible;
      if (highlightsVisible) {
        document.body.classList.remove('lingo-highlights-hidden');
        toggleBtn.textContent = 'Gizle';
      } else {
        document.body.classList.add('lingo-highlights-hidden');
        toggleBtn.textContent = 'Göster';
      }
    });

    const closeBtn = pill.querySelector('#lingo-close-scanner-pill');
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      pill.style.display = 'none';
    });
  }

  function hideScannerPill() {
    if (scannerPillElement) {
      scannerPillElement.style.display = 'none';
    }
  }

  // ==========================================
  // 2. RESİMLERDEKİ KELİMELERİ OKUMA (OCR)
  // ==========================================
  document.addEventListener('mouseover', (e) => {
    if (!settings.isEnabled || !settings.imageOcrEnabled) return;
    const img = e.target.closest ? e.target.closest('img') : null;
    if (!img) return;

    if (img.closest('#lingolearn-extension-root, .lingo-scanner-pill, .lingo-ocr-modal')) return;

    const rect = img.getBoundingClientRect();
    // Çok küçük simgeleri yoksay (Genişlik >= 80 ve Yükseklik >= 50)
    if (rect.width < 80 || rect.height < 50) return;

    currentHoveredImg = img;
    clearTimeout(imgHoverTimeout);
    showImageOcrBadge(img, rect);
  });

  document.addEventListener('mouseout', (e) => {
    const img = e.target.closest ? e.target.closest('img') : null;
    if (img && img === currentHoveredImg) {
      imgHoverTimeout = setTimeout(() => {
        if (activeImgBadge && !activeImgBadge.matches(':hover')) {
          removeImgBadge();
        }
      }, 500);
    }
  });

  // Resim Üzerinde "Tüm Resim" ve "Balon / Alan Seç" Rozet Grubu Göster
  function showImageOcrBadge(img, rect) {
    removeImgBadge();
    lastTargetImg = img;

    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;

    const badge = document.createElement('div');
    badge.className = 'lingo-img-badge-wrap';
    badge.innerHTML = `
      <button class="lingo-badge-btn" id="lingo-badge-full-btn" title="Tüm Resmi Otomatik Oku">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
          <path d="M9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z"/>
        </svg>
        <span>Tüm Resim</span>
      </button>
      <div class="lingo-badge-sep"></div>
      <button class="lingo-badge-btn crop" id="lingo-badge-crop-btn" title="Konuşma Balonu veya Bölge Seçerek Çevir (Manga & Çizgi Roman İçin İdeal)">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <circle cx="6" cy="6" r="3"></circle>
          <circle cx="6" cy="18" r="3"></circle>
          <line x1="20" y1="4" x2="8.12" y2="15.88"></line>
          <line x1="14.47" y1="14.48" x2="20" y2="20"></line>
          <line x1="8.12" y1="8.12" x2="12" y2="12"></line>
        </svg>
        <span>✂️ Balon / Alan Seç</span>
      </button>
    `;

    badge.style.top = `${rect.top + scrollY + 8}px`;
    badge.style.left = `${rect.left + scrollX + 8}px`;

    badge.addEventListener('mouseenter', () => clearTimeout(imgHoverTimeout));
    badge.addEventListener('mouseleave', () => {
      imgHoverTimeout = setTimeout(() => removeImgBadge(), 400);
    });

    const fullBtn = badge.querySelector('#lingo-badge-full-btn');
    if (fullBtn) {
      fullBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeImgBadge();
        startImageOCR(img.src || img.currentSrc, img);
      });
    }

    const cropBtn = badge.querySelector('#lingo-badge-crop-btn');
    if (cropBtn) {
      cropBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeImgBadge();
        startImageCropper(img);
      });
    }

    document.body.appendChild(badge);
    activeImgBadge = badge;
  }

  function removeImgBadge() {
    if (activeImgBadge && activeImgBadge.parentNode) {
      activeImgBadge.parentNode.removeChild(activeImgBadge);
    }
    activeImgBadge = null;
  }

  // İnteraktif Konuşma Balonu / Bölge Kırpma Aracı
  function startImageCropper(img) {
    if (!img) return;
    try {
      removeImgBadge();
      closeOcrModal();
      removeCropOverlay();
      lastTargetImg = img;

      const rect = img.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) {
        console.warn('[LingoLearn] Kırpılacak görselin boyutları geçersiz veya henüz sayfada görünmüyor.');
        return;
      }

      const scrollX = window.scrollX || window.pageXOffset;
      const scrollY = window.scrollY || window.pageYOffset;

      const overlay = document.createElement('div');
      overlay.className = 'lingo-crop-overlay';
      overlay.style.top = `${rect.top + scrollY}px`;
      overlay.style.left = `${rect.left + scrollX}px`;
      overlay.style.width = `${rect.width}px`;
      overlay.style.height = `${rect.height}px`;

      overlay.innerHTML = `
        <div class="lingo-crop-instructions">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="6" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle>
            <line x1="20" y1="4" x2="8.12" y2="15.88"></line><line x1="14.47" y1="14.48" x2="20" y2="20"></line><line x1="8.12" y1="8.12" x2="12" y2="12"></line>
          </svg>
          <span>Okutmak istediğiniz konuşma balonunu fareyle kutu içine alın (İptal: ESC)</span>
        </div>
        <div class="lingo-crop-selection-box" style="display:none;">
          <span class="lingo-crop-dimensions">0 × 0</span>
        </div>
      `;

      document.body.appendChild(overlay);
      activeCropOverlay = overlay;

      let isDrawing = false;
      let startX = 0;
      let startY = 0;
      const selectionBox = overlay.querySelector('.lingo-crop-selection-box');
      const dimSpan = overlay.querySelector('.lingo-crop-dimensions');

      function onMouseDown(e) {
        if (e.button !== 0) return; // Yalnızca sol tık
        e.preventDefault();
        e.stopPropagation();

        if (!overlay || !overlay.isConnected) return;
        const overlayRect = overlay.getBoundingClientRect();
        if (overlayRect.width <= 0 || overlayRect.height <= 0) return;

        isDrawing = true;
        startX = Math.max(0, Math.min(overlayRect.width, e.clientX - overlayRect.left));
        startY = Math.max(0, Math.min(overlayRect.height, e.clientY - overlayRect.top));

        if (selectionBox) {
          selectionBox.style.left = `${startX}px`;
          selectionBox.style.top = `${startY}px`;
          selectionBox.style.width = '0px';
          selectionBox.style.height = '0px';
          selectionBox.style.display = 'block';
        }

        // Dinleyicileri SADECE çizim anında pencereye bağla
        window.addEventListener('mousemove', onMouseMove, { passive: false });
        window.addEventListener('mouseup', onMouseUp);
      }

      function onMouseMove(e) {
        if (!isDrawing) return;
        e.preventDefault();
        e.stopPropagation();

        if (!overlay || !overlay.isConnected) return;
        const overlayRect = overlay.getBoundingClientRect();
        if (overlayRect.width <= 0 || overlayRect.height <= 0) return;

        const curX = Math.max(0, Math.min(overlayRect.width, e.clientX - overlayRect.left));
        const curY = Math.max(0, Math.min(overlayRect.height, e.clientY - overlayRect.top));

        const boxLeft = Math.min(startX, curX);
        const boxTop = Math.min(startY, curY);
        const boxWidth = Math.abs(curX - startX);
        const boxHeight = Math.abs(curY - startY);

        if (selectionBox) {
          selectionBox.style.left = `${boxLeft}px`;
          selectionBox.style.top = `${boxTop}px`;
          selectionBox.style.width = `${boxWidth}px`;
          selectionBox.style.height = `${boxHeight}px`;
        }

        if (dimSpan) {
          dimSpan.textContent = `${Math.round(boxWidth)} × ${Math.round(boxHeight)} px`;
        }
      }

      function onMouseUp(e) {
        // Çizim dinleyicilerini derhal kaldır
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);

        if (!isDrawing) return;
        isDrawing = false;

        if (!overlay || !overlay.isConnected) {
          removeCropOverlay();
          return;
        }

        const overlayRect = overlay.getBoundingClientRect();
        if (overlayRect.width <= 0 || overlayRect.height <= 0) {
          removeCropOverlay();
          return;
        }

        const curX = Math.max(0, Math.min(overlayRect.width, e.clientX - overlayRect.left));
        const curY = Math.max(0, Math.min(overlayRect.height, e.clientY - overlayRect.top));

        const boxLeft = Math.min(startX, curX);
        const boxTop = Math.min(startY, curY);
        const boxWidth = Math.abs(curX - startX);
        const boxHeight = Math.abs(curY - startY);

        if (boxWidth >= 20 && boxHeight >= 15) {
          const cropArea = {
            xRatio: boxLeft / overlayRect.width,
            yRatio: boxTop / overlayRect.height,
            widthRatio: boxWidth / overlayRect.width,
            heightRatio: boxHeight / overlayRect.height
          };

          let croppedDataUrl = null;
          try {
            const naturalW = img.naturalWidth || img.width || overlayRect.width;
            const naturalH = img.naturalHeight || img.height || overlayRect.height;
            const scaleX = naturalW / overlayRect.width;
            const scaleY = naturalH / overlayRect.height;

            const cropCanvas = document.createElement('canvas');
            const cropW = Math.max(1, Math.round(boxWidth * scaleX));
            const cropH = Math.max(1, Math.round(boxHeight * scaleY));
            cropCanvas.width = cropW;
            cropCanvas.height = cropH;

            const ctx = cropCanvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';

            ctx.drawImage(
              img,
              Math.round(boxLeft * scaleX),
              Math.round(boxTop * scaleY),
              cropW,
              cropH,
              0,
              0,
              cropW,
              cropH
            );

            croppedDataUrl = cropCanvas.toDataURL('image/jpeg', 0.95);
          } catch (cropErr) {
            console.info('[LingoLearn] Tuval yerel olarak kısıtlı (CORS). Koordinatlar Offscreen servisine iletiliyor.');
            croppedDataUrl = null;
          }

          removeCropOverlay();

          if (croppedDataUrl) {
            startImageOCR(croppedDataUrl, null, true, img);
          } else {
            startImageOCR(img.src || img.currentSrc, img, true, img, cropArea);
          }
        } else {
          removeCropOverlay();
        }
      }

      function onKeyDown(e) {
        try {
          if (e && e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            removeCropOverlay();
          }
        } catch (err) {
          console.warn('[LingoLearn] onKeyDown uyarısı:', err);
        }
      }

      overlay.addEventListener('mousedown', onMouseDown);
      window.addEventListener('keydown', onKeyDown, true);

      overlay._cleanup = () => {
        try {
          isDrawing = false;
          overlay.removeEventListener('mousedown', onMouseDown);
          window.removeEventListener('mousemove', onMouseMove);
          window.removeEventListener('mouseup', onMouseUp);
          window.removeEventListener('keydown', onKeyDown, true);
        } catch (err) {}
      };
    } catch (cropperInitErr) {
      console.warn('[LingoLearn] Kırpma aracı başlatma hatası:', cropperInitErr);
      removeCropOverlay();
    }
  }

  function removeCropOverlay() {
    try {
      if (activeCropOverlay) {
        if (typeof activeCropOverlay._cleanup === 'function') {
          activeCropOverlay._cleanup();
        }
        if (activeCropOverlay.parentNode) {
          activeCropOverlay.parentNode.removeChild(activeCropOverlay);
        }
      }
    } catch (err) {
      console.warn('[LingoLearn] removeCropOverlay hatası:', err);
    } finally {
      activeCropOverlay = null;
    }
  }

  // Background servisinden gelen sağ tık menüsü veya ilerleme mesajlarını dinle
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'TRIGGER_IMAGE_OCR') {
      const matchingImg = Array.from(document.querySelectorAll('img')).find(img => 
        img.src === request.srcUrl || img.currentSrc === request.srcUrl || img.getAttribute('src') === request.srcUrl
      ) || null;
      startImageOCR(request.srcUrl, matchingImg);
    } else if (request.action === 'OCR_PROGRESS') {
      updateOcrProgress(request.progress);
    }
  });

  // Resim Üzerinde OCR İşlemini Başlat
  async function startImageOCR(imageUrl, imgElement = null, isCropped = false, sourceImg = null, cropArea = null) {
    if (!imageUrl) return;

    if (imgElement) lastTargetImg = imgElement;
    if (sourceImg) lastTargetImg = sourceImg;

    showOcrLoadingModal(imageUrl);

    let imageMeta = {
      src: imageUrl,
      width: 0,
      height: 0,
      originalWidth: 0,
      originalHeight: 0,
      isCropped: isCropped,
      cropArea: cropArea,
      sourceType: imageUrl.startsWith('data:') ? 'Base64 (Data URI)' : imageUrl.startsWith('file:') ? 'Yerel Dosya (file://)' : 'Web Görseli (HTTP/HTTPS)'
    };

    try {
      // 1. Resim verisini al (Önce doğrudan Canvas ile dene - en hızlı ve güvenli yöntem)
      let cleanImageData = null;

      if (!imgElement) {
        imgElement = Array.from(document.querySelectorAll('img')).find(img => 
          img.src === imageUrl || img.currentSrc === imageUrl || img.getAttribute('src') === imageUrl
        ) || null;
      }

      if (imgElement) {
        imageMeta.originalWidth = imgElement.naturalWidth || imgElement.width || 0;
        imageMeta.originalHeight = imgElement.naturalHeight || imgElement.height || 0;
        imageMeta.width = imageMeta.originalWidth;
        imageMeta.height = imageMeta.originalHeight;
      }

      // Boyut kontrolü ve akıllı optimizasyon (Kırpma alanı yoksa ve bütün resimse bellek için maks 1800px sınırına ölçekle)
      if (!cropArea && !isCropped && imgElement && imgElement.naturalWidth > 0) {
        try {
          const origW = imgElement.naturalWidth;
          const origH = imgElement.naturalHeight;
          const MAX_DIM = 1800;
          let targetW = origW;
          let targetH = origH;

          if (origW > MAX_DIM || origH > MAX_DIM) {
            const ratio = Math.min(MAX_DIM / origW, MAX_DIM / origH);
            targetW = Math.max(1, Math.round(origW * ratio));
            targetH = Math.max(1, Math.round(origH * ratio));
          }

          const canvas = document.createElement('canvas');
          canvas.width = targetW;
          canvas.height = targetH;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(imgElement, 0, 0, targetW, targetH);

          // JPEG formatı PNG'ye göre 10-15 kat daha az veri taşır, çok daha hızlıdır
          const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
          if (dataUrl && dataUrl.length > 100) {
            cleanImageData = dataUrl;
          }
        } catch (canvasErr) {
          // Tainted canvas (CORS) durumunda arka plan servisi veya doğrudan URL denenecek
          cleanImageData = null;
        }
      }

      // Zaten data: URI ise doğrudan kullan
      if (!cleanImageData && imageUrl.startsWith('data:')) {
        cleanImageData = imageUrl;
      }

      // Blob URL ise sayfa içeriğinden doğrudan Blob olarak oku
      if (!cleanImageData && imageUrl.startsWith('blob:')) {
        try {
          const blobRes = await fetch(imageUrl);
          const blobData = await blobRes.blob();
          cleanImageData = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blobData);
          });
        } catch (blobErr) {
          console.warn('[LingoLearn] Blob okuma uyarısı:', blobErr);
        }
      }

      // Canvas başarısız olduysa arka plandan Base64 talep et (Yerel dosyalar ve harici linkler dahil)
      if (!cleanImageData && imageUrl && (imageUrl.startsWith('http://') || imageUrl.startsWith('https://') || imageUrl.startsWith('file://'))) {
        try {
          const bgRes = await new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: 'FETCH_IMAGE_BASE64', url: imageUrl }, resolve);
          });
          if (bgRes && bgRes.success && bgRes.dataUrl) {
            cleanImageData = bgRes.dataUrl;
          } else if (bgRes && bgRes.error) {
            console.warn('[LingoLearn] Arka plan indirme uyarısı:', bgRes.error);
          }
        } catch (err) {
          console.warn('[LingoLearn] Arka plan fallback uyarısı:', err);
        }
      }

      if (!cleanImageData) {
        cleanImageData = imageUrl;
      }

      // 2. OCR işlemini güvenli Offscreen belgesi üzerinden arka planda çalıştır (CSP engelleri %100 aşılır)
      const ocrRes = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { 
            action: 'START_IMAGE_OCR', 
            imageData: cleanImageData,
            cropArea: cropArea || null
          },
          (response) => {
            if (chrome.runtime.lastError) {
              resolve({ success: false, error: chrome.runtime.lastError.message });
            } else {
              resolve(response || { success: false, error: 'OCR servisinden yanıt alınamadı.' });
            }
          }
        );
      });

      if (!ocrRes || !ocrRes.success) {
        const errorMsg = (ocrRes && ocrRes.error) || 'Resimdeki metin çözümlenemedi.';
        const details = (ocrRes && ocrRes.details) || '';
        renderOcrErrorModal(imageUrl, errorMsg, imageMeta, details);
        return;
      }

      const extractedText = ocrRes.text ? ocrRes.text.trim() : '';
      const ocrMeta = ocrRes.metadata || imageMeta;

      if (!extractedText) {
        renderOcrEmptyModal(imageUrl, ocrMeta);
        return;
      }

      // 4. Bulunan metindeki İngilizce kelimeleri ayrıştır
      const words = Array.from(new Set(extractedText.match(/[a-zA-Z]{2,}/g) || []));

      // 5. Metnin Türkçe tam çevirisini getir
      chrome.runtime.sendMessage(
        { action: 'TRANSLATE', text: extractedText, targetLang: 'tr' },
        (transRes) => {
          const translation = transRes && transRes.success ? transRes.translatedText : '';
          renderOcrSuccessModal(imageUrl, extractedText, words, translation, ocrMeta, ocrRes.confidence);
        }
      );
    } catch (error) {
      console.warn('[LingoLearn OCR Notice]:', error);
      renderOcrErrorModal(imageUrl, error.message || 'Resim işlenirken beklenmeyen bir hata oluştu.', imageMeta, error.stack);
    }
  }

  // OCR Yükleniyor Modalı
  function showOcrLoadingModal(imageUrl) {
    closeOcrModal();

    const backdrop = document.createElement('div');
    backdrop.className = 'lingo-ocr-backdrop';
    backdrop.id = 'lingo-ocr-modal-root';

    backdrop.innerHTML = `
      <div class="lingo-ocr-modal">
        <div class="lingo-ocr-header">
          <div class="lingo-ocr-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#4f46e5">
              <path d="M9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z"/>
            </svg>
            <span>Resimdeki İngilizce Kelimeler Taranıyor...</span>
          </div>
          <button class="lingo-close-btn" id="lingo-close-ocr-btn" title="Kapat">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        <div class="lingo-ocr-body">
          <div class="lingo-ocr-preview-container">
            <img class="lingo-ocr-preview-img" src="${escapeHtml(imageUrl)}" alt="Taranan Resim" />
          </div>
          <div class="lingo-loading" style="padding: 24px 0;">
            <div class="lingo-spinner"></div>
            <span id="lingo-ocr-progress-text">Resim taranıyor ve kelimeler çözümleniyor...</span>
          </div>
        </div>
      </div>
    `;

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeOcrModal();
    });

    const closeBtn = backdrop.querySelector('#lingo-close-ocr-btn');
    closeBtn.addEventListener('click', () => closeOcrModal());

    document.body.appendChild(backdrop);
    activeOcrModal = backdrop;
  }

  function updateOcrProgress(percent) {
    const textEl = document.getElementById('lingo-ocr-progress-text');
    if (textEl) {
      textEl.textContent = `Resimdeki kelimeler okunuyor... %${percent}`;
    }
  }

  // OCR Başarılı Olduğunda Sonuçları Göster
  function renderOcrSuccessModal(imageUrl, extractedText, words, translation, meta = {}, confidence = 0) {
    if (!activeOcrModal) return;

    const modalBody = activeOcrModal.querySelector('.lingo-ocr-body');
    const headerTitle = activeOcrModal.querySelector('.lingo-ocr-title span');
    if (headerTitle) {
      headerTitle.textContent = `Resimde ${words.length} Kelime Bulundu`;
    }

    const origW = meta.originalWidth || meta.width || 0;
    const origH = meta.originalHeight || meta.height || 0;
    const procW = meta.processedWidth || origW;
    const procH = meta.processedHeight || origH;

    modalBody.innerHTML = `
      <div class="lingo-ocr-preview-container">
        <img class="lingo-ocr-preview-img" src="${escapeHtml(imageUrl)}" alt="Taranan Resim" />
      </div>

      <div class="lingo-ocr-meta-chips">
        <span class="lingo-ocr-meta-pill" title="Taranan Görsel Çözünürlüğü">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
          ${origW ? `${origW}×${origH} px` : 'Boyut Alındı'}
          ${meta.isScaled ? ` (Optimize: ${procW}×${procH})` : ''}
        </span>
        ${confidence > 0 ? `
          <span class="lingo-ocr-meta-pill success" title="OCR Doğruluk Skoru">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
            %${confidence} Doğruluk
          </span>
        ` : ''}
        <span class="lingo-ocr-meta-pill success" title="Ayrıştırılan Kelime Sayısı">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="9" x2="20" y2="9"></line><line x1="4" y1="15" x2="20" y2="15"></line><line x1="10" y1="3" x2="8" y2="21"></line><line x1="16" y1="3" x2="14" y2="21"></line></svg>
          ${words.length} Kelime
        </span>
      </div>

      <div class="lingo-ocr-words-box">
        <div class="lingo-ocr-words-title">
          <span>Bulunan İngilizce Kelimeler (Anlamına bakmak için tıklayın):</span>
          <span>${words.length} adet</span>
        </div>
        <div class="lingo-ocr-chips" id="lingo-ocr-chips-list">
          ${words.map(w => `<button class="lingo-ocr-chip" data-word="${escapeHtml(w)}">${escapeHtml(w)}</button>`).join('')}
        </div>
      </div>

      <div class="lingo-ocr-translation-box">
        <div class="lingo-ocr-trans-label">Türkçe Çevirisi:</div>
        <div class="lingo-ocr-trans-text">${escapeHtml(translation || 'Çeviri yapılamadı.')}</div>
      </div>

      ${confidence < 65 && !meta.isCropped ? `
        <div class="lingo-ocr-manga-tip">
          <span>💡 <strong>Manga/Çizgi Roman İpucu:</strong> Çizim hatları metne karıştıysa konuşma balonunu seçerek %95+ netlikle okutabilirsiniz.</span>
          <button class="lingo-ocr-manga-tip-btn" id="lingo-manga-crop-tip-btn">✂️ Balon Seç</button>
        </div>
      ` : ''}

      <div class="lingo-footer" style="padding: 10px 0 0 0; background: transparent; border: none; flex-wrap: wrap; gap: 8px;">
        <button class="lingo-btn lingo-btn-save" id="lingo-ocr-speak-all-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
          </svg>
          <span>Metni Dinle</span>
        </button>
        <button class="lingo-btn lingo-btn-copy" id="lingo-ocr-copy-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
          <span>Çeviriyi Kopyala</span>
        </button>
        <button class="lingo-btn" id="lingo-ocr-crop-again-btn" style="background:#eef2ff; color:#4f46e5; border-color:#c7d2fe; font-weight:600;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <circle cx="6" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle>
            <line x1="20" y1="4" x2="8.12" y2="15.88"></line><line x1="14.47" y1="14.48" x2="20" y2="20"></line><line x1="8.12" y1="8.12" x2="12" y2="12"></line>
          </svg>
          <span>${meta.isCropped ? 'Başka Balon Seç' : '✂️ Balon / Alan Seç'}</span>
        </button>
      </div>
    `;

    // Kelime çiplerine tıklanıldığında doğrudan anlam kartını aç
    modalBody.querySelectorAll('.lingo-ocr-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        const word = chip.dataset.word;
        const rect = chip.getBoundingClientRect();
        const coords = calculatePosition(rect);
        currentSelectionText = word;
        currentContextSentence = extractedText;
        initShadowDOM();
        openTranslationCard(word, coords);
      });
    });

    // Metni seslendir
    const speakBtn = modalBody.querySelector('#lingo-ocr-speak-all-btn');
    if (speakBtn) {
      speakBtn.addEventListener('click', () => speakText(extractedText));
    }

    // Kopyala butonu
    const copyBtn = modalBody.querySelector('#lingo-ocr-copy-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(translation).then(() => {
          const span = copyBtn.querySelector('span');
          const orig = span.textContent;
          span.textContent = 'Kopyalandı!';
          setTimeout(() => { span.textContent = orig; }, 1500);
        });
      });
    }

    // Balon Seç butonu
    const cropAgainBtn = modalBody.querySelector('#lingo-ocr-crop-again-btn');
    if (cropAgainBtn) {
      cropAgainBtn.addEventListener('click', () => {
        closeOcrModal();
        if (lastTargetImg) {
          try { lastTargetImg.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
          setTimeout(() => { startImageCropper(lastTargetImg); }, 180);
        }
      });
    }

    const mangaTipBtn = modalBody.querySelector('#lingo-manga-crop-tip-btn');
    if (mangaTipBtn) {
      mangaTipBtn.addEventListener('click', () => {
        closeOcrModal();
        if (lastTargetImg) {
          try { lastTargetImg.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
          setTimeout(() => { startImageCropper(lastTargetImg); }, 180);
        }
      });
    }
  }

  // Metin Bulunamadığında
  function renderOcrEmptyModal(imageUrl, meta = {}) {
    if (!activeOcrModal) return;
    const modalBody = activeOcrModal.querySelector('.lingo-ocr-body');
    const headerTitle = activeOcrModal.querySelector('.lingo-ocr-title span');
    if (headerTitle) {
      headerTitle.textContent = 'İngilizce Metin Bulunamadı';
    }

    const origW = meta.originalWidth || meta.width || 0;
    const origH = meta.originalHeight || meta.height || 0;

    let sizeNote = 'Görsel boyutu normal standartlarda.';
    if (origW > 0 && origW < 350) {
      sizeNote = 'Görsel çözünürlüğü oldukça küçük (<350px). Harfler düşük çözünürlükten ötürü Tesseract OCR tarafından seçilememiş olabilir.';
    } else if (origW > 2000 || origH > 2000) {
      sizeNote = 'Görsel çok geniş (>2000px). Yazılar görselin genel alanına oranla çok küçük veya ince kalmış olabilir.';
    }

    modalBody.innerHTML = `
      <div class="lingo-ocr-preview-container">
        <img class="lingo-ocr-preview-img" src="${escapeHtml(imageUrl)}" alt="Taranan Resim" />
      </div>

      <div class="lingo-ocr-error-banner" style="background:#fffbeb; border-color:#fef3c7; border-left-color:#f59e0b;">
        <div class="lingo-ocr-error-title" style="color:#b45309;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          Görselde Okunabilir İngilizce Harf / Kelime Tespit Edilemedi
        </div>
        <div class="lingo-ocr-error-desc" style="color:#92400e;">
          Tesseract OCR motoru görseli taradı ancak Latin harflerinden oluşan belirgin bir İngilizce kelime ayrıştıramadı.
        </div>
      </div>

      <div class="lingo-ocr-diagnostic-box">
        <div class="lingo-ocr-diag-row">
          <span class="lingo-ocr-diag-label">Taranan Görsel Boyutu:</span>
          <span class="lingo-ocr-diag-val">${origW ? `${origW} × ${origH} px` : 'Ölçülemedi'}</span>
        </div>
        <div class="lingo-ocr-diag-row">
          <span class="lingo-ocr-diag-label">Boyut Etkisi Analizi:</span>
          <span class="lingo-ocr-diag-val" style="font-size:11.5px; font-weight:normal; max-width:65%; text-align:right;">${sizeNote}</span>
        </div>
        <div class="lingo-ocr-diag-row">
          <span class="lingo-ocr-diag-label">Tarama Modu:</span>
          <span class="lingo-ocr-diag-val">İngilizce Sözlük Modeli (eng.traineddata)</span>
        </div>
      </div>

      <div class="lingo-ocr-hint-box">
        <strong>💡 Olası Nedenler & Tavsiyeler:</strong>
        <ul style="margin: 4px 0 0 16px; padding: 0;">
          <li>Yazı rengi ile arka plan rengi birbirine çok yakın (düşük kontrast) olabilir.</li>
          <li>Yazı tipi el yazısı (cursive), gotik veya aşırı stilize bir logo olabilir.</li>
          <li>Görsel çok küçükse sayfayı <code>Ctrl + +</code> ile yakınlaştırıp resmi büyüttükten sonra tekrar deneyin.</li>
        </ul>
      </div>

      <div class="lingo-ocr-actions">
        <button class="lingo-ocr-action-btn primary" id="lingo-ocr-retry-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
          Tekrar Dene
        </button>
        <button class="lingo-ocr-action-btn" id="lingo-ocr-empty-crop-btn" style="background:#eef2ff; color:#4f46e5; border-color:#c7d2fe;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="6" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><line x1="20" y1="4" x2="8.12" y2="15.88"></line><line x1="14.47" y1="14.48" x2="20" y2="20"></line><line x1="8.12" y1="8.12" x2="12" y2="12"></line></svg>
          ✂️ Balon / Alan Seç
        </button>
        <button class="lingo-ocr-action-btn" id="lingo-ocr-dismiss-btn">Kapat</button>
      </div>
    `;

    const emptyCropBtn = modalBody.querySelector('#lingo-ocr-empty-crop-btn');
    if (emptyCropBtn) {
      emptyCropBtn.addEventListener('click', () => {
        closeOcrModal();
        if (lastTargetImg) {
          try { lastTargetImg.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
          setTimeout(() => { startImageCropper(lastTargetImg); }, 180);
        }
      });
    }

    const retryBtn = modalBody.querySelector('#lingo-ocr-retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        startImageOCR(imageUrl);
      });
    }

    const dismissBtn = modalBody.querySelector('#lingo-ocr-dismiss-btn');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', closeOcrModal);
    }
  }

  // Hata Durumu
  function renderOcrErrorModal(imageUrl, errorMsg, meta = {}, details = null) {
    if (!activeOcrModal) return;
    const modalBody = activeOcrModal.querySelector('.lingo-ocr-body');
    const headerTitle = activeOcrModal.querySelector('.lingo-ocr-title span');
    if (headerTitle) {
      headerTitle.textContent = 'Görsel İşlenirken Hata Oluştu';
    }

    const origW = meta.originalWidth || meta.width || 0;
    const origH = meta.originalHeight || meta.height || 0;
    const isLocalFile = imageUrl && imageUrl.startsWith('file://');

    modalBody.innerHTML = `
      <div class="lingo-ocr-preview-container">
        <img class="lingo-ocr-preview-img" src="${escapeHtml(imageUrl)}" alt="Taranan Resim" />
      </div>

      <div class="lingo-ocr-error-banner">
        <div class="lingo-ocr-error-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          Hata Sebebi / Nedeni:
        </div>
        <div class="lingo-ocr-error-desc">
          ${escapeHtml(errorMsg || 'Bilinmeyen bir hata oluştu.')}
        </div>
      </div>

      <div class="lingo-ocr-diagnostic-box">
        <div class="lingo-ocr-diag-row">
          <span class="lingo-ocr-diag-label">Görsel Çözünürlüğü:</span>
          <span class="lingo-ocr-diag-val">${origW ? `${origW} × ${origH} px` : 'Ölçülemedi (Erişim kısıtı)'}</span>
        </div>
        <div class="lingo-ocr-diag-row">
          <span class="lingo-ocr-diag-label">Boyut Durumu:</span>
          <span class="lingo-ocr-diag-val" style="font-size:11.5px; font-weight:normal; max-width:65%; text-align:right;">
            ${origW > 2500 || origH > 2500 ? '⚠️ Aşırı büyük görsel (>2500px), otomatik ölçekleme uygulandı.' : origW < 300 && origW > 0 ? '⚠️ Düşük çözünürlüklü küçük görsel.' : 'Normal boyut.'}
          </span>
        </div>
        <div class="lingo-ocr-diag-row">
          <span class="lingo-ocr-diag-label">Görsel Kaynağı:</span>
          <span class="lingo-ocr-diag-val">${isLocalFile ? 'Yerel Dosya (file://)' : 'Web Sitesi Görseli'}</span>
        </div>
        <div class="lingo-ocr-diag-row">
          <span class="lingo-ocr-diag-label">OCR Motoru:</span>
          <span class="lingo-ocr-diag-val">Yerel Tesseract v5 (WebAssembly LSTM)</span>
        </div>
      </div>

      <div class="lingo-ocr-hint-box">
        <strong>🔧 Çözüm Adımları:</strong>
        <ul style="margin: 4px 0 0 16px; padding: 0;">
          ${isLocalFile ? `
            <li><strong>Yerel Dosya İzni:</strong> Bilgisayarınızdan açtığınız dosyalarda görsel okuyabilmek için <code>chrome://extensions</code> sayfasında LingoLearn kartında <em>"Ayrıntılar"</em>a tıklayıp <strong>"Dosya URL'lerine erişime izin ver"</strong> ayarını açmalısınız.</li>
          ` : `
            <li>Görsel harici sunucularda korunuyor veya CORS kısıtlamasına sahip olabilir. Resme sağ tıklayıp <em>"Resmi yeni sekmede aç"</em> diyerek görselin doğrudan sekmesinde tekrar okutmayı deneyebilirsiniz.</li>
          `}
          <li>Sayfayı yenileyip tekrar deneyebilirsiniz.</li>
        </ul>
      </div>

      <div class="lingo-ocr-actions">
        <button class="lingo-ocr-action-btn primary" id="lingo-ocr-retry-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
          Yeniden Dene
        </button>
        <button class="lingo-ocr-action-btn" id="lingo-ocr-err-crop-btn" style="background:#eef2ff; color:#4f46e5; border-color:#c7d2fe;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="6" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><line x1="20" y1="4" x2="8.12" y2="15.88"></line><line x1="14.47" y1="14.48" x2="20" y2="20"></line><line x1="8.12" y1="8.12" x2="12" y2="12"></line></svg>
          ✂️ Balon / Alan Seç
        </button>
        <button class="lingo-ocr-action-btn" id="lingo-ocr-copy-err-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          <span>Hatayı Kopyala</span>
        </button>
        <button class="lingo-ocr-action-btn" id="lingo-ocr-dismiss-btn">Kapat</button>
      </div>
    `;

    const errCropBtn = modalBody.querySelector('#lingo-ocr-err-crop-btn');
    if (errCropBtn) {
      errCropBtn.addEventListener('click', () => {
        closeOcrModal();
        if (lastTargetImg) {
          try { lastTargetImg.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
          setTimeout(() => { startImageCropper(lastTargetImg); }, 180);
        }
      });
    }

    const retryBtn = modalBody.querySelector('#lingo-ocr-retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        startImageOCR(imageUrl);
      });
    }

    const dismissBtn = modalBody.querySelector('#lingo-ocr-dismiss-btn');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', closeOcrModal);
    }

    const copyBtn = modalBody.querySelector('#lingo-ocr-copy-err-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        const errReport = `[LingoLearn OCR Hatası]\nHata: ${errorMsg}\nBoyut: ${origW}x${origH} px\nKaynak: ${imageUrl}\nDetay: ${details || 'Yok'}`;
        navigator.clipboard.writeText(errReport).then(() => {
          const span = copyBtn.querySelector('span');
          span.textContent = 'Kopyalandı!';
          setTimeout(() => { span.textContent = 'Hatayı Kopyala'; }, 1500);
        });
      });
    }
  }

  function closeOcrModal() {
    if (activeOcrModal && activeOcrModal.parentNode) {
      activeOcrModal.parentNode.removeChild(activeOcrModal);
    }
    activeOcrModal = null;
  }

  // ==========================================
  // 3. SHADOW DOM VE KART ARAYÜZÜ
  // ==========================================
  function initShadowDOM() {
    if (rootElement) return;

    rootElement = document.createElement('div');
    rootElement.id = 'lingolearn-extension-root';
    document.body.appendChild(rootElement);

    shadowRoot = rootElement.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      }

      /* Çeviri Tetikleme Butonu (Floating Badge) */
      .lingo-badge {
        position: absolute;
        pointer-events: auto;
        display: flex;
        align-items: center;
        gap: 6px;
        background: linear-gradient(135deg, #4f46e5, #7c3aed);
        color: #ffffff;
        padding: 6px 12px;
        border-radius: 20px;
        box-shadow: 0 4px 14px rgba(79, 70, 229, 0.45);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        z-index: 2147483647;
        transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s ease;
        animation: lingoPopIn 0.2s ease-out;
        user-select: none;
      }

      .lingo-badge:hover {
        transform: translateY(-2px) scale(1.05);
        box-shadow: 0 6px 20px rgba(79, 70, 229, 0.6);
      }

      .lingo-badge svg {
        width: 15px;
        height: 15px;
        fill: currentColor;
      }

      /* Ana Anlam & Çeviri Kartı */
      .lingo-card {
        position: absolute;
        pointer-events: auto;
        width: 330px;
        max-width: 92vw;
        background: #ffffff;
        border-radius: 16px;
        box-shadow: 0 16px 40px rgba(15, 23, 42, 0.2), 0 4px 12px rgba(15, 23, 42, 0.08);
        border: 1px solid rgba(226, 232, 240, 0.9);
        overflow: hidden;
        z-index: 2147483647;
        animation: lingoFadeInUp 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        color: #0f172a;
        line-height: 1.45;
      }

      /* Kart Başlığı */
      .lingo-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: #f8fafc;
        padding: 10px 14px;
        border-bottom: 1px solid #e2e8f0;
        cursor: grab;
        user-select: none;
      }

      .lingo-header:active {
        cursor: grabbing;
      }

      .lingo-brand {
        display: flex;
        align-items: center;
        gap: 6px;
        font-weight: 700;
        font-size: 13px;
        color: #4f46e5;
      }

      .lingo-lang-tag {
        font-size: 10px;
        background: #e0e7ff;
        color: #4338ca;
        padding: 2px 7px;
        border-radius: 6px;
        font-weight: 700;
        text-transform: uppercase;
      }

      .lingo-close-btn {
        background: none;
        border: none;
        cursor: pointer;
        color: #94a3b8;
        padding: 4px;
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: color 0.15s, background 0.15s;
      }

      .lingo-close-btn:hover {
        color: #334155;
        background: #e2e8f0;
      }

      /* Kart İçeriği */
      .lingo-body {
        padding: 14px;
        max-height: 390px;
        overflow-y: auto;
      }

      /* Yükleniyor Göstergesi */
      .lingo-loading {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 28px 0;
        color: #64748b;
        font-size: 13px;
        font-weight: 500;
      }

      .lingo-spinner {
        width: 22px;
        height: 22px;
        border: 2.5px solid #e2e8f0;
        border-top-color: #4f46e5;
        border-radius: 50%;
        animation: lingoSpin 0.7s linear infinite;
      }

      /* Orijinal Kelime Alanı */
      .lingo-original-box {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 10px;
      }

      .lingo-word-container {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .lingo-word-title {
        font-size: 18px;
        font-weight: 800;
        color: #1e1b4b;
        word-break: break-word;
      }

      .lingo-phonetic {
        font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
        font-size: 12px;
        color: #6366f1;
        font-weight: 600;
        letter-spacing: 0.5px;
      }

      .lingo-audio-btn {
        background: #eef2ff;
        border: 1px solid #c7d2fe;
        color: #4f46e5;
        cursor: pointer;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        transition: all 0.15s ease;
      }

      .lingo-audio-btn:hover {
        background: #4f46e5;
        color: #ffffff;
        transform: scale(1.1);
      }

      /* Türkçe Çeviri / Anlam Kutusu */
      .lingo-translated-box {
        background: linear-gradient(135deg, #f8fafc, #f1f5f9);
        border-left: 3.5px solid #4f46e5;
        padding: 10px 14px;
        border-radius: 0 10px 10px 0;
        margin-bottom: 12px;
      }

      .lingo-trans-label {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        color: #6366f1;
        margin-bottom: 2px;
      }

      .lingo-translated-text {
        font-size: 16px;
        font-weight: 700;
        color: #0f172a;
        word-break: break-word;
      }

      /* Sözlük Detayları (İsim, Fiil, Sıfat Anlamları) */
      .lingo-dict-section {
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px dashed #cbd5e1;
      }

      .lingo-dict-title {
        font-size: 11px;
        font-weight: 700;
        color: #64748b;
        text-transform: uppercase;
        margin-bottom: 8px;
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .lingo-dict-item {
        margin-bottom: 8px;
      }

      .lingo-dict-pos {
        display: inline-block;
        font-size: 11px;
        font-weight: 700;
        color: #4f46e5;
        background: #e0e7ff;
        padding: 2px 7px;
        border-radius: 4px;
        margin-bottom: 4px;
      }

      .lingo-meanings-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
      }

      .lingo-meaning-chip {
        background: #f1f5f9;
        color: #334155;
        padding: 3px 8px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 500;
        border: 1px solid #e2e8f0;
      }

      /* Cümle İçi Kullanım (Context) */
      .lingo-context-box {
        margin-top: 10px;
        font-size: 11px;
        color: #475569;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        padding: 8px 10px;
        border-radius: 8px;
      }

      .lingo-context-label {
        font-weight: 700;
        color: #64748b;
        display: block;
        margin-bottom: 2px;
      }

      /* Alt Butonlar */
      .lingo-footer {
        display: flex;
        gap: 8px;
        padding: 10px 14px;
        background: #f8fafc;
        border-top: 1px solid #e2e8f0;
      }

      .lingo-btn {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 8px 12px;
        border-radius: 8px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s ease;
        border: none;
      }

      .lingo-btn-save {
        background: #4f46e5;
        color: #ffffff;
      }

      .lingo-btn-save:hover {
        background: #4338ca;
      }

      .lingo-btn-save.saved {
        background: #10b981;
        color: #ffffff;
      }

      .lingo-btn-copy {
        background: #ffffff;
        color: #334155;
        border: 1px solid #cbd5e1;
      }

      .lingo-btn-copy:hover {
        background: #f1f5f9;
      }

      /* Animasyonlar */
      @keyframes lingoPopIn {
        from { opacity: 0; transform: scale(0.85); }
        to { opacity: 1; transform: scale(1); }
      }

      @keyframes lingoFadeInUp {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }

      @keyframes lingoSpin {
        to { transform: rotate(360deg); }
      }
    `;
    shadowRoot.appendChild(style);
  }

  // Cümle İçeriği Bulma (Context)
  function getSurroundingSentence(selection) {
    if (!selection || !selection.anchorNode) return '';
    try {
      const fullText = selection.anchorNode.textContent || '';
      const selectedText = selection.toString().trim();
      const index = fullText.indexOf(selectedText);
      if (index === -1) return '';

      let start = fullText.lastIndexOf('.', index);
      if (start === -1) start = 0;
      else start += 1;

      let end = fullText.indexOf('.', index + selectedText.length);
      if (end === -1) end = fullText.length;
      else end += 1;

      const sentence = fullText.slice(start, end).trim();
      return sentence.length > selectedText.length && sentence.length < 250 ? sentence : '';
    } catch (e) {
      return '';
    }
  }

  // Tıklanan noktadaki kelimeyi tespit etme (Alt + Click için)
  function getWordAtPoint(x, y) {
    let range, textNode, offset;

    if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(x, y);
      if (!pos) return null;
      textNode = pos.offsetNode;
      offset = pos.offset;
    } else if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(x, y);
      if (!range) return null;
      textNode = range.startContainer;
      offset = range.startOffset;
    }

    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return null;

    const text = textNode.textContent;
    if (!text || offset < 0 || offset > text.length) return null;

    let start = offset;
    while (start > 0 && /[\w'-]/.test(text[start - 1])) {
      start--;
    }

    let end = offset;
    while (end < text.length && /[\w'-]/.test(text[end])) {
      end++;
    }

    const word = text.slice(start, end).trim();
    if (!word || word.length < 2) return null;

    const wordRange = document.createRange();
    wordRange.setStart(textNode, start);
    wordRange.setEnd(textNode, end);

    return { word, range: wordRange };
  }

  // ==========================================
  // 4. OLAY DİNLEYİCİLERİ
  // ==========================================
  document.addEventListener('mousedown', handleMouseDown);
  document.addEventListener('mouseup', handleMouseUp);
  document.addEventListener('click', handleClick);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      // Kırpma aracı açıksa ESC'i kırpma aracı kendi yönetir
      if (activeCropOverlay) return;
      removeElements();
      closeOcrModal();
    }
  });

  function handleMouseDown(e) {
    if (rootElement && e.composedPath().includes(rootElement)) return;
    if (e.target.closest && (
      e.target.closest('#lingo-scanner-pill') ||
      e.target.closest('.lingo-ocr-modal') ||
      e.target.closest('.lingo-img-badge') ||
      e.target.closest('.lingo-crop-overlay')
    )) return;
    removeElements();
  }

  // Tıklama Yönetimi: Otomatik Algılanan Kelime veya Alt+Tıklama
  function handleClick(e) {
    if (!settings.isEnabled) return;
    if (activeCropOverlay) return; // Kırpma aracı açıkken müdahale etme
    if (rootElement && e.composedPath().includes(rootElement)) return;
    if (e.target.closest && (e.target.closest('.lingo-ocr-modal') || e.target.closest('.lingo-img-badge'))) return;

    // 1. Sayfadaki otomatik algılanmış kelimeye tıklandı mı?
    const detectedSpan = e.target.closest ? e.target.closest('.lingo-detected-word') : null;
    if (detectedSpan) {
      e.preventDefault();
      e.stopPropagation();

      const word = detectedSpan.dataset.word || detectedSpan.textContent.trim();
      const rect = detectedSpan.getBoundingClientRect();
      const coords = calculatePosition(rect);

      currentSelectionText = word;
      currentContextSentence = detectedSpan.closest('p, li, article, blockquote, td')?.textContent?.trim() || '';

      initShadowDOM();
      openTranslationCard(word, coords);
      return;
    }

    // 2. Alt + Tıklama Algılama
    if (settings.altClickLookup && e.altKey) {
      const wordInfo = getWordAtPoint(e.clientX, e.clientY);
      if (wordInfo) {
        e.preventDefault();
        e.stopPropagation();

        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(wordInfo.range);

        currentSelectionText = wordInfo.word;
        currentContextSentence = getSurroundingSentence(selection);

        const rect = wordInfo.range.getBoundingClientRect();
        const coords = calculatePosition(rect);

        initShadowDOM();
        openTranslationCard(wordInfo.word, coords);
      }
    }
  }

  // Fare seçimi ve Çift Tıklama algılama
  function handleMouseUp(e) {
    if (!settings.isEnabled) return;
    if (activeCropOverlay) return; // Kırpma aracı açıkken müdahale etme
    if (rootElement && e.composedPath().includes(rootElement)) return;
    if (e.target.closest && (e.target.closest('#lingo-scanner-pill') || e.target.closest('.lingo-ocr-modal') || e.target.closest('.lingo-img-badge'))) return;

    const selection = window.getSelection();
    const text = selection ? selection.toString().trim() : '';

    if (!text || text.length === 0 || text.length > 800) {
      return;
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    currentSelectionText = text;
    currentContextSentence = getSurroundingSentence(selection);

    initShadowDOM();
    const coords = calculatePosition(rect);

    // Çift Tıklama algılandıysa (e.detail === 2)
    if (e.detail === 2 && settings.doubleClickLookup) {
      openTranslationCard(text, coords);
      return;
    }

    // Anında Çevir modu
    if (settings.triggerMode === 'instant') {
      openTranslationCard(text, coords);
    } else {
      showTranslateBadge(text, coords);
    }
  }

  // Pozisyon hesaplama
  function calculatePosition(rect) {
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;

    let top = rect.top + scrollY - 38;
    let left = rect.left + scrollX + (rect.width / 2);

    if (rect.top < 45) {
      top = rect.bottom + scrollY + 8;
    }

    return { top, left, clientRect: rect };
  }

  // Yüzen Rozet (Floating Badge)
  function showTranslateBadge(text, coords) {
    removeElements();

    const badge = document.createElement('div');
    badge.className = 'lingo-badge';
    badge.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0014.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/>
      </svg>
      <span>Anlamına Bak</span>
    `;

    badge.style.top = `${coords.top}px`;
    badge.style.left = `${coords.left}px`;
    badge.style.transform = 'translateX(-50%)';

    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      openTranslationCard(text, coords);
    });

    shadowRoot.appendChild(badge);
    activeBadge = badge;
  }

  // Çeviri & Anlam Kartını Aç
  function openTranslationCard(text, coords) {
    removeBadge();
    removeCard();

    const card = document.createElement('div');
    card.className = 'lingo-card';

    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;
    let cardTop = coords.clientRect.bottom + scrollY + 8;
    let cardLeft = coords.clientRect.left + scrollX;

    if (cardLeft + 340 > window.innerWidth + scrollX) {
      cardLeft = window.innerWidth + scrollX - 350;
    }
    if (cardLeft < 10) cardLeft = 10;

    card.style.top = `${cardTop}px`;
    card.style.left = `${cardLeft}px`;

    card.innerHTML = `
      <div class="lingo-header">
        <div class="lingo-brand">
          <span>LingoLearn</span>
          <span class="lingo-lang-tag">Kelime & Çeviri</span>
        </div>
        <button class="lingo-close-btn" title="Kapat">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
      <div class="lingo-body">
        <div class="lingo-loading">
          <div class="lingo-spinner"></div>
          <span>Anlamı aranıyor...</span>
        </div>
      </div>
    `;

    shadowRoot.appendChild(card);
    activeCard = card;

    const closeBtn = card.querySelector('.lingo-close-btn');
    closeBtn.addEventListener('click', () => removeElements());

    // ---- Kartı Başlıktan Tutarak Taşıma (Drag) ----
    const header = card.querySelector('.lingo-header');
    if (header) {
      let isDragging = false;
      let dragOffsetX = 0;
      let dragOffsetY = 0;

      header.addEventListener('mousedown', (e) => {
        // Kapatma butonuna tıklandıysa sürükleme başlatma
        if (e.target.closest('.lingo-close-btn')) return;
        if (e.button !== 0) return;

        isDragging = true;
        // Kart sayfaya göre absolute konumlanıyor, scrollX/Y dahil et
        const scrollX = window.scrollX || window.pageXOffset;
        const scrollY = window.scrollY || window.pageYOffset;
        const cardRect = card.getBoundingClientRect();
        dragOffsetX = e.clientX - cardRect.left;
        dragOffsetY = e.clientY - cardRect.top;

        // Sürükleme sırasında animasyonu kaldır
        card.style.animation = 'none';
        card.style.transition = 'none';
        header.style.cursor = 'grabbing';

        e.preventDefault();
        e.stopPropagation();
      });

      const onDragMove = (e) => {
        if (!isDragging || !activeCard) return;
        e.preventDefault();

        const scrollX = window.scrollX || window.pageXOffset;
        const scrollY = window.scrollY || window.pageYOffset;

        let newLeft = e.clientX - dragOffsetX + scrollX;
        let newTop  = e.clientY - dragOffsetY + scrollY;

        // Ekran sınırları içinde tut
        const cardW = card.offsetWidth || 330;
        const cardH = card.offsetHeight || 200;
        const maxLeft = scrollX + window.innerWidth - cardW - 8;
        const maxTop  = scrollY + window.innerHeight - 40;

        newLeft = Math.max(scrollX + 4, Math.min(newLeft, maxLeft));
        newTop  = Math.max(scrollY + 4, Math.min(newTop, maxTop));

        card.style.left = `${newLeft}px`;
        card.style.top  = `${newTop}px`;
      };

      const onDragEnd = () => {
        if (!isDragging) return;
        isDragging = false;
        if (header) header.style.cursor = 'grab';
      };

      // Dinleyicileri window üzerine bağla (kart dışına çıkıldığında da çalışsın)
      window.addEventListener('mousemove', onDragMove, { passive: false });
      window.addEventListener('mouseup', onDragEnd);

      // Kart silindiğinde dinleyicileri de temizle
      const origRemoveCard = removeCard;
      card._dragCleanup = () => {
        window.removeEventListener('mousemove', onDragMove);
        window.removeEventListener('mouseup', onDragEnd);
      };
    }
    // ---- Drag Sonu ----

    chrome.runtime.sendMessage(
      { action: 'TRANSLATE', text: text, targetLang: 'tr' },
      (response) => {
        if (!activeCard) return;

        if (!response || !response.success) {
          const body = card.querySelector('.lingo-body');
          body.innerHTML = `
            <div style="color: #ef4444; font-size: 13px; padding: 12px 0;">
              ${response ? response.error : 'Anlamı getirilemedi.'}
            </div>
          `;
          return;
        }

        renderCardContent(card, text, response);
      }
    );
  }

  // Kart İçeriğini Doldur
  function renderCardContent(card, originalText, result) {
    const body = card.querySelector('.lingo-body');
    const translatedText = result.translatedText;
    const dictionary = result.dictionary || [];
    const phonetic = result.phonetic || '';

    let dictHtml = '';
    if (dictionary.length > 0) {
      dictHtml = `
        <div class="lingo-dict-section">
          <div class="lingo-dict-title">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z"/>
            </svg>
            Kelime Türleri & Alternatifler
          </div>
          ${dictionary.map(item => `
            <div class="lingo-dict-item">
              <span class="lingo-dict-pos">${item.pos}</span>
              <div class="lingo-meanings-chips">
                ${item.meanings.map(m => `<span class="lingo-meaning-chip">${escapeHtml(m)}</span>`).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }

    let contextHtml = '';
    if (currentContextSentence) {
      contextHtml = `
        <div class="lingo-context-box">
          <span class="lingo-context-label">Metindeki Cümle:</span>
          <div>"${escapeHtml(currentContextSentence)}"</div>
        </div>
      `;
    }

    body.innerHTML = `
      <div class="lingo-original-box">
        <div class="lingo-word-container">
          <div class="lingo-word-title">${escapeHtml(originalText)}</div>
          ${phonetic ? `<div class="lingo-phonetic">/${escapeHtml(phonetic)}/</div>` : ''}
        </div>
        <button class="lingo-audio-btn" id="lingo-speak-btn" title="Telaffuzu Dinle">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
          </svg>
        </button>
      </div>

      <div class="lingo-translated-box">
        <div class="lingo-trans-label">Türkçe Anlamı</div>
        <div class="lingo-translated-text">${escapeHtml(translatedText)}</div>
      </div>

      ${dictHtml}
      ${contextHtml}

      <div class="lingo-footer">
        <button class="lingo-btn lingo-btn-save" id="lingo-save-word-btn">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
          </svg>
          <span class="save-label">Deftere Kaydet</span>
        </button>
        <button class="lingo-btn lingo-btn-copy" id="lingo-copy-btn">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
          <span>Kopyala</span>
        </button>
      </div>
    `;

    // Telaffuz Dinleme
    const speakBtn = body.querySelector('#lingo-speak-btn');
    speakBtn.addEventListener('click', () => speakText(originalText));

    if (settings.autoPronounce) {
      speakText(originalText);
    }

    // Kelimeyi Deftere Kaydetme
    const saveBtn = body.querySelector('#lingo-save-word-btn');
    saveBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage(
        {
          action: 'SAVE_WORD',
          wordData: {
            original: originalText,
            translated: translatedText,
            phonetic: phonetic,
            dictionary: dictionary,
            context: currentContextSentence,
            url: window.location.href,
            pageTitle: document.title
          }
        },
        (res) => {
          if (res && res.success) {
            saveBtn.classList.add('saved');
            saveBtn.querySelector('.save-label').textContent = '✓ Kaydedildi!';

            const cleanWord = originalText.trim().toLowerCase();
            document.querySelectorAll(`.lingo-detected-word[data-word]`).forEach(el => {
              if (el.dataset.word.toLowerCase() === cleanWord) {
                el.classList.add('lingo-saved');
                el.title = 'LingoLearn: Defterinizde Kayıtlı Kelime';
              }
            });
          }
        }
      );
    });

    // Kopyalama
    const copyBtn = body.querySelector('#lingo-copy-btn');
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(translatedText).then(() => {
        const span = copyBtn.querySelector('span');
        const origText = span.textContent;
        span.textContent = 'Kopyalandı!';
        setTimeout(() => {
          if (span) span.textContent = origText;
        }, 1500);
      });
    });
  }

  // Web Speech API ile Telaffuz
  function speakText(text) {
    if (!('speechSynthesis' in window)) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 0.88;

    const voices = window.speechSynthesis.getVoices();
    const enVoice = voices.find(v => v.lang.startsWith('en') && (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Samantha')));
    if (enVoice) {
      utterance.voice = enVoice;
    }

    window.speechSynthesis.speak(utterance);
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function removeBadge() {
    if (activeBadge && activeBadge.parentNode) {
      activeBadge.parentNode.removeChild(activeBadge);
    }
    activeBadge = null;
  }

  function removeCard() {
    if (activeCard) {
      // Sürükleme olay dinleyicilerini temizle
      if (typeof activeCard._dragCleanup === 'function') {
        activeCard._dragCleanup();
      }
      if (activeCard.parentNode) {
        activeCard.parentNode.removeChild(activeCard);
      }
    }
    activeCard = null;
  }

  function removeElements() {
    removeBadge();
    removeCard();
  }
})();
