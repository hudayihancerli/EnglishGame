import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  DeviceEventEmitter,
  KeyboardAvoidingView,
  Linking,
  NativeModules,
  Platform,
  ScrollView,
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
const CURRENT_VERSION_CODE = 7;
const CURRENT_VERSION_NAME = '1.6';

const LANE_COLORS = ['#ef4444', '#3b82f6', '#f59e0b', '#a855f7'];
const COLOR_OPTIONS = [
  { hex: '#38bdf8', label: 'Mavi' },
  { hex: '#fb923c', label: 'Turuncu' },
  { hex: '#ec4899', label: 'Pembe' },
  { hex: '#4ade80', label: 'Yeşil' },
  { hex: '#a855f7', label: 'Mor' },
  { hex: '#facc15', label: 'Sarı' },
];

type Phase = 'JOIN' | 'LOBBY' | 'SOLO_SETUP' | 'PLAYING' | 'FINISHED';
type Difficulty = 'easy' | 'normal' | 'crazy';
type Theme = 'day' | 'night';
const ThemeContext = React.createContext({
  theme: 'day' as Theme,
  setTheme: (_theme: Theme) => {},
});

function RaceSettings({ difficulty, onChange }: {
  difficulty: Difficulty;
  onChange?: (value: Difficulty) => void;
}) {
  const { theme, setTheme } = React.useContext(ThemeContext);
  const styles = theme === 'day' ? dayStyles : nightStyles;
  return (
    <View style={styles.raceSettings}>
      <Text style={styles.inputLabel}>ZORLUK</Text>
      <View style={styles.choiceRow}>
        {([
          ['easy', 'Kolay', '1.8x'],
          ['normal', 'Normal', '2.0x'],
          ['crazy', 'Çılgın', '2.4x'],
        ] as const).map(([value, label, cap]) => (
          <TouchableOpacity
            key={value}
            accessibilityRole="radio"
            accessibilityState={{ checked: difficulty === value, disabled: !onChange }}
            disabled={!onChange}
            onPress={() => onChange?.(value)}
            style={[styles.choiceButton, difficulty === value && styles.choiceSelected]}>
            <Text style={styles.choiceText}>{label}</Text>
            <Text style={styles.choiceCaption}>En fazla {cap}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.inputLabel}>GÖRÜNÜM</Text>
      <View style={styles.choiceRow}>
        {([['day', 'Gündüz'], ['night', 'Gece']] as const).map(([value, label]) => (
          <TouchableOpacity
            key={value}
            accessibilityRole="radio"
            accessibilityState={{ checked: theme === value }}
            onPress={() => setTheme(value)}
            style={[styles.choiceButton, theme === value && styles.choiceSelected]}>
            <Text style={styles.choiceText}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

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

interface AnswerOptionProps {
  text: string;
  lane: number;
  rippleId: number;
  reduceMotion: boolean;
  onSelect: () => void;
}

function AnswerOption({
  text,
  lane,
  rippleId,
  reduceMotion,
  onSelect,
}: AnswerOptionProps) {
  const { theme } = React.useContext(ThemeContext);
  const styles = theme === 'day' ? dayStyles : nightStyles;
  const progress = useRef(new Animated.Value(1)).current;
  const [rippleSize, setRippleSize] = useState(160);

  useEffect(() => {
    if (rippleId === 0) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: reduceMotion ? 120 : 480,
      useNativeDriver: true,
      isInteraction: false,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, rippleId, reduceMotion]);

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={`${text}, ${lane + 1}. şeride geç`}
      activeOpacity={1}
      onPress={onSelect}
      onLayout={({ nativeEvent: { layout } }) => {
        setRippleSize(Math.ceil(Math.hypot(layout.width, layout.height) * 2));
      }}
      style={[
        styles.optionBox,
        {
          borderColor: LANE_COLORS[lane],
          backgroundColor: `${LANE_COLORS[lane]}${theme === 'day' ? '16' : '28'}`,
        },
      ]}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.answerRipple,
          {
            width: rippleSize,
            height: rippleSize,
            borderRadius: rippleSize / 2,
            marginLeft: -rippleSize / 2,
            marginTop: -rippleSize / 2,
            backgroundColor: LANE_COLORS[lane],
            opacity: progress.interpolate({
              inputRange: [0, 0.25, 1],
              outputRange: [0.45, 0.32, 0],
            }),
            transform: [
              {
                scale: reduceMotion
                  ? 1
                  : progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.05, 1],
                    }),
              },
            ],
          },
        ]}
      />
      <Text
        style={styles.optionBoxText}
        numberOfLines={2}
        adjustsFontSizeToFit>
        {text}
      </Text>
    </TouchableOpacity>
  );
}

function QuizRunnerScreen() {
  const { theme } = React.useContext(ThemeContext);
  const styles = theme === 'day' ? dayStyles : nightStyles;
  const [soloDifficulty, setSoloDifficulty] = useState<Difficulty>('normal');
  const [roomDifficulty, setRoomDifficulty] = useState<Difficulty | null>(null);
  const [legacyRoomSelection, setLegacyRoomSelection] = useState<Difficulty | null>(null);
  const [hostId, setHostId] = useState<string | null>(null);
  const [hasSharedDifficulty, setHasSharedDifficulty] = useState(false);
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<any>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [laneRippleCounts, setLaneRippleCounts] = useState([0, 0, 0, 0]);
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    webViewRef.current?.postMessage(JSON.stringify({ type: 'SET_THEME', theme }));
  }, [theme]);

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
    const motionSub = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduceMotion(enabled);
      })
      .catch(() => {});
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
      motionSub.remove();
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
    setLegacyRoomSelection(null);
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

  const handleSoloSetup = () => {
    setErrorMsg(null);
    setRankings([]);
    setFinishSummary(null);
    setPhase('SOLO_SETUP');
  };

  const isSoloSetup = phase === 'SOLO_SETUP';
  const isHost = hostId !== null && hostId === myPlayerId;
  const selectedRoomDifficulty =
    (isHost && !hasSharedDifficulty ? legacyRoomSelection : null) ?? roomDifficulty ?? 'normal';

  const handleStartGame = () => {
    if (isSoloSetup) {
      webViewRef.current?.postMessage(
        JSON.stringify({ type: 'SOLO', color: selectedColor, difficulty: soloDifficulty, theme }),
      );
    } else if (isHost) {
      webViewRef.current?.postMessage(JSON.stringify({
        type: 'START_GAME',
        difficulty: hasSharedDifficulty ? undefined : selectedRoomDifficulty,
      }));
    }
  };

  const handleRoomDifficulty = (difficulty: Difficulty) => {
    if (!isHost) return;
    if (hasSharedDifficulty) {
      webViewRef.current?.postMessage(JSON.stringify({ type: 'SET_DIFFICULTY', difficulty }));
    } else {
      setLegacyRoomSelection(difficulty);
    }
  };

  const handleExitLobby = () => {
    if (!isSoloSetup) {
      webViewRef.current?.postMessage(JSON.stringify({ type: 'LEAVE_ROOM' }));
    }
    setPhase('JOIN');
  };

  const handleBackToLobby = () => {
    if (finishSummary?.solo) {
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
        const players: LobbyPlayer[] = Array.isArray(data.players) ? data.players : [];
        setJoining(false);
        setActiveCode(data.code || '1234');
        setMyPlayerId(data.myPlayerId || null);
        setLobbyPlayers(players);
        setHostId(data.hostId ?? players[0]?.id ?? null);
        setHasSharedDifficulty(typeof data.hostId === 'string');
        const difficulty = data.difficulty;
        setRoomDifficulty(
          difficulty === 'easy' || difficulty === 'normal' || difficulty === 'crazy'
            ? difficulty
            : null,
        );
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
        setLegacyRoomSelection(null);
        setJoining(false);
        setFinishSummary(null);
        setRankings([]);
        setPhase('PLAYING');
        setLaneRippleCounts([0, 0, 0, 0]);
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

      if (data.type === 'LANE_SELECTED') {
        if (
          Number.isInteger(data.lane) &&
          data.lane >= 0 &&
          data.lane < LANE_COLORS.length
        ) {
          setLaneRippleCounts((prev) =>
            prev.map((count, lane) => lane === data.lane ? count + 1 : count),
          );
        }
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
  const overlayStyle = [styles.overlay, { paddingVertical: Math.max(insets.top, insets.bottom, 12) }];

  return (
    <View style={styles.container}>
      {phase === 'PLAYING' && (
        <View
          style={[
            styles.questionPanel,
            { paddingTop: Math.max(insets.top, 8) },
          ]}>
          <View pointerEvents="none" style={styles.statsRow}>
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
            <Text
              style={styles.questionText}
              numberOfLines={2}
              adjustsFontSizeToFit
              minimumFontScale={0.8}>
              {gameState.question}
            </Text>
          </View>

          <View style={styles.optionsRow}>
            {gameState.options.length === 4 &&
              gameState.options.map((opt, idx) => (
                <AnswerOption
                  key={idx}
                  text={opt}
                  lane={idx}
                  rippleId={laneRippleCounts[idx]}
                  reduceMotion={reduceMotion}
                  onSelect={() => {
                    webViewRef.current?.postMessage(
                      JSON.stringify({ type: 'SELECT_LANE', lane: idx }),
                    );
                  }}
                />
              ))}
          </View>
        </View>
      )}

      <View
        style={[
          styles.gameViewport,
          phase === 'PLAYING' && { paddingBottom: insets.bottom },
        ]}>
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
          onLoadEnd={() => webViewRef.current?.postMessage(JSON.stringify({ type: 'SET_THEME', theme }))}
          style={styles.webview}
        />

        {phase === 'PLAYING' && (
          <View
            pointerEvents="none"
            style={[
              styles.gameHint,
              { bottom: Math.max(insets.bottom, 8) },
            ]}>
            <Text style={styles.hintText}>
              Cevaba dokun veya oyun alanında sola/sağa kaydır
            </Text>
          </View>
        )}

        {phase === 'PLAYING' && gameState.feedback && (
          <View
            pointerEvents="none"
            style={[
              styles.gameFeedback,
              { bottom: Math.max(insets.bottom, 8) + 30 },
            ]}>
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
          </View>
        )}
      </View>

      {phase === 'JOIN' && (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={overlayStyle}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            style={styles.card}
            contentContainerStyle={styles.cardContent}>
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
                onPress={handleSoloSetup}
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
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {(phase === 'LOBBY' || isSoloSetup) && (
        <View style={overlayStyle}>
          <ScrollView style={styles.card} contentContainerStyle={styles.cardContent}>
            <Text style={styles.title}>
              {isSoloSetup ? 'Tek Kişilik Yarış' : `Oda: ${activeCode}`}
            </Text>

            {!isSoloSetup && (
              <>
                <Text style={styles.subtitle}>Oyuncular ({lobbyPlayers.length})</Text>
                <View style={styles.playerList}>
                  {lobbyPlayers.map((p) => (
                    <View key={p.id} style={styles.playerRow}>
                      <View
                        style={[styles.playerDot, { backgroundColor: p.color }]}
                      />
                      <Text style={styles.playerName}>
                        {p.name} {p.id === myPlayerId ? '(Sen)' : ''}
                        {p.id === hostId ? ' · Oda sahibi' : ''}
                      </Text>
                    </View>
                  ))}
                </View>
              </>
            )}

            <RaceSettings
              difficulty={isSoloSetup ? soloDifficulty : selectedRoomDifficulty}
              onChange={isSoloSetup ? setSoloDifficulty : isHost ? handleRoomDifficulty : undefined}
            />

            {!isSoloSetup && isHost && !hasSharedDifficulty && roomDifficulty === null && selectedRoomDifficulty !== 'normal' && (
              <Text style={styles.errorText}>
                Bu sunucu zorluk seçimini desteklemiyor. Yarış Normal seviyede başlar.
              </Text>
            )}

            {isSoloSetup || isHost ? (
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={handleStartGame}
                activeOpacity={0.85}>
                <Text style={styles.primaryButtonText}>YARIŞI BAŞLAT</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.subtitle}>Oda sahibinin yarışı başlatması bekleniyor.</Text>
            )}

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={handleExitLobby}>
              <Text style={styles.secondaryButtonText}>Geri Dön</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      )}

      {phase === 'FINISHED' && finishSummary && (
        <View style={overlayStyle}>
          <ScrollView style={styles.card} contentContainerStyle={styles.cardContent}>
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
          </ScrollView>
        </View>
      )}
    </View>
  );
}

export default function App() {
  const [theme, setTheme] = useState<Theme>('day');
  return (
    <SafeAreaProvider>
      <ThemeContext.Provider value={{ theme, setTheme }}>
        <StatusBar barStyle={theme === 'day' ? 'dark-content' : 'light-content'} />
        <QuizRunnerScreen />
      </ThemeContext.Provider>
    </SafeAreaProvider>
  );
}

const nightStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b1020',
  },
  gameViewport: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
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
    flexGrow: 0,
    flexShrink: 1,
    width: '100%',
    maxWidth: 370,
    backgroundColor: 'rgba(15, 23, 42, 0.96)',
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(56, 189, 248, 0.55)',
  },
  cardContent: { padding: 20 },
  raceSettings: { marginBottom: 12 },
  choiceRow: { flexDirection: 'row', gap: 6, marginBottom: 10 },
  choiceButton: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10, borderWidth: 1, borderColor: '#475569', backgroundColor: '#1e293b' },
  choiceSelected: { borderColor: '#38bdf8', borderWidth: 2, backgroundColor: '#164e63' },
  choiceText: { color: '#f8fafc', fontSize: 13, fontWeight: '800' },
  choiceCaption: { color: '#cbd5e1', fontSize: 10, marginTop: 3 },
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
  statsRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
    marginBottom: 6,
  },
  statBadge: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.45)',
    paddingHorizontal: 8,
    paddingVertical: 4,
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
    paddingVertical: 6,
  },
  questionPanel: {
    backgroundColor: '#0f172a',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    paddingBottom: 6,
    paddingHorizontal: 12,
  },
  questionText: {
    color: '#f8fafc',
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 24,
  },
  optionsRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
    marginTop: 6,
    minHeight: 80,
  },
  optionBox: {
    flex: 1,
    minWidth: 0,
    minHeight: 80,
    overflow: 'hidden',
    borderRadius: 12,
    borderWidth: 2,
    paddingHorizontal: 5,
    paddingVertical: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  optionBoxText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
  },
  answerRipple: {
    position: 'absolute',
    left: '50%',
    top: '50%',
  },
  feedbackPill: {
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
  gameFeedback: {
    position: 'absolute',
    bottom: 12,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  gameHint: {
    position: 'absolute',
    bottom: 8,
    left: 12,
    right: 12,
  },
  hintText: {
    color: 'rgba(226, 232, 240, 0.65)',
    fontSize: 11,
    fontWeight: '500',
    textAlign: 'center',
  },
});

// Original dark styling remains intact in nightStyles above.
const dayStyles = {
  ...nightStyles,
  container: { ...nightStyles.container, backgroundColor: '#eaf4fb' },
  webview: { ...nightStyles.webview, backgroundColor: '#c8e8fa' },
  overlay: { ...nightStyles.overlay, backgroundColor: 'rgba(224, 239, 249, 0.86)' },
  card: { ...nightStyles.card, backgroundColor: '#ffffff', borderColor: '#96bfd3' },
  title: { ...nightStyles.title, color: '#16324a' },
  winTitle: { ...nightStyles.winTitle, color: '#15803d' },
  subtitle: { ...nightStyles.subtitle, color: '#526577' },
  inputLabel: { ...nightStyles.inputLabel, color: '#40566b' },
  codeInput: { ...nightStyles.codeInput, backgroundColor: '#f1f7fb', color: '#16324a' },
  nameInput: { ...nightStyles.nameInput, backgroundColor: '#f1f7fb', color: '#16324a', borderColor: '#b6cbd8' },
  colorDotActive: { ...nightStyles.colorDotActive, borderColor: '#4b5563' },
  playerList: { ...nightStyles.playerList, backgroundColor: '#f1f7fb', borderColor: '#c5d9e5' },
  playerName: { ...nightStyles.playerName, color: '#16324a' },
  secondaryButtonText: { ...nightStyles.secondaryButtonText, color: '#526577' },
  rankHeader: { ...nightStyles.rankHeader, color: '#0369a1' },
  rankPlace: { ...nightStyles.rankPlace, color: '#a16207' },
  rankScore: { ...nightStyles.rankScore, color: '#526577' },
  questionPanel: { ...nightStyles.questionPanel, backgroundColor: '#f0f7fc', borderBottomColor: '#c5d9e5' },
  questionCard: { ...nightStyles.questionCard, backgroundColor: '#ffffff', borderColor: '#8ab6cf' },
  questionText: { ...nightStyles.questionText, color: '#16324a' },
  optionBoxText: { ...nightStyles.optionBoxText, color: '#16324a' },
  statBadge: { ...nightStyles.statBadge, backgroundColor: '#ffffff', borderColor: '#b6cbd8' },
  statLabel: { ...nightStyles.statLabel, color: '#526577' },
  statValue: { ...nightStyles.statValue, color: '#0369a1' },
  hintText: { ...nightStyles.hintText, color: '#233d50' },
  choiceButton: { ...nightStyles.choiceButton, backgroundColor: '#f1f7fb', borderColor: '#bdcfdc' },
  choiceSelected: { ...nightStyles.choiceSelected, backgroundColor: '#d7eefb', borderColor: '#0284c7' },
  choiceText: { ...nightStyles.choiceText, color: '#16324a' },
  choiceCaption: { ...nightStyles.choiceCaption, color: '#526577' },
};
