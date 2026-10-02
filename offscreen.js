// LingoLearn - Offscreen Document OCR Engine
let ocrWorker = null;
let initPromise = null;

async function getOrCreateWorker() {
  if (ocrWorker) return ocrWorker;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      if (typeof Tesseract === 'undefined') {
        throw new Error('Tesseract OCR kütüphanesi yüklenemedi. offscreen.html kontrol edilmelidir.');
      }

      const workerUrl = chrome.runtime.getURL('lib/worker.min.js');
      const coreUrl = chrome.runtime.getURL('lib/tesseract-core-simd-lstm.wasm.js');
      const langUrl = chrome.runtime.getURL('lib');

      const worker = await Tesseract.createWorker('eng', 1, {
        workerPath: workerUrl,
        corePath: coreUrl,
        langPath: langUrl,
        gzip: true,
        workerBlobURL: false, // Kritik: Manifest V3 CSP kuralı için doğrudan dosya yolu kullanılır
        logger: (m) => {
          if (m && m.status === 'recognizing text') {
            chrome.runtime.sendMessage({
              action: 'OCR_PROGRESS',
              progress: Math.round((m.progress || 0) * 100)
            }).catch(() => {});
          }
        }
      });

      ocrWorker = worker;
      return ocrWorker;
    } catch (err) {
      ocrWorker = null;
      throw err;
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

// Görseli OCR motoru için optimum boyut ve formata getirir (Kırpma alanı desteği dahil)
async function optimizeImageForOcr(source, cropArea = null) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Kritik Düzeltme: crossOrigin='anonymous' SADECE uzak http/https bağlantılarında ayarlanmalıdır.
    // data:, blob: veya file: şemalarında crossOrigin tanımlamak tarayıcıda doğrudan 'onerror' tetikler!
    if (typeof source === 'string' && (source.startsWith('http://') || source.startsWith('https://'))) {
      img.crossOrigin = 'anonymous';
    }

    img.onload = () => {
      const origW = img.naturalWidth || img.width || 0;
      const origH = img.naturalHeight || img.height || 0;

      if (origW === 0 || origH === 0) {
        return reject(new Error('Görsel boyutları geçersiz (0x0 px).'));
      }

      // Kullanıcı konuşma balonu veya özel bir alan seçmişse kırpma alanını hesapla
      let srcX = 0;
      let srcY = 0;
      let srcW = origW;
      let srcH = origH;
      let isCropped = false;

      if (cropArea && typeof cropArea === 'object' && cropArea.widthRatio > 0 && cropArea.heightRatio > 0) {
        srcX = Math.max(0, Math.min(origW - 1, Math.round(cropArea.xRatio * origW)));
        srcY = Math.max(0, Math.min(origH - 1, Math.round(cropArea.yRatio * origH)));
        srcW = Math.max(1, Math.min(origW - srcX, Math.round(cropArea.widthRatio * origW)));
        srcH = Math.max(1, Math.min(origH - srcY, Math.round(cropArea.heightRatio * origH)));
        isCropped = true;
      }

      const MAX_DIM = 1800; // OCR için ideal üst sınır (WebAssembly bellek taşmasını ve aşırı yavaşlamayı önler)
      const MIN_DIM = 350;  // Çok küçük görseller için alt sınır

      let targetW = srcW;
      let targetH = srcH;
      let isScaled = false;
      let scaleReason = isCropped ? 'Seçilen konuşma balonu kırpıldı.' : 'Orijinal boyut korundu.';

      if (srcW > MAX_DIM || srcH > MAX_DIM) {
        const ratio = Math.min(MAX_DIM / srcW, MAX_DIM / srcH);
        targetW = Math.max(1, Math.round(srcW * ratio));
        targetH = Math.max(1, Math.round(srcH * ratio));
        isScaled = true;
        scaleReason = `Görsel büyük olduğundan (${srcW}×${srcH} px), bellek taşmasını önlemek ve okuma hızını artırmak için ${targetW}×${targetH} px boyutuna optimize edildi.`;
      } else if (srcW < MIN_DIM && srcH < MIN_DIM) {
        targetW = srcW * 2;
        targetH = srcH * 2;
        isScaled = true;
        scaleReason = `Kırpılan alan küçük olduğundan (${srcW}×${srcH} px), harflerin net algılanabilmesi için 2 katına (${targetW}×${targetH} px) büyütüldü.`;
      }

      if (isScaled || isCropped) {
        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, targetW, targetH);
        resolve({
          element: canvas,
          metadata: {
            originalWidth: origW,
            originalHeight: origH,
            cropWidth: srcW,
            cropHeight: srcH,
            processedWidth: targetW,
            processedHeight: targetH,
            isScaled,
            isCropped,
            scaleReason
          }
        });
      } else {
        resolve({
          element: img,
          metadata: {
            originalWidth: origW,
            originalHeight: origH,
            processedWidth: origW,
            processedHeight: origH,
            isScaled: false,
            isCropped: false,
            scaleReason
          }
        });
      }
    };

    img.onerror = () => {
      reject(new Error('Görsel belleğe yüklenemedi. Format desteklenmiyor veya bağlantı engellenmiş olabilir.'));
    };

    img.src = source;
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.target === 'offscreen') {
    if (request.action === 'PING') {
      sendResponse({ success: true, pong: true });
      return false;
    }

    if (request.action === 'OFFSCREEN_PERFORM_OCR') {
      (async () => {
        try {
          if (!request.imageData) {
            throw new Error('OCR servisine boş görsel verisi iletildi.');
          }

          // 1. Görseli optimize et (Kırpma alanı varsa uygular, aşırı büyük görselleri küçültür, küçükleri büyütür)
          const { element, metadata } = await optimizeImageForOcr(request.imageData, request.cropArea || null);

          // 2. Tesseract Worker'ı al veya başlat
          const worker = await getOrCreateWorker();

          // 3. Karakter tanımayı çalıştır
          const result = await worker.recognize(element);
          const rawText = result && result.data && result.data.text ? result.data.text.trim() : '';

          // Yaygın 2 harfli İngilizce kelimeler (Çizim/tarama gürültülerini filtrelemek için)
          const VALID_2_LETTER_WORDS = new Set([
            'am', 'an', 'as', 'at', 'be', 'by', 'do', 'go', 'he', 'if', 'in', 'is', 'it', 'me', 'my', 'no', 'of', 'on', 'or', 'so', 'to', 'up', 'us', 'we'
          ]);

          let cleanedText = rawText;
          let filteredWordList = [];
          let totalConfidence = 0;
          let validWordCount = 0;

          if (result && result.data && Array.isArray(result.data.words) && result.data.words.length > 0) {
            const accepted = [];

            for (const w of result.data.words) {
              const rawW = (w.text || '').trim();
              if (!rawW) continue;
              const alphaOnly = rawW.replace(/[^a-zA-Z]/g, '');
              if (!alphaOnly) continue;

              // Tek harfli: Yalnızca 'I', 'a', 'A' kabul edilir
              if (alphaOnly.length === 1) {
                if (alphaOnly === 'I' || alphaOnly === 'a' || alphaOnly === 'A') {
                  accepted.push(rawW);
                  totalConfidence += w.confidence;
                  validWordCount++;
                }
                continue;
              }

              // 2 harfli: Gerçek İngilizce kelime mi? (fC, Lb, ae gibi çizim gürültülerini eler)
              if (alphaOnly.length === 2) {
                if (VALID_2_LETTER_WORDS.has(alphaOnly.toLowerCase()) && (w.confidence >= 45)) {
                  accepted.push(rawW);
                  totalConfidence += w.confidence;
                  validWordCount++;
                }
                continue;
              }

              // 3+ harfli: İngilizce kelimelerde mutlaka en az 1 sesli harf bulunur
              const hasVowel = /[aeiouyAEIOUY]/.test(alphaOnly);
              if (!hasVowel) continue; // Manga tarama çizgileri genelde sesli harf barındırmaz

              // Düşük güvenilirlikli gürültüleri filtrele
              if (w.confidence < 36) continue;

              accepted.push(rawW);
              totalConfidence += w.confidence;
              validWordCount++;
            }

            if (accepted.length > 0) {
              // Sembolden ve çizim artıklarından arındırılmış temiz metin
              cleanedText = accepted.join(' ')
                .replace(/[\\|~^_{}[\]`©¥€$@*#<>+=/]+/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();

              filteredWordList = accepted
                .map(w => w.replace(/[^a-zA-Z]/g, ''))
                .filter(w => w.length >= 2);
            }
          }

          // Çizim gürültüsü hariç tutulmuş gerçek metin güven skoru
          const confidence = validWordCount > 0
            ? Math.round(totalConfidence / validWordCount)
            : (result && result.data && typeof result.data.confidence === 'number' ? Math.round(result.data.confidence) : 0);

          sendResponse({
            success: true,
            text: cleanedText || rawText,
            rawText: rawText,
            words: filteredWordList,
            confidence: confidence,
            metadata: metadata
          });
        } catch (error) {
          console.error('[Offscreen OCR Error]:', error);
          sendResponse({
            success: false,
            error: error.message || error.toString(),
            details: error.stack || null
          });
        }
      })();
      return true; // Asenkron yanıt için
    }
  }
});
