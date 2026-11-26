# Yarış ayarları ve tema paletleri

Varsayılan seçimler **Normal** ve **Gündüz**. Ayarlar yarış başlatma ekranında bulunur. Çok oyunculu lobide odaya ilk katılan oyuncu zorluğu seçer ve yarışı başlatır. Seçim anında tüm oyunculara gösterilir ve yarış boyunca geçerli kalır. Oda sahibi ayrılırsa yetki odada en uzun süredir bulunan oyuncuya geçer. Görünüm her oyuncunun kendi tercihidir.

| Zorluk | Başlangıç | Maksimum | Doğru cevap | Yanlış cevap |
| --- | --- | --- | --- | --- |
| Kolay | 1.0x | 1.8x | +0.06x | −0.16x |
| Normal | 1.0x | 2.0x | +0.08x | −0.18x |
| Çılgın | 1.0x | 2.4x | +0.12x | −0.22x |

Alt hız sınırı tüm modlarda 0.55x. Çılgın modu eski hızlı ayarı korur.

## Korunan gece paleti

3D renkler `src/game/settings.js` içindeki `WORLD_THEMES.night` nesnesinde, özgün arayüz stilleri `App.tsx` içindeki `nightStyles` nesnesinde tutulur. Gündüz stilleri bunların üzerine yazılmadan ayrı tanımlanır.

| Alan | Gece | Gündüz |
| --- | --- | --- |
| Gökyüzü | `#0b1020` | `#c8e8fa` |
| Yol | `#151c32` | `#b4bdc5` |
| Yol çizgileri | `#475569` | `#ffffff` |
| Yol kenarı | `#38bdf8` | `#52788a` |
| Ana panel | `#0f172a` | `#f0f7fc` |
| Ana yazı | `#f8fafc` | `#16324a` |

Güneş ve dokuz bulut parçası iki ek çizimle oluşturulur, gölge veya yeni ışık eklemez. Gece modunda gizlenir. Tema değişiminde çevre renkleri güncellenir; her karede yeni dekor oluşturulmaz.

Çok oyunculu zorluk ayarları için güncellenmiş `server/index.mjs` dosyasının da çalışan sunucuda yayınlanması gerekir. İstemci değişiklikleri sonrasında oyun paketi `npm run build:game` ile üretilir.
