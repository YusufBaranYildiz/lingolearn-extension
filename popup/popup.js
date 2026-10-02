// LingoLearn - Popup Script
document.addEventListener('DOMContentLoaded', () => {
  // DOM Elemanları
  const toggleActive = document.getElementById('toggle-active');
  const navTabs = document.querySelectorAll('.nav-tab');
  const tabContents = document.querySelectorAll('.tab-content');

  // Kelime Defteri Elemanları
  const wordList = document.getElementById('word-list');
  const emptyState = document.getElementById('empty-state');
  const searchInput = document.getElementById('search-input');
  const totalWordsCount = document.getElementById('total-words-count');
  const masteredWordsCount = document.getElementById('mastered-words-count');

  // Quiz Elemanları
  const quizContainer = document.getElementById('quiz-container');
  const quizEmptyState = document.getElementById('quiz-empty-state');
  const flashcard = document.getElementById('flashcard');
  const cardInner = document.getElementById('card-inner');
  const quizWord = document.getElementById('quiz-word');
  const quizPhonetic = document.getElementById('quiz-phonetic');
  const quizTranslation = document.getElementById('quiz-translation');
  const quizContext = document.getElementById('quiz-context');
  const quizSpeakBtn = document.getElementById('quiz-speak-btn');
  const btnNextQuiz = document.getElementById('btn-next-quiz');

  // Ayarlar Elemanları
  const triggerModeSelect = document.getElementById('trigger-mode-select');
  const toggleAutoscan = document.getElementById('toggle-autoscan');
  const toggleDoubleclick = document.getElementById('toggle-doubleclick');
  const toggleAltclick = document.getElementById('toggle-altclick');
  const toggleImageocr = document.getElementById('toggle-imageocr');
  const toggleAutopronounce = document.getElementById('toggle-autopronounce');
  const btnExportWords = document.getElementById('btn-export-words');
  const btnClearWords = document.getElementById('btn-clear-words');

  let allWords = [];
  let currentQuizWord = null;

  // 1. AYARLARI VE KELİMELERİ YÜKLE
  function init() {
    chrome.storage.local.get(
      ['isEnabled', 'triggerMode', 'doubleClickLookup', 'altClickLookup', 'autoScanWords', 'imageOcrEnabled', 'autoPronounce', 'words'],
      (res) => {
        // Toggle durumu
        if (res.isEnabled !== undefined) {
          toggleActive.checked = res.isEnabled;
        }
        // Tetikleme modu
        if (res.triggerMode) {
          triggerModeSelect.value = res.triggerMode;
        }
        // Sayfada otomatik algılama
        if (res.autoScanWords !== undefined && toggleAutoscan) {
          toggleAutoscan.checked = res.autoScanWords;
        }
        // Çift tıklamayla arama
        if (res.doubleClickLookup !== undefined && toggleDoubleclick) {
          toggleDoubleclick.checked = res.doubleClickLookup;
        }
        // Alt tıklamayla arama
        if (res.altClickLookup !== undefined && toggleAltclick) {
          toggleAltclick.checked = res.altClickLookup;
        }
        // Resimlerdeki kelimeleri okuma modu
        if (res.imageOcrEnabled !== undefined && toggleImageocr) {
          toggleImageocr.checked = res.imageOcrEnabled;
        }
        // Otomatik seslendirme
        if (res.autoPronounce !== undefined) {
          toggleAutopronounce.checked = res.autoPronounce;
        }

        // Kelimeler
        allWords = res.words || [];
        renderWordList(allWords);
        updateQuiz();
      }
    );
  }

  init();

  // 2. TAB DEĞİŞTİRME
  navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      navTabs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));

      tab.classList.add('active');
      const targetId = tab.getAttribute('data-tab');
      document.getElementById(targetId).classList.add('active');

      if (targetId === 'quiz-tab') {
        updateQuiz();
      }
    });
  });

  // 3. EKLENTİYİ AÇ/KAPAT
  toggleActive.addEventListener('change', () => {
    const isEnabled = toggleActive.checked;
    chrome.storage.local.set({ isEnabled });
  });

  // 4. KELİME LİSTESİNİ ÇİZ
  function renderWordList(words) {
    wordList.innerHTML = '';

    // İstatistikler
    totalWordsCount.textContent = words.length;
    const masteredCount = words.filter(w => w.mastered).length;
    masteredWordsCount.textContent = masteredCount;

    if (words.length === 0) {
      emptyState.style.display = 'flex';
      wordList.style.display = 'none';
      return;
    }

    emptyState.style.display = 'none';
    wordList.style.display = 'flex';

    words.forEach(word => {
      const card = document.createElement('div');
      card.className = `word-card ${word.mastered ? 'mastered' : ''}`;

      const dateFormatted = new Date(word.createdAt || Date.now()).toLocaleDateString('tr-TR', {
        day: 'numeric',
        month: 'short'
      });

      // Sözlük türleri özeti
      let dictSummaryHtml = '';
      if (word.dictionary && Array.isArray(word.dictionary) && word.dictionary.length > 0) {
        dictSummaryHtml = `
          <div style="font-size: 11px; color: #64748b; margin-top: 2px;">
            ${word.dictionary.map(d => `<span style="font-weight: 700; color: #4f46e5;">[${escapeHtml(d.pos)}]</span> ${d.meanings.slice(0, 3).map(escapeHtml).join(', ')}`).join(' &bull; ')}
          </div>
        `;
      }

      card.innerHTML = `
        <div class="word-header">
          <div class="word-english">
            <span>${escapeHtml(word.original)}</span>
            ${word.phonetic ? `<span class="word-phonetic">/${escapeHtml(word.phonetic)}/</span>` : ''}
          </div>
          <div class="word-actions">
            <button class="icon-btn-sm btn-speak" title="Telaffuz Dinle">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
              </svg>
            </button>
            <button class="icon-btn-sm icon-btn-delete btn-delete" title="Sil">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        </div>

        <div class="word-turkish">${escapeHtml(word.translated)}</div>

        ${dictSummaryHtml}

        ${word.context ? `<div class="word-context">"${escapeHtml(word.context)}"</div>` : ''}

        <div class="word-footer">
          <label class="mastered-badge" title="Öğrenildi olarak işaretle">
            <input type="checkbox" class="chk-mastered" ${word.mastered ? 'checked' : ''}>
            <span>${word.mastered ? 'Öğrenildi' : 'Öğreniliyor'}</span>
          </label>
          <span>${dateFormatted}</span>
        </div>
      `;

      // Telaffuz Butonu
      const btnSpeak = card.querySelector('.btn-speak');
      btnSpeak.addEventListener('click', (e) => {
        e.stopPropagation();
        speakText(word.original);
      });

      // Silme Butonu
      const btnDelete = card.querySelector('.btn-delete');
      btnDelete.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteWord(word.id);
      });

      // Öğrenildi Checkbox
      const chkMastered = card.querySelector('.chk-mastered');
      chkMastered.addEventListener('change', () => {
        toggleMastered(word.id);
      });

      wordList.appendChild(card);
    });
  }

  // 5. KELİME ARAMA
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();
    if (!query) {
      renderWordList(allWords);
      return;
    }

    const filtered = allWords.filter(w =>
      w.original.toLowerCase().includes(query) ||
      w.translated.toLowerCase().includes(query)
    );
    renderWordList(filtered);
  });

  // 6. KELİME SİLME
  function deleteWord(id) {
    chrome.runtime.sendMessage({ action: 'DELETE_WORD', id }, (res) => {
      if (res && res.success) {
        allWords = allWords.filter(w => w.id !== id);
        renderWordList(allWords);
        updateQuiz();
      }
    });
  }

  // 7. ÖĞRENİLDİ DURUMUNU DEĞİŞTİRME
  function toggleMastered(id) {
    chrome.runtime.sendMessage({ action: 'TOGGLE_MASTERED', id }, (res) => {
      if (res && res.success) {
        const item = allWords.find(w => w.id === id);
        if (item) {
          item.mastered = res.mastered;
          renderWordList(allWords);
        }
      }
    });
  }

  // 8. PRATİK / QUIZ YÖNETİMİ
  function updateQuiz() {
    if (allWords.length === 0) {
      quizContainer.style.display = 'none';
      quizEmptyState.style.display = 'flex';
      return;
    }

    quizContainer.style.display = 'flex';
    quizEmptyState.style.display = 'none';
    cardInner.classList.remove('flipped');

    // Rastgele bir kelime seç
    const randomIndex = Math.floor(Math.random() * allWords.length);
    currentQuizWord = allWords[randomIndex];

    quizWord.textContent = currentQuizWord.original;
    if (quizPhonetic) {
      quizPhonetic.textContent = currentQuizWord.phonetic ? `/${currentQuizWord.phonetic}/` : '';
    }
    quizTranslation.textContent = currentQuizWord.translated;
    quizContext.textContent = currentQuizWord.context ? `"${currentQuizWord.context}"` : '';
  }

  // Karta tıklandığında çevir
  flashcard.addEventListener('click', (e) => {
    if (e.target.closest('#quiz-speak-btn')) return;
    cardInner.classList.toggle('flipped');
  });

  // Quiz seslendir butonu
  quizSpeakBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (currentQuizWord) {
      speakText(currentQuizWord.original);
    }
  });

  // Sonraki kelime butonu
  btnNextQuiz.addEventListener('click', () => {
    updateQuiz();
  });

  // 9. AYARLAR DEĞİŞİKLİKLERİ
  triggerModeSelect.addEventListener('change', () => {
    chrome.storage.local.set({ triggerMode: triggerModeSelect.value });
  });

  if (toggleAutoscan) {
    toggleAutoscan.addEventListener('change', () => {
      chrome.storage.local.set({ autoScanWords: toggleAutoscan.checked });
    });
  }

  if (toggleDoubleclick) {
    toggleDoubleclick.addEventListener('change', () => {
      chrome.storage.local.set({ doubleClickLookup: toggleDoubleclick.checked });
    });
  }

  if (toggleAltclick) {
    toggleAltclick.addEventListener('change', () => {
      chrome.storage.local.set({ altClickLookup: toggleAltclick.checked });
    });
  }

  if (toggleImageocr) {
    toggleImageocr.addEventListener('change', () => {
      chrome.storage.local.set({ imageOcrEnabled: toggleImageocr.checked });
    });
  }

  toggleAutopronounce.addEventListener('change', () => {
    chrome.storage.local.set({ autoPronounce: toggleAutopronounce.checked });
  });

  // Kelimeleri JSON olarak Dışa Aktar
  btnExportWords.addEventListener('click', () => {
    if (allWords.length === 0) {
      alert('Dışa aktarılacak kayıtlı kelime bulunamadı.');
      return;
    }

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(allWords, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `lingolearn_kelimeler_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  });

  // Tüm Kelimeleri Temizle
  btnClearWords.addEventListener('click', () => {
    if (allWords.length === 0) return;

    if (confirm('Tüm kayıtlı kelimeleri silmek istediğinize emin misiniz?')) {
      chrome.storage.local.set({ words: [] }, () => {
        allWords = [];
        renderWordList(allWords);
        updateQuiz();
      });
    }
  });

  // 10. TELAFFUZ SESLENDİRME
  function speakText(text) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 0.88;
    window.speechSynthesis.speak(utterance);
  }

  // Güvenli metin kaçırma
  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
});
