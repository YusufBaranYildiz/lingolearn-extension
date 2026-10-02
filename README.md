# 🌟 LingoLearn - İngilizce Öğrenme & Çeviri Tarayıcı Eklentisi

Web sitelerinde gezinirken İngilizce öğrenmenizi kolaylaştıran, seçtiğiniz kelime ve cümleleri Türkçe'ye çeviren, doğru telaffuzunu seslendiren ve kendi kelime defterinize kaydedip pratik yapmanızı sağlayan modern bir **Manifest V3** tarayıcı eklentisidir.

> 🚧 **Aktif Geliştirme Aşamasında** — Sürekli güncellenmekte, yeni özellikler eklenmektedir.

---

## 🚀 Öne Çıkan Özellikler

1. **Otomatik Sayfa Taraması & Yabancı Kelimeleri Fark Etme**
   - Sayfadaki İngilizce kelimelerin altını kesikli mor çizgiyle işaretler
   - Temel bağlaçları (the, is, and vb.) filtreler
   - Kaydedilmiş kelimeler yeşil renkle vurgulanır

2. **📷 Resim OCR — Manga & Webtoon Desteği**
   - Resimlerdeki İngilizce metni [Tesseract.js](https://tesseract.projectnaptha.com/) ile okur
   - **✂️ Balon / Alan Seç:** Konuşma balonunu farenizle seçerek %95+ doğrulukla okur
   - CORS korumalı harici CDN resimlerinde de çalışır (Offscreen Document mimarisi)

3. **Akıllı Kelime Algılama**
   - Çift tıklama, Alt+tıklama, metin seçimi ile anlam kartı açılır
   - Kart başlığından tutarak istediğiniz yere taşınabilir

4. **Kapsamlı Sözlük & Fonetik Telaffuz**
   - IPA fonetik okunuş
   - İsim / Fiil / Sıfat türleri ve Türkçe anlamlar

5. **Doğal İngilizce Ses (Web Speech API)**
   - 🔊 butonu ile kelimenin telaffuzunu dinle

6. **Kişisel Kelime Defteri**
   - Kelimeleri bağlamıyla birlikte kaydet
   - "Öğrenildi" olarak işaretle
   - JSON olarak dışa aktar

7. **Flashcard Pratik Modu**
   - 3D kart çevirme yöntemiyle hafıza testi

---

## 🛠️ Kurulum (Chrome, Edge, Brave, Opera)

1. Bu repoyu klonlayın veya ZIP olarak indirin:
   ```bash
   git clone https://github.com/yusufbaran/lingolearn-extension.git
   ```

2. `lib/` klasörüne Tesseract OCR model dosyasını indirin:
   - [eng.traineddata.gz](https://github.com/naptha/tessdata_fast/raw/main/eng.traineddata.gz) → `lib/` klasörüne koyun

3. Tarayıcınızda `chrome://extensions` (veya `edge://extensions`) adresine gidin

4. **Geliştirici Modunu** açın

5. **"Paketlenmemiş öğe yükle"** → proje klasörünü seçin

---

## 📁 Proje Yapısı

```
lingolearn-extension/
├── manifest.json         # Manifest V3 yapılandırması
├── background.js         # Servis Worker (Çeviri API, Offscreen yönetimi)
├── offscreen.html        # Güvenli OCR çalışma belgesi
├── offscreen.js          # Tesseract.js WebAssembly OCR motoru
├── content/
│   ├── content.js        # Ana içerik scripti (Seçim, Kart, OCR, Sürükleme)
│   └── content.css       # Sayfa stilleri ve modal tasarımı
├── popup/
│   ├── popup.html        # Kelime defteri & ayarlar arayüzü
│   ├── popup.css         # Popup stilleri
│   └── popup.js          # Defter yönetimi, flashcard
├── lib/                  # Yerel Tesseract OCR kütüphanesi (traineddata hariç)
│   ├── tesseract.min.js
│   ├── worker.min.js
│   └── tesseract-core-simd-lstm.wasm.js
└── icons/                # Eklenti ikonları (16, 48, 128px)
```

---

## 🧰 Teknik Mimari

| Bileşen | Teknoloji |
|---------|-----------|
| Manifest Versiyonu | V3 |
| OCR Motoru | Tesseract.js v5 (WebAssembly LSTM) |
| OCR İzolasyonu | Chrome Offscreen Document API |
| Çeviri | Google Translate API (ücretsiz endpoint) |
| UI İzolasyonu | Shadow DOM |
| Depolama | `chrome.storage.local` |

---

## 🗺️ Yol Haritası (Roadmap)

- [ ] Firefox desteği (Manifest V2 uyumu)
- [ ] Çevrimiçi kelime senkronizasyonu
- [ ] Japonce / Korece OCR desteği
- [ ] Spaced Repetition (SM-2) algoritması ile akıllı pratik
- [ ] Sesli tanıma ile telaffuz değerlendirme

---

## 📄 Lisans

MIT License — Özgürce kullanabilir, geliştirebilir ve paylaşabilirsiniz.
