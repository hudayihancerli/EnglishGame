import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  DeviceEventEmitter,
  KeyboardAvoidingView,
  Linking,
  NativeModules,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { GAME_HTML } from './src/game/bundledHtml';

const PUBLIC_BASE_URL = 'https://multi.hudayi.space';
const DEFAULT_SERVER_URL = 'wss://multi.hudayi.space';
const CURRENT_VERSION_CODE = 6;
const CURRENT_VERSION_NAME = '1.5';

const LANE_COLORS = ['#ef4444', '#3b82f6', '#f59e0b', '#a855f7'];
const COLOR_OPTIONS = [
  { hex: '#38bdf8', label: 'Mavi' },
  { hex: '#fb923c', label: 'Turuncu' },
  { hex: '#ec4899', label: 'Pembe' },
  { hex: '#4ade80', label: 'Yeşil' },
  { hex: '#a855f7', label: 'Mor' },
  { hex: '#facc15', label: 'Sarı' },
];

type Phase = 'JOIN' | 'LOBBY' | 'PLAYING' | 'FINISHED';

interface LobbyPlayer {
  id: string;
  name: string;
  color: string;
}

interface RankEntry {
  id: string;
  place: number;
  name: string;
  color: string;
  score: number;
  elapsedMs: number;
}

interface GameState {
  question: string;
  options: string[];
  questionNum: number;
  totalQuestions: number;
  speedMult: number;
  score: number;
  playerCount: number;
  feedback: { correct: boolean; text: string } | null;
}

interface UpdateInfo {
  versionCode: number;
  versionName: string;
  apkUrl: string;
}

function QuizRunnerScreen() {
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<any>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [phase, setPhase] = useState<Phase>('JOIN');
  const [roomCode, setRoomCode] = useState('1234');
  const [playerName, setPlayerName] = useState('');
  const [selectedColor, setSelectedColor] = useState(COLOR_OPTIONS[0].hex);
  const [joining, setJoining] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updatingPct, setUpdatingPct] = useState<number | null>(null);

  const [activeCode, setActiveCode] = useState('1234');
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [lobbyPlayers, setLobbyPlayers] = useState<LobbyPlayer[]>([]);
  const [rankings, setRankings] = useState<RankEntry[]>([]);
  const [finishSummary, setFinishSummary] = useState<{
    myScore: number;
    totalQuestions: number;
    elapsedMs: number;
    solo?: boolean;
  } | null>(null);

  const [gameState, setGameState] = useState<GameState>({
    question: 'Hazırlanıyor...',
    options: [],
    questionNum: 1,
    totalQuestions: 30,
    speedMult: 1.0,
    score: 0,
    playerCount: 1,
    feedback: null,
  });

  useEffect(() => {
    let mounted = true;
    const sub = DeviceEventEmitter.addListener('AppUpdaterProgress', (e) => {
      if (mounted && typeof e?.percent === 'number') {
        setUpdatingPct(e.percent);
      }
    });

    fetch(`${PUBLIC_BASE_URL}/version.json?t=${Date.now()}`)
      .then((res) => res.json())
      .then((data: UpdateInfo) => {
        if (mounted && data && data.versionCode > CURRENT_VERSION_CODE) {
          setUpdateInfo(data);
        }
      })
      .catch(() => {});

    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  const handleSelfUpdate = async (apkUrlOverride?: string) => {
    if (updatingPct !== null) return;
    const url = apkUrlOverride || updateInfo?.apkUrl || `${PUBLIC_BASE_URL}/app-release.apk`;
    const updater = NativeModules.AppUpdater;
    if (Platform.OS === 'android' && updater?.downloadAndInstall) {
      try {
        setErrorMsg(null);
        setUpdatingPct(0);
        await updater.downloadAndInstall(url);
        setUpdatingPct(null);
      } catch (err: any) {
        setUpdatingPct(null);
        setErrorMsg(err?.message || 'Güncelleme indirilemedi.');
      }
    } else {
      Linking.openURL(url).catch(() => {});
    }
  };

  const handleCheckAndUpdate = async () => {
    if (updatingPct !== null) return;
    try {
      setErrorMsg(null);
      const res = await fetch(`${PUBLIC_BASE_URL}/version.json?t=${Date.now()}`);
      const data: UpdateInfo = await res.json();
      if (data && data.versionCode > CURRENT_VERSION_CODE) {
        setUpdateInfo(data);
        await handleSelfUpdate(data.apkUrl);
      } else {
        setErrorMsg(`Uygulama güncel (v${CURRENT_VERSION_NAME})`);
      }
    } catch {
      setErrorMsg('Güncelleme sunucusuna ulaşılamadı.');
    }
  };

  const handleJoin = () => {
    setErrorMsg(null);
    setJoining(true);
    webViewRef.current?.postMessage(
      JSON.stringify({
        type: 'JOIN',
        serverUrl: DEFAULT_SERVER_URL,
        code: roomCode.trim() || '1234',
        name: playerName.trim() || 'Oyuncu',
        color: selectedColor,
      }),
    );
  };

  const handleSolo = () => {
    setErrorMsg(null);
    setActiveCode('SOLO');
    setRankings([]);
    setFinishSummary(null);
    webViewRef.current?.postMessage(
      JSON.stringify({ type: 'SOLO', color: selectedColor }),
    );
  };

  const handleStartGame = () => {
    webViewRef.current?.postMessage(JSON.stringify({ type: 'START_GAME' }));
  };

  const handleBackToLobby = () => {
    if (activeCode === 'SOLO') {
      setPhase('JOIN');
      setFinishSummary(null);
      return;
    }
    webViewRef.current?.postMessage(JSON.stringify({ type: 'BACK_TO_LOBBY' }));
  };

  const handleMessage = (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);

      if (data.type === 'LOBBY') {
        setJoining(false);
        setActiveCode(data.code || '1234');
        setMyPlayerId(data.myPlayerId || null);
        setLobbyPlayers(Array.isArray(data.players) ? data.players : []);
        setRankings([]);
        setFinishSummary(null);
        if (data.status !== 'PLAYING') {
          setPhase('LOBBY');
        }
        return;
      }

      if (data.type === 'ERROR') {
        setJoining(false);
        setErrorMsg(data.message || 'Bağlantı hatası');
        return;
      }

      if (data.type === 'GAME_STARTED') {
        setJoining(false);
        setFinishSummary(null);
        setRankings([]);
        setPhase('PLAYING');
        setGameState({
          question: data.question || '',
          options: Array.isArray(data.options) ? data.options : [],
          questionNum: data.questionNum ?? 1,
          totalQuestions: data.totalQuestions ?? 30,
          speedMult: data.speedMult ?? 1.0,
          score: data.score ?? 0,
          playerCount: data.playerCount ?? 1,
          feedback: null,
        });
        return;
      }

      if (data.type === 'RANKINGS') {
        setRankings(Array.isArray(data.rankings) ? data.rankings : []);
        if (data.myPlayerId) setMyPlayerId(data.myPlayerId);
        return;
      }

      if (data.type === 'FINISHED_WAIT') {
        setFinishSummary({
          myScore: data.myScore ?? 0,
          totalQuestions: data.totalQuestions ?? 30,
          elapsedMs: data.elapsedMs ?? 0,
          solo: Boolean(data.solo),
        });
        setPhase('FINISHED');
        return;
      }

      if (data.type === 'STATE') {
        if (data.feedback) {
          if (feedbackTimer.current) {
            clearTimeout(feedbackTimer.current);
          }
          feedbackTimer.current = setTimeout(() => {
            setGameState((prev) => ({ ...prev, feedback: null }));
          }, 1100);
        }

        setGameState((prev) => ({
          question: data.question || prev.question,
          options: Array.isArray(data.options) ? data.options : prev.options,
          questionNum: data.questionNum ?? prev.questionNum,
          totalQuestions: data.totalQuestions ?? prev.totalQuestions,
          speedMult: data.speedMult ?? prev.speedMult,
          score: data.score ?? prev.score,
          playerCount: data.playerCount ?? prev.playerCount,
          feedback: data.feedback ?? prev.feedback,
        }));
      }
    } catch {
      // Ignore malformed bridge messages
    }
  };

  const myRank = rankings.find((r) => r.id === myPlayerId);

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{ html: GAME_HTML }}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        onMessage={handleMessage}
        style={styles.webview}
      />

      {phase === 'JOIN' && (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.overlay}>
          <View style={styles.card}>
            <Text style={styles.title}>3D Kelime Koşusu</Text>
            <Text style={styles.subtitle}>
              30 soruyu ilk bitiren kazanır! (v{CURRENT_VERSION_NAME})
            </Text>

            {updateInfo && (
              <TouchableOpacity
                style={styles.updateBanner}
                onPress={() => handleSelfUpdate()}
                disabled={updatingPct !== null}
                activeOpacity={0.85}>
                <Text style={styles.updateBannerText}>
                  {updatingPct !== null
                    ? `Güncelleniyor... %${updatingPct}`
                    : `Yeni Güncelleme (v${updateInfo.versionName}) · GÜNCELLE`}
                </Text>
              </TouchableOpacity>
            )}

            <Text style={styles.inputLabel}>ODA KODU</Text>
            <TextInput
              value={roomCode}
              onChangeText={setRoomCode}
              placeholder="1234"
              placeholderTextColor="#64748b"
              autoCapitalize="characters"
              style={styles.codeInput}
            />

            <Text style={styles.inputLabel}>İSİM (İSTEĞE BAĞLI)</Text>
            <TextInput
              value={playerName}
              onChangeText={setPlayerName}
              placeholder="Örn: Ali"
              placeholderTextColor="#64748b"
              maxLength={14}
              style={styles.nameInput}
            />

            <Text style={styles.inputLabel}>KARAKTER RENGİ</Text>
            <View style={styles.colorRow}>
              {COLOR_OPTIONS.map((c) => {
                const active = selectedColor === c.hex;
                return (
                  <TouchableOpacity
                    key={c.hex}
                    onPress={() => setSelectedColor(c.hex)}
                    style={[
                      styles.colorDot,
                      { backgroundColor: c.hex },
                      active && styles.colorDotActive,
                    ]}
                  />
                );
              })}
            </View>

            {errorMsg && <Text style={styles.errorText}>{errorMsg}</Text>}

            <TouchableOpacity
              style={styles.primaryButton}
              onPress={handleJoin}
              disabled={joining}
              activeOpacity={0.85}>
              {joining ? (
                <ActivityIndicator color="#0f172a" />
              ) : (
                <Text style={styles.primaryButtonText}>ODAYA KATIL</Text>
              )}
            </TouchableOpacity>

            <View style={styles.bottomLinksRow}>
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={handleSolo}
                disabled={joining}>
                <Text style={styles.secondaryButtonText}>Tek Başına Oyna</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={handleCheckAndUpdate}
                disabled={updatingPct !== null}>
                <Text style={styles.updateLinkText}>
                  {updatingPct !== null ? `Güncelleniyor %${updatingPct}` : 'Güncelle'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      )}

      {phase === 'LOBBY' && (
        <View style={styles.overlay}>
          <View style={styles.card}>
            <Text style={styles.title}>Oda: {activeCode}</Text>
            <Text style={styles.subtitle}>
              Oyuncular ({lobbyPlayers.length}) · Herkes katılınca başlat!
            </Text>

            <View style={styles.playerList}>
              {lobbyPlayers.map((p) => (
                <View key={p.id} style={styles.playerRow}>
                  <View
                    style={[styles.playerDot, { backgroundColor: p.color }]}
                  />
                  <Text style={styles.playerName}>
                    {p.name} {p.id === myPlayerId ? '(Sen)' : ''}
                  </Text>
                </View>
              ))}
            </View>

            <TouchableOpacity
              style={styles.primaryButton}
              onPress={handleStartGame}
              activeOpacity={0.85}>
              <Text style={styles.primaryButtonText}>YARIŞI BAŞLAT</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => setPhase('JOIN')}>
              <Text style={styles.secondaryButtonText}>Geri Dön</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {phase === 'PLAYING' && (
        <>
          <View
            pointerEvents="none"
            style={[
              styles.hudTop,
              { paddingTop: Math.max(insets.top, 12) + 4 },
            ]}>
            <View style={styles.statsRow}>
              <View style={styles.statBadge}>
                <Text style={styles.statLabel}>SORU</Text>
                <Text style={styles.statValue}>
                  {gameState.questionNum}/{gameState.totalQuestions}
                </Text>
              </View>
              <View style={styles.statBadge}>
                <Text style={styles.statLabel}>HIZ</Text>
                <Text style={styles.statValue}>
                  {gameState.speedMult.toFixed(2)}x
                </Text>
              </View>
              <View style={styles.statBadge}>
                <Text style={styles.statLabel}>DOĞRU</Text>
                <Text style={styles.statValue}>{gameState.score}</Text>
              </View>
            </View>

            <View style={styles.questionCard}>
              <Text style={styles.questionText}>{gameState.question}</Text>
            </View>

            {gameState.options.length === 4 && (
              <View style={styles.optionsRow}>
                {gameState.options.map((opt, idx) => (
                  <View
                    key={idx}
                    style={[
                      styles.optionBox,
                      {
                        borderColor: LANE_COLORS[idx],
                        backgroundColor: `${LANE_COLORS[idx]}28`,
                      },
                    ]}>
                    <Text
                      style={styles.optionBoxText}
                      numberOfLines={2}
                      adjustsFontSizeToFit>
                      {opt}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {gameState.feedback && (
              <View
                style={[
                  styles.feedbackPill,
                  gameState.feedback.correct
                    ? styles.feedbackCorrect
                    : styles.feedbackWrong,
                ]}>
                <Text style={styles.feedbackText}>
                  {gameState.feedback.text}
                </Text>
              </View>
            )}
          </View>

          <View
            pointerEvents="none"
            style={[
              styles.hudBottom,
              { paddingBottom: Math.max(insets.bottom, 12) + 6 },
            ]}>
            <Text style={styles.hintText}>
              Şerit değiştirmek için sola/sağa kaydır veya dokun
            </Text>
          </View>
        </>
      )}

      {phase === 'FINISHED' && finishSummary && (
        <View style={styles.overlay}>
          <View style={styles.card}>
            <Text style={styles.winTitle}>
              {finishSummary.solo
                ? 'Yarış Tamamlandı!'
                : myRank
                ? `${myRank.place}. OLDUN!`
                : 'BİTİRDİN!'}
            </Text>
            <Text style={styles.subtitle}>
              Doğru: {finishSummary.myScore} / {finishSummary.totalQuestions} ·{' '}
              {(finishSummary.elapsedMs / 1000).toFixed(1)} sn
            </Text>

            {!finishSummary.solo && (
              <View style={styles.playerList}>
                <Text style={styles.rankHeader}>CANLI SIRALAMA</Text>
                {rankings.map((r) => (
                  <View key={r.id} style={styles.playerRow}>
                    <Text style={styles.rankPlace}>#{r.place}</Text>
                    <View
                      style={[styles.playerDot, { backgroundColor: r.color }]}
                    />
                    <Text style={styles.playerName}>
                      {r.name} {r.id === myPlayerId ? '(Sen)' : ''}
                    </Text>
                    <Text style={styles.rankScore}>
                      {r.score}D · {(r.elapsedMs / 1000).toFixed(1)}s
                    </Text>
                  </View>
                ))}
                {rankings.length < lobbyPlayers.length && (
                  <Text style={styles.waitingText}>
                    Diğer oyuncular bitiriyor...
                  </Text>
                )}
              </View>
            )}

            <TouchableOpacity
              style={styles.primaryButton}
              onPress={handleBackToLobby}
              activeOpacity={0.85}>
              <Text style={styles.primaryButtonText}>
                {finishSummary.solo ? 'ANA EKRAN' : 'LOBİYE DÖN'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      <QuizRunnerScreen />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b1020',
  },
  webview: {
    flex: 1,
    backgroundColor: '#0b1020',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(11, 16, 32, 0.78)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 22,
  },
  card: {
    width: '100%',
    maxWidth: 370,
    backgroundColor: 'rgba(15, 23, 42, 0.96)',
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(56, 189, 248, 0.55)',
    padding: 20,
  },
  title: {
    color: '#f8fafc',
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
  },
  winTitle: {
    color: '#4ade80',
    fontSize: 26,
    fontWeight: '900',
    textAlign: 'center',
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 5,
    marginBottom: 14,
  },
  updateBanner: {
    backgroundColor: '#22c55e',
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
    marginBottom: 12,
    alignItems: 'center',
  },
  updateBannerText: {
    color: '#052e16',
    fontSize: 13,
    fontWeight: '800',
  },
  inputLabel: {
    color: '#38bdf8',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 6,
    textAlign: 'center',
  },
  codeInput: {
    backgroundColor: '#0b1020',
    borderWidth: 1.5,
    borderColor: '#38bdf8',
    borderRadius: 12,
    color: '#f8fafc',
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 6,
    paddingVertical: 10,
    marginBottom: 12,
  },
  nameInput: {
    backgroundColor: '#0b1020',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    paddingVertical: 10,
    marginBottom: 14,
  },
  colorRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 16,
  },
  colorDot: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  colorDotActive: {
    borderColor: '#ffffff',
    transform: [{ scale: 1.15 }],
  },
  errorText: {
    color: '#f87171',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 10,
  },
  primaryButton: {
    backgroundColor: '#38bdf8',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#0f172a',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  bottomLinksRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  secondaryButton: {
    marginTop: 6,
    paddingVertical: 8,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '600',
  },
  updateLinkText: {
    color: '#38bdf8',
    fontSize: 13,
    fontWeight: '700',
  },
  playerList: {
    backgroundColor: '#0b1020',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 12,
    marginBottom: 16,
    gap: 8,
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  playerDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  playerName: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
  },
  rankHeader: {
    color: '#38bdf8',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  rankPlace: {
    color: '#facc15',
    fontSize: 15,
    fontWeight: '900',
    width: 28,
  },
  rankScore: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '700',
  },
  waitingText: {
    color: '#64748b',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 4,
  },
  hudTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  statsRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  statBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.45)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  statLabel: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  statValue: {
    color: '#38bdf8',
    fontSize: 14,
    fontWeight: '800',
  },
  questionCard: {
    width: '100%',
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    borderWidth: 1.5,
    borderColor: 'rgba(56, 189, 248, 0.6)',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  questionText: {
    color: '#f8fafc',
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 28,
  },
  optionsRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
    marginTop: 8,
  },
  optionBox: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 2,
    paddingHorizontal: 5,
    paddingVertical: 11,
    justifyContent: 'center',
    alignItems: 'center',
  },
  optionBoxText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
  },
  feedbackPill: {
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 999,
  },
  feedbackCorrect: {
    backgroundColor: 'rgba(34, 197, 94, 0.92)',
  },
  feedbackWrong: {
    backgroundColor: 'rgba(239, 68, 68, 0.92)',
  },
  feedbackText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  hudBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  hintText: {
    color: 'rgba(226, 232, 240, 0.65)',
    fontSize: 12,
    fontWeight: '500',
  },
});
