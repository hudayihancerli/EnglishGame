# QuizRunner3D 1.6 dağıtımı

Android paket adı `com.quizrunner3d`, sürüm adı `1.6`, sürüm kodu `7`. APK, mevcut yayındaki 1.5 gibi `arm64-v8a` cihazlar içindir.

Çok oyunculu zorluk seçimi sunucu güncellemesi gerektirir. Yeni APK tek başına kurulduğunda eski sunucudaki odalar Normal seviyede başlar.

1. Mevcut servis, ortam değişkenleri ve çalışma dizinini belirleyin. Proje Node.js 22.11 veya üzerini ve `ws` bağımlılığını kullanır. Servisi proje kökünden `node server/index.mjs` ile çalıştırın. Mevcut `PORT` ve `PUBLIC_BASE_URL` değerlerini kullanın.
2. Yayın paketindeki dosyaları sunucunun proje köküne aynı dizin yapısıyla kopyalayın. `server/index.mjs` oda sahibini ve ortak zorluğu yönetir. `src/game/settings.js` sunucunun zorluk ayarlarını okuması için gereklidir.
3. APK’yı `android/app/build/outputs/apk/release/app-release.apk` olarak yerleştirin. `android/app/build.gradle` dosyasını da güncelleyin. Sunucu `/version.json` yanıtındaki `versionCode` ve `versionName` değerlerini bu dosyadan okur. Yayın paketinde ikisi de doğru konumda bulunur.
4. Mevcut servis yöneticisinden Node.js sürecini yeniden başlatın. Odalar bellekte tutulduğu için yeniden başlatma sırasında açık odaların bağlantısı kesilir.
5. `https://multi.hudayi.space/version.json` yanıtında `versionCode: 7`, `versionName: "1.6"` ve indirilebilir `apkUrl` olduğunu doğrulayın. Güncelle düğmesi, kurulu uygulamanın sürüm kodunu bu JSON ile karşılaştırır. Sunucu daha yeni bir kod bildirirse APK’yı indirip Android kurulum ekranını açar.
6. İki güncel istemciyle aynı odaya girin. Oda sahibinin **Çılgın** seçimi diğer oyuncunun ekranına gelmeli ve yarış iki cihazda da aynı seviyede başlamalı.
