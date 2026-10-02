// LingoLearn - Background Service Worker

// Eklenti ilk yüklendiğinde varsayılan ayarları kaydet ve sağ tık menüsünü oluştur
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['isEnabled', 'triggerMode', 'doubleClickLookup', 'autoScanWords', 'imageOcrEnabled', 'autoPronounce', 'words'], (result) => {
    const defaults = {};
    if (result.isEnabled === undefined) defaults.isEnabled = true;
    if (result.triggerMode === undefined) defaults.triggerMode = 'badge'; // 'badge' veya 'instant'
    if (result.doubleClickLookup === undefined) defaults.doubleClickLookup = true; // Çift tıklamayla anında anlam bak
    if (result.autoScanWords === undefined) defaults.autoScanWords = true; // Sayfadaki yabancı kelimeleri otomatik fark et ve vurgula
    if (result.imageOcrEnabled === undefined) defaults.imageOcrEnabled = true; // Resimlerdeki kelimeleri okuma modu
    if (result.autoPronounce === undefined) defaults.autoPronounce = false;
    if (!result.words) defaults.words = [];
    
    if (Object.keys(defaults).length > 0) {
      chrome.storage.local.set(defaults);
    }
  });

  // Sağ tık menüsü (Resim üzerindeki İngilizce metinleri okuma)
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'lingolearn-ocr-image',
      title: '📷 Resimdeki İngilizce Kelimeleri Oku (LingoLearn)',
      contexts: ['image']
    }, () => {
      if (chrome.runtime.lastError) {
        // Zaten varsa veya yeniden yüklemede hata vermesini engelle
      }
    });
  });
});

// Sağ tık menüsüne tıklandığında ilgili sekmeye haber ver
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'lingolearn-ocr-image' && tab && tab.id) {
    chrome.tabs.sendMessage(tab.id, {
      action: 'TRIGGER_IMAGE_OCR',
      srcUrl: info.srcUrl
    });
  }
});

let offscreenCreationPromise = null;

async function ensureOffscreenDocument() {
  const offscreenUrl = 'offscreen.html';

  if ('getContexts' in chrome.runtime) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL(offscreenUrl)]
    });
    if (contexts.length > 0) {
      return;
    }
  }

  if (offscreenCreationPromise) {
    await offscreenCreationPromise;
    return;
  }

  offscreenCreationPromise = (async () => {
    try {
      await chrome.offscreen.createDocument({
        url: offscreenUrl,
        reasons: ['WORKERS'],
        justification: 'Tesseract OCR text recognition'
      });
    } catch (err) {
      if (!err.message || !err.message.includes('Only a single offscreen document may be created')) {
        console.warn('Offscreen document creation notice:', err);
        throw err;
      }
    } finally {
      offscreenCreationPromise = null;
    }
  })();

  await offscreenCreationPromise;
}

async function sendToOffscreen(message, maxAttempts = 3) {
  await ensureOffscreenDocument();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (res) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(res);
          }
        });
      });
      if (response) return response;
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      await new Promise(r => setTimeout(r, 200));
    }
  }
  throw new Error('Offscreen OCR servisi yanıt vermedi.');
}

// Content script ve Popup'tan gelen istekleri dinle
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'OCR_PROGRESS') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0] && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, request).catch(() => {});
      }
    });
    return false;
  }

  if (request.action === 'START_IMAGE_OCR') {
    (async () => {
      try {
        const response = await sendToOffscreen({
          target: 'offscreen',
          action: 'OFFSCREEN_PERFORM_OCR',
          imageData: request.imageData,
          cropArea: request.cropArea || null
        });
        sendResponse(response || { success: false, error: 'OCR işleminden yanıt alınamadı.' });
      } catch (err) {
        sendResponse({ success: false, error: err.message || 'OCR başlatılamadı.' });
      }
    })();
    return true;
  }

  if (request.action === 'FETCH_IMAGE_BASE64') {
    fetchImageBase64(request.url)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'TRANSLATE') {
    handleTranslation(request.text, request.targetLang || 'tr')
      .then(response => sendResponse(response))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Asenkron yanıt için true döndürülür
  }

  if (request.action === 'SAVE_WORD') {
    handleSaveWord(request.wordData)
      .then(response => sendResponse(response))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'DELETE_WORD') {
    handleDeleteWord(request.id)
      .then(response => sendResponse(response))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'TOGGLE_MASTERED') {
    handleToggleMastered(request.id)
      .then(response => sendResponse(response))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

// Çeviri işlemi (Google Translate API)
async function handleTranslation(text, targetLang = 'tr') {
  if (!text || !text.trim()) {
    return { success: false, error: 'Boş metin gönderildi.' };
  }

  const cleanText = text.trim();
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&dt=bd&dt=rm&q=${encodeURIComponent(cleanText)}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Çeviri servisi yanıt vermedi (${response.status})`);
    }

    const data = await response.json();

    // 1. Ana çeviri metni ve fonetik okunuş
    let translatedText = '';
    let phonetic = '';

    if (data[0] && Array.isArray(data[0])) {
      translatedText = data[0]
        .filter(segment => segment && segment[0])
        .map(segment => segment[0])
        .join('');

      // Fonetik okunuş (IPA): data[0] segmentlerinde 3. indiste gelebilir
      const phoneticSegment = data[0].find(segment => segment && segment[3]);
      if (phoneticSegment && phoneticSegment[3]) {
        phonetic = phoneticSegment[3];
      }
    }

    // 2. Algılanan kaynak dil (örn: "en")
    const detectedLang = data[2] || 'auto';

    // 3. Kelime sözlük detayları (isim, fiil, sıfat ve alternatif anlamlar)
    const dictionary = [];
    if (data[1] && Array.isArray(data[1])) {
      data[1].forEach(item => {
        const pos = item[0]; // Part of speech (noun, verb, etc.)
        const meanings = item[1] || []; // Eş anlamlı / alternatif çeviriler
        dictionary.push({
          pos: translatePartOfSpeech(pos),
          meanings: meanings.slice(0, 6) // En yaygın ilk 6 anlamı al
        });
      });
    }

    return {
      success: true,
      originalText: cleanText,
      translatedText: translatedText || 'Çeviri bulunamadı.',
      phonetic: phonetic,
      detectedLang,
      dictionary
    };
  } catch (error) {
    console.error('Çeviri hatası:', error);
    return {
      success: false,
      error: 'Çeviri yapılırken bir hata oluştu: ' + error.message
    };
  }
}

// Kelime türlerini Türkçe'ye çevir
function translatePartOfSpeech(pos) {
  const map = {
    'noun': 'İsim',
    'verb': 'Fiil',
    'adjective': 'Sıfat',
    'adverb': 'Zarf',
    'pronoun': 'Zamir',
    'preposition': 'Edat',
    'conjunction': 'Bağlaç',
    'interjection': 'Ünlem'
  };
  return map[pos.toLowerCase()] || pos;
}

// Kelimeyi hafızaya / kelime defterine kaydet
async function handleSaveWord(wordData) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['words'], (result) => {
      let words = result.words || [];

      // Aynı orijinal kelime zaten kayıtlı mı kontrol et
      const existingIndex = words.findIndex(
        w => w.original.trim().toLowerCase() === wordData.original.trim().toLowerCase()
      );

      if (existingIndex !== -1) {
        // Zaten var, güncelle
        words[existingIndex] = {
          ...words[existingIndex],
          ...wordData,
          updatedAt: new Date().toISOString()
        };
      } else {
        // Yeni ekle
        words.unshift({
          id: Date.now().toString(),
          original: wordData.original,
          translated: wordData.translated,
          dictionary: wordData.dictionary || [],
          context: wordData.context || '',
          url: wordData.url || '',
          pageTitle: wordData.pageTitle || '',
          createdAt: new Date().toISOString(),
          mastered: false // Öğrenildi mi?
        });
      }

      chrome.storage.local.set({ words }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve({ success: true, count: words.length });
        }
      });
    });
  });
}

// Kelime defterinden kelime sil
async function handleDeleteWord(id) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['words'], (result) => {
      let words = result.words || [];
      words = words.filter(w => w.id !== id);

      chrome.storage.local.set({ words }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve({ success: true, count: words.length });
        }
      });
    });
  });
}

// Kelimenin "öğrenildi" durumunu değiştir
async function handleToggleMastered(id) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['words'], (result) => {
      let words = result.words || [];
      const word = words.find(w => w.id === id);
      if (word) {
        word.mastered = !word.mastered;
      }

      chrome.storage.local.set({ words }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve({ success: true, mastered: word ? word.mastered : false });
        }
      });
    });
  });
}

// Resim URL'ini indirip temiz base64 formatına çevir (CORS engellerini aşmak için)
async function fetchImageBase64(url) {
  if (!url) {
    return { success: false, error: 'Boş resim URL iletildi.' };
  }

  // Zaten Base64 formatındaysa doğrudan döndür
  if (url.startsWith('data:')) {
    return { success: true, dataUrl: url };
  }

  // Blob URL'leri arka plan servisinden doğrudan erişilemez, content script'te işlenir
  if (url.startsWith('blob:')) {
    return { success: false, error: 'Blob URL doğrudan web sayfası üzerinden okunmalıdır.' };
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Resim sunucudan indirilemedi (HTTP ${response.status})`);
    }

    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    const base64 = btoa(binary);
    const contentType = response.headers.get('content-type') || 'image/png';

    return {
      success: true,
      dataUrl: `data:${contentType};base64,${base64}`
    };
  } catch (error) {
    console.warn('Resim indirme uyarısı:', error.message);
    let userMsg = error.message;
    if (url.startsWith('file://')) {
      userMsg = 'Yerel dosya (file://) erişim izni kapalı. chrome://extensions sayfasında eklenti ayrıntılarında "Dosya URL\'lerine erişime izin ver" ayarını açmalısınız.';
    }
    return {
      success: false,
      error: userMsg
    };
  }
}
