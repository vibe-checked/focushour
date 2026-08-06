import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { useKeepAwake } from 'expo-keep-awake';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  AppStateStatus,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

const STORAGE_KEY_SESSIONS = 'focushour:sessions:v1';
const STORAGE_KEY_CONFIG = 'focushour:config:v1';
const STORAGE_KEY_CYCLE = 'focushour:cycle:v1';

const DEFAULT_FOCUS_MIN = 25;
const DEFAULT_BREAK_MIN = 5;
const DEFAULT_LONG_BREAK_MIN = 15;
const DEFAULT_SESSIONS_UNTIL_LONG_BREAK = 4;

type Mode = 'focus' | 'break' | 'longBreak';

type Session = {
  id: string;
  mode: Mode;
  durationSec: number;
  completedAt: number;
};

type Config = {
  focusMin: number;
  breakMin: number;
  longBreakMin: number;
  sessionsUntilLongBreak: number;
  themeId: string;
};

type Theme = { id: string; label: string; bg: string; focus: string; break: string; accent: string };

const THEMES: Theme[] = [
  { id: 'ember', label: 'Ember', bg: '#16151a', focus: '#c75050', break: '#3a8a8a', accent: '#e8a97f' },
  { id: 'ocean', label: 'Ocean', bg: '#11181f', focus: '#3b8ac4', break: '#2fa89a', accent: '#7cc4e8' },
  { id: 'forest', label: 'Forest', bg: '#131c15', focus: '#4c9a4a', break: '#c98a3a', accent: '#8fd17e' },
  { id: 'grape', label: 'Grape', bg: '#181420', focus: '#9163e6', break: '#e0568f', accent: '#c9a3f0' },
  { id: 'mono', label: 'Mono', bg: '#141414', focus: '#d8d5cc', break: '#8f8c84', accent: '#bdbab1' },
];
const DEFAULT_THEME_ID = 'ember';

Notifications.setNotificationHandler({
  // shouldShowAlert dropped — deprecated in SDK 54; shouldShowBanner +
  // shouldShowList replace it.
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }) as any,
});

function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function App() {
  useKeepAwake();
  const [config, setConfig] = useState<Config>({
    focusMin: DEFAULT_FOCUS_MIN,
    breakMin: DEFAULT_BREAK_MIN,
    longBreakMin: DEFAULT_LONG_BREAK_MIN,
    sessionsUntilLongBreak: DEFAULT_SESSIONS_UNTIL_LONG_BREAK,
    themeId: DEFAULT_THEME_ID,
  });
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<Mode>('focus');
  const [remainingSec, setRemainingSec] = useState(DEFAULT_FOCUS_MIN * 60);
  const [running, setRunning] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [distractions, setDistractions] = useState(0);
  const [sessionsSinceLongBreak, setSessionsSinceLongBreak] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const targetRef = useRef<number | null>(null);
  const notifIdRef = useRef<string | null>(null);
  const tint = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    (async () => {
      try {
        const [c, s, cyc] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY_CONFIG),
          AsyncStorage.getItem(STORAGE_KEY_SESSIONS),
          AsyncStorage.getItem(STORAGE_KEY_CYCLE),
        ]);
        let cfg: Config = {
          focusMin: DEFAULT_FOCUS_MIN,
          breakMin: DEFAULT_BREAK_MIN,
          longBreakMin: DEFAULT_LONG_BREAK_MIN,
          sessionsUntilLongBreak: DEFAULT_SESSIONS_UNTIL_LONG_BREAK,
          themeId: DEFAULT_THEME_ID,
        };
        if (c) {
          cfg = { ...cfg, ...JSON.parse(c) };
          setConfig(cfg);
        }
        if (s) setSessions(JSON.parse(s));
        if (cyc) setSessionsSinceLongBreak(JSON.parse(cyc));
        setRemainingSec(cfg.focusMin * 60);
      } catch (e) {
        console.warn('Load failed', e);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    AsyncStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(config)).catch(() => {});
  }, [config, loaded]);

  useEffect(() => {
    if (!loaded) return;
    AsyncStorage.setItem(STORAGE_KEY_SESSIONS, JSON.stringify(sessions)).catch(() => {});
  }, [sessions, loaded]);

  useEffect(() => {
    if (!loaded) return;
    AsyncStorage.setItem(STORAGE_KEY_CYCLE, JSON.stringify(sessionsSinceLongBreak)).catch(() => {});
  }, [sessionsSinceLongBreak, loaded]);

  // Permission request on mount (notifications)
  useEffect(() => {
    (async () => {
      const settings = await Notifications.getPermissionsAsync();
      if (settings.status !== 'granted') {
        await Notifications.requestPermissionsAsync();
      }
    })();
  }, []);

  const durationFor = useCallback(
    (m: Mode) =>
      (m === 'focus' ? config.focusMin : m === 'longBreak' ? config.longBreakMin : config.breakMin) * 60,
    [config]
  );

  const totalSec = durationFor(mode);
  const theme = THEMES.find((t) => t.id === config.themeId) ?? THEMES[0];

  useEffect(() => {
    Animated.timing(tint, {
      toValue: mode === 'focus' ? 0 : 1,
      duration: 600,
      useNativeDriver: false,
    }).start();
  }, [mode, tint]);

  const cancelScheduledNotif = useCallback(async () => {
    if (notifIdRef.current) {
      try {
        await Notifications.cancelScheduledNotificationAsync(notifIdRef.current);
      } catch {}
      notifIdRef.current = null;
    }
  }, []);

  const stopTick = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    targetRef.current = null;
  }, []);

  const completeSession = useCallback(() => {
    const completedAt = Date.now();
    const sec = totalSec;
    const finishedMode = mode;
    // Only persist focus sessions — break sessions consumed the 200-slot
    // budget and never appeared in stats anyway.
    if (finishedMode === 'focus') {
      setSessions((prev) => [
        {
          id: `${completedAt}-${Math.random().toString(36).slice(2, 8)}`,
          mode: finishedMode,
          durationSec: sec,
          completedAt,
        },
        ...prev,
      ].slice(0, 200));
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

    // Classic Pomodoro cycle: focus -> short break, repeated
    // `sessionsUntilLongBreak` times, then a long break resets the count.
    let nextMode: Mode;
    if (finishedMode === 'focus') {
      const completedCount = sessionsSinceLongBreak + 1;
      if (completedCount >= config.sessionsUntilLongBreak) {
        nextMode = 'longBreak';
        setSessionsSinceLongBreak(0);
      } else {
        nextMode = 'break';
        setSessionsSinceLongBreak(completedCount);
      }
    } else {
      nextMode = 'focus';
    }
    setMode(nextMode);
    setRemainingSec(durationFor(nextMode));
    setRunning(false);
    stopTick();
  }, [mode, totalSec, config, sessionsSinceLongBreak, durationFor, stopTick]);

  const tick = useCallback(() => {
    if (targetRef.current == null) return;
    const left = Math.max(0, Math.round((targetRef.current - Date.now()) / 1000));
    // Only setState when the displayed integer second actually changes.
    setRemainingSec((prev) => (prev === left ? prev : left));
    if (left <= 0) {
      stopTick();
      completeSession();
    }
  }, [completeSession, stopTick]);

  const start = useCallback(async () => {
    // Synchronous re-entry guard: if a tick interval is already running, abort.
    if (tickRef.current || running) return;
    // Reserve the interval slot synchronously so concurrent taps can't race.
    tickRef.current = setInterval(tick, 250);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const target = Date.now() + remainingSec * 1000;
    targetRef.current = target;
    setRunning(true);
    setDistractions(0);

    // Schedule a local notification at the end so the user is alerted even if
    // they background the app or the JS timer is paused.
    try {
      await cancelScheduledNotif();
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: mode === 'focus' ? 'Focus session done' : 'Break done',
          body:
            mode === 'focus'
              ? sessionsSinceLongBreak + 1 >= config.sessionsUntilLongBreak
                ? 'Take a longer break.'
                : 'Take a short break.'
              : 'Back to focus.',
          sound: 'default',
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: Math.max(1, remainingSec),
          repeats: false,
        },
      });
      notifIdRef.current = id;
    } catch (e) {
      // Notifications may not be granted; ignore.
    }
  }, [running, remainingSec, mode, sessionsSinceLongBreak, config, cancelScheduledNotif, tick]);

  const pause = useCallback(() => {
    if (!running) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    stopTick();
    setRunning(false);
    cancelScheduledNotif();
  }, [running, stopTick, cancelScheduledNotif]);

  const reset = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    stopTick();
    cancelScheduledNotif();
    setRunning(false);
    setRemainingSec(totalSec);
  }, [stopTick, totalSec, cancelScheduledNotif]);

  const skip = useCallback(() => {
    stopTick();
    cancelScheduledNotif();
    setRunning(false);
    // Skip doesn't log a session (stats/streak/heatmap only count sessions
    // that finish naturally), but it still advances the Pomodoro cycle —
    // otherwise skipping through focus sessions never reaches a long break.
    let nextMode: Mode;
    if (mode === 'focus') {
      const skippedCount = sessionsSinceLongBreak + 1;
      if (skippedCount >= config.sessionsUntilLongBreak) {
        nextMode = 'longBreak';
        setSessionsSinceLongBreak(0);
      } else {
        nextMode = 'break';
        setSessionsSinceLongBreak(skippedCount);
      }
    } else {
      nextMode = 'focus';
    }
    setMode(nextMode);
    setRemainingSec(durationFor(nextMode));
  }, [mode, config, sessionsSinceLongBreak, durationFor, stopTick, cancelScheduledNotif]);

  useEffect(() => {
    return () => {
      stopTick();
      cancelScheduledNotif();
    };
  }, [stopTick, cancelScheduledNotif]);

  // When the app comes back to foreground, the JS interval may have been
  // paused while we were backgrounded. Reconcile state against wall clock.
  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      if (state !== 'active') {
        // A gentle, local-only signal (no tracking sent anywhere) that the
        // user stepped away mid-focus — surfaced back to them, never logged.
        if (running && mode === 'focus') setDistractions((d) => d + 1);
        return;
      }
      if (!targetRef.current) return;
      const left = Math.max(0, Math.round((targetRef.current - Date.now()) / 1000));
      setRemainingSec(left);
      if (left <= 0) {
        stopTick();
        completeSession();
      }
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [stopTick, completeSession, running, mode]);

  // Consecutive-day streak, with today counted as "still alive" until it ends.
  const streakDays = useMemo(() => {
    const daySet = new Set(
      sessions
        .filter((s) => s.mode === 'focus')
        .map((s) => {
          const d = new Date(s.completedAt);
          d.setHours(0, 0, 0, 0);
          return d.getTime();
        })
    );
    const cursor = new Date();
    cursor.setHours(0, 0, 0, 0);
    if (!daySet.has(cursor.getTime())) cursor.setDate(cursor.getDate() - 1);
    let streak = 0;
    while (daySet.has(cursor.getTime())) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }, [sessions]);

  // Today's session stats
  const todayCounts = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const ms = start.getTime();
    const today = sessions.filter((s) => s.completedAt >= ms);
    const focusCount = today.filter((s) => s.mode === 'focus').length;
    const totalMin = today
      .filter((s) => s.mode === 'focus')
      .reduce((sum, s) => sum + Math.round(s.durationSec / 60), 0);
    return { focusCount, totalMin };
  }, [sessions]);

  const progress = useMemo(() => {
    if (totalSec === 0) return 0;
    return 1 - remainingSec / totalSec;
  }, [remainingSec, totalSec]);

  const mins = Math.floor(remainingSec / 60);
  const secs = remainingSec % 60;
  const timeLabel = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

  const tintColor = tint.interpolate({
    inputRange: [0, 1],
    outputRange: [hexToRgba(theme.focus, 0.05), hexToRgba(theme.break, 0.07)],
  });
  const modeColor = mode === 'focus' ? theme.focus : theme.break;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]}>
      <StatusBar style="light" />
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: tintColor }]} pointerEvents="none" />

      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>Focus <Text style={[styles.brandItalic, { color: theme.focus }]}>Hour</Text></Text>
          <Text style={styles.tagline}>quiet · no ads · no tracking</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          {streakDays > 0 && (
            <View style={[styles.streakBadge, { backgroundColor: hexToRgba(theme.accent, 0.16) }]}>
              <Text style={[styles.streakBadgeText, { color: theme.accent }]}>🔥 {streakDays}</Text>
            </View>
          )}
          <Pressable
            onPress={() => setSettingsOpen(true)}
            style={({ pressed }) => [styles.settingsBtn, pressed && styles.settingsBtnPressed]}
            hitSlop={8}
          >
            <Text style={styles.settingsBtnText}>Settings</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.body}>
        <Text style={[styles.modeLabel, { color: modeColor }]}>
          {mode === 'focus' ? 'FOCUS' : mode === 'longBreak' ? 'LONG BREAK' : 'BREAK'}
        </Text>
        <View style={styles.cycleDots}>
          {Array.from({ length: config.sessionsUntilLongBreak }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.cycleDot,
                {
                  backgroundColor:
                    i < sessionsSinceLongBreak || mode === 'longBreak'
                      ? theme.focus
                      : 'rgba(255,255,255,0.16)',
                },
              ]}
            />
          ))}
        </View>
        <Text style={styles.distractionLabel}>
          {mode === 'focus' && running
            ? distractions === 0
              ? 'staying in the zone'
              : `left the app ${distractions}×`
            : ' '}
        </Text>

        <View style={styles.dialWrap}>
          <DialRing progress={progress} mode={mode} theme={theme} />
          <View style={styles.dialCenter} pointerEvents="none">
            <Text style={styles.timeText}>{timeLabel}</Text>
            <Text style={styles.timeSub}>{Math.round(totalSec / 60)} min</Text>
          </View>
        </View>

        <View style={styles.controls}>
          {!running ? (
            <Pressable
              onPress={start}
              style={({ pressed }) => [styles.primaryBtn, { backgroundColor: theme.focus }, pressed && styles.primaryBtnPressed]}
            >
              <Text style={styles.primaryBtnText}>Start</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={pause}
              style={({ pressed }) => [styles.primaryBtn, { backgroundColor: theme.break }, pressed && styles.primaryBtnPressed]}
            >
              <Text style={styles.primaryBtnText}>Pause</Text>
            </Pressable>
          )}
          <Pressable
            onPress={reset}
            style={({ pressed }) => [styles.secondaryBtn, pressed && styles.secondaryBtnPressed]}
          >
            <Text style={styles.secondaryBtnText}>Reset</Text>
          </Pressable>
          <Pressable
            onPress={skip}
            style={({ pressed }) => [styles.secondaryBtn, pressed && styles.secondaryBtnPressed]}
          >
            <Text style={styles.secondaryBtnText}>Skip</Text>
          </Pressable>
        </View>

        <View style={styles.stats}>
          <Stat label="Today" value={`${todayCounts.focusCount}`} sub="sessions" />
          <Stat label="Minutes" value={`${todayCounts.totalMin}`} sub="focused" />
          <Stat label="All time" value={`${sessions.filter((s) => s.mode === 'focus').length}`} sub="sessions" />
        </View>

        <Heatmap sessions={sessions} theme={theme} />
      </View>

      <SettingsModal
        visible={settingsOpen}
        config={config}
        onSave={(next) => {
          // Pause first so a running timer doesn't keep firing against
          // a stale targetRef / scheduled notification.
          if (running) {
            stopTick();
            cancelScheduledNotif();
            setRunning(false);
          }
          setConfig(next);
          setSessionsSinceLongBreak((prev) => Math.min(prev, next.sessionsUntilLongBreak - 1));
          const nextTotal =
            mode === 'focus' ? next.focusMin : mode === 'longBreak' ? next.longBreakMin : next.breakMin;
          setRemainingSec(nextTotal * 60);
          setSettingsOpen(false);
        }}
        onClose={() => setSettingsOpen(false)}
      />
    </SafeAreaView>
  );
}

/** A GitHub-style contribution heatmap of the last ~10 weeks of focus time. */
function Heatmap({ sessions, theme }: { sessions: Session[]; theme: Theme }) {
  const weeks = 10;
  const minutesByDay = useMemo(() => {
    const map = new Map<number, number>();
    sessions
      .filter((s) => s.mode === 'focus')
      .forEach((s) => {
        const d = new Date(s.completedAt);
        d.setHours(0, 0, 0, 0);
        const key = d.getTime();
        map.set(key, (map.get(key) ?? 0) + Math.round(s.durationSec / 60));
      });
    return map;
  }, [sessions]);

  const cols = useMemo(() => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const gridStart = new Date(todayStart);
    gridStart.setDate(gridStart.getDate() - (weeks * 7 - 1) - todayStart.getDay());

    const grid: (number | null)[][] = [];
    for (let w = 0; w < weeks + 1; w++) {
      const col: (number | null)[] = [];
      for (let d = 0; d < 7; d++) {
        const cellDate = new Date(gridStart);
        cellDate.setDate(gridStart.getDate() + w * 7 + d);
        col.push(cellDate > todayStart ? null : minutesByDay.get(cellDate.getTime()) ?? 0);
      }
      grid.push(col);
    }
    return grid;
  }, [minutesByDay]);

  const levelColor = (minutes: number | null) => {
    if (minutes === null) return 'transparent';
    if (minutes === 0) return 'rgba(255,255,255,0.06)';
    if (minutes < 15) return hexToRgba(theme.focus, 0.32);
    if (minutes < 30) return hexToRgba(theme.focus, 0.58);
    if (minutes < 60) return hexToRgba(theme.focus, 0.82);
    return theme.focus;
  };

  return (
    <View style={styles.heatmapWrap}>
      {cols.map((col, i) => (
        <View key={i} style={styles.heatmapCol}>
          {col.map((minutes, j) => (
            <View key={j} style={[styles.heatmapCell, { backgroundColor: levelColor(minutes) }]} />
          ))}
        </View>
      ))}
    </View>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statSub}>{sub}</Text>
    </View>
  );
}

/**
 * A pure-RN progress ring built with squared-off ticks. Tick geometry is
 * memoized so each render only re-applies backgroundColor based on the
 * filled threshold.
 */
function DialRing({ progress, mode, theme }: { progress: number; mode: Mode; theme: Theme }) {
  const size = 280;
  const thickness = 8;
  const color = mode === 'focus' ? theme.focus : theme.break;
  const ticks = useMemo(() => {
    const arr: {
      i: number;
      major: boolean;
      style: {
        position: 'absolute';
        width: number;
        height: number;
        left: number;
        top: number;
        transform: { rotate: string }[];
      };
    }[] = [];
    for (let i = 0; i < 60; i++) {
      const angle = (i / 60) * 2 * Math.PI - Math.PI / 2;
      const inner = size / 2 - thickness - 8;
      const major = i % 5 === 0;
      const outer = inner + (major ? 14 : 8);
      const x1 = Math.cos(angle) * inner;
      const y1 = Math.sin(angle) * inner;
      const x2 = Math.cos(angle) * outer;
      const y2 = Math.sin(angle) * outer;
      const length = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
      const tickAngleDeg = (angle * 180) / Math.PI + 90;
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      arr.push({
        i,
        major,
        style: {
          position: 'absolute',
          width: major ? 2 : 1,
          height: length,
          left: size / 2 + mx - (major ? 1 : 0.5),
          top: size / 2 + my - length / 2,
          transform: [{ rotate: `${tickAngleDeg}deg` }],
        },
      });
    }
    return arr;
  }, [size, thickness]);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: thickness,
          borderColor: 'rgba(255,255,255,0.07)',
          position: 'absolute',
        }}
      />
      {ticks.map((t) => {
        const filled = t.i / 60 < progress;
        return (
          <View
            key={t.i}
            style={[t.style, { backgroundColor: filled ? color : 'rgba(255,255,255,0.18)' }]}
          />
        );
      })}
    </View>
  );
}

function SettingsModal({
  visible,
  config,
  onSave,
  onClose,
}: {
  visible: boolean;
  config: Config;
  onSave: (c: Config) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(config);
  const previewTheme = THEMES.find((t) => t.id === draft.themeId) ?? THEMES[0];
  const translateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setDraft(config);
      translateY.setValue(0);
    }
  }, [visible, config, translateY]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) translateY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 120 || g.vy > 1.1) {
          Animated.timing(translateY, { toValue: 900, duration: 180, useNativeDriver: true }).start(onClose);
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
        }
      },
    })
  ).current;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Animated.View style={[styles.modalCard, { transform: [{ translateY }] }]}>
          <View {...panResponder.panHandlers} style={styles.grabberWrap}>
            <View style={styles.grabber} />
          </View>
          <View onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>Settings</Text>
            <ScrollView contentContainerStyle={{ paddingBottom: 8 }}>
              <Row
                label="Focus length (min)"
                value={draft.focusMin}
                onChange={(v) => setDraft({ ...draft, focusMin: v })}
                min={1}
                max={120}
              />
              <Row
                label="Break length (min)"
                value={draft.breakMin}
                onChange={(v) => setDraft({ ...draft, breakMin: v })}
                min={1}
                max={60}
              />
              <Row
                label="Sessions until long break"
                value={draft.sessionsUntilLongBreak}
                onChange={(v) => setDraft({ ...draft, sessionsUntilLongBreak: v })}
                min={2}
                max={8}
              />
              <Row
                label="Long break length (min)"
                value={draft.longBreakMin}
                onChange={(v) => setDraft({ ...draft, longBreakMin: v })}
                min={5}
                max={60}
              />
              <Text style={styles.themeSectionLabel}>Theme</Text>
              <View style={styles.themeRow}>
                {THEMES.map((t) => {
                  const selected = t.id === draft.themeId;
                  return (
                    <Pressable
                      key={t.id}
                      onPress={() => setDraft({ ...draft, themeId: t.id })}
                      style={styles.themeSwatchWrap}
                      hitSlop={4}
                    >
                      <View
                        style={[
                          styles.themeSwatch,
                          { backgroundColor: t.focus, borderColor: selected ? t.focus : 'transparent' },
                        ]}
                      >
                        <View style={[styles.themeSwatchHalf, { backgroundColor: t.break }]} />
                      </View>
                      <Text style={styles.themeSwatchLabel}>{t.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
            <View style={styles.modalActions}>
              <Pressable onPress={onClose} style={({ pressed }) => [styles.modalBtn, pressed && styles.modalBtnPressed]}>
                <Text style={styles.modalBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => onSave(draft)}
                style={({ pressed }) => [
                  styles.modalBtn,
                  { backgroundColor: previewTheme.focus },
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Text style={[styles.modalBtnText, styles.modalBtnTextPrimary]}>Save</Text>
              </Pressable>
            </View>
          </View>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

function Row({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText(String(value));
  }, [value]);
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <TextInput
        value={text}
        onChangeText={(t) => {
          setText(t);
          const n = parseInt(t, 10);
          if (Number.isFinite(n) && n >= min && n <= max) onChange(n);
        }}
        keyboardType="number-pad"
        style={styles.rowInput}
        maxLength={3}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#16151a' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 6, paddingBottom: 8,
  },
  brand: { fontSize: 18, fontWeight: '700', color: '#e8e6df', letterSpacing: 0.3 },
  brandItalic: { fontStyle: 'italic', color: '#c75050', fontWeight: '600' },
  tagline: { fontSize: 9, color: '#5c5a53', letterSpacing: 0.06 * 9, marginTop: 2 },
  streakBadge: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
    backgroundColor: 'rgba(199,80,80,0.14)',
  },
  streakBadgeText: { color: '#e8a97f', fontSize: 13, fontWeight: '600' },
  settingsBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  settingsBtnPressed: { backgroundColor: '#26242c' },
  settingsBtnText: { color: '#a09e95', fontSize: 13, fontWeight: '500' },

  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  modeLabel: { fontSize: 12, letterSpacing: 0.32 * 12, color: '#c75050', marginBottom: 10, fontWeight: '600' },
  cycleDots: { flexDirection: 'row', gap: 7, marginBottom: 10 },
  cycleDot: { width: 6, height: 6, borderRadius: 3 },
  distractionLabel: { fontSize: 11, color: '#6e6c66', marginBottom: 22 },
  dialWrap: { alignItems: 'center', justifyContent: 'center', marginBottom: 32 },
  dialCenter: {
    position: 'absolute', alignItems: 'center', justifyContent: 'center',
  },
  timeText: { fontSize: 64, color: '#e8e6df', fontVariant: ['tabular-nums'], fontWeight: '300', letterSpacing: -1 },
  timeSub: { fontSize: 12, color: '#6e6c66', marginTop: 4, letterSpacing: 0.18 * 12 },
  controls: { flexDirection: 'row', gap: 10, marginBottom: 36 },
  primaryBtn: {
    paddingHorizontal: 36, paddingVertical: 14, borderRadius: 999,
    backgroundColor: '#c75050',
  },
  primaryBtnPause: { backgroundColor: '#3a8a8a' },
  primaryBtnPressed: { opacity: 0.85 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '600', letterSpacing: 0.5 },
  secondaryBtn: {
    paddingHorizontal: 18, paddingVertical: 14, borderRadius: 999,
    borderWidth: 1, borderColor: '#36343c',
  },
  secondaryBtnPressed: { backgroundColor: '#26242c' },
  secondaryBtnText: { color: '#c1bfb6', fontSize: 14, fontWeight: '500' },

  stats: { flexDirection: 'row', gap: 28 },
  stat: { alignItems: 'center' },
  statLabel: { fontSize: 10, color: '#7b786f', letterSpacing: 0.2 * 10, marginBottom: 4 },
  statValue: { fontSize: 24, color: '#e8e6df', fontWeight: '400' },
  statSub: { fontSize: 10, color: '#6e6c66', marginTop: 2, letterSpacing: 0.1 * 10 },

  heatmapWrap: { flexDirection: 'row', gap: 3, marginTop: 24 },
  heatmapCol: { gap: 3 },
  heatmapCell: { width: 9, height: 9, borderRadius: 2 },

  themeSectionLabel: {
    fontSize: 11, color: '#7b786f', letterSpacing: 0.2 * 11,
    marginTop: 20, marginBottom: 10, textTransform: 'uppercase',
  },
  themeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, paddingBottom: 4 },
  themeSwatchWrap: { alignItems: 'center', width: 56 },
  themeSwatch: {
    width: 36, height: 36, borderRadius: 18, overflow: 'hidden', borderWidth: 2,
  },
  themeSwatchHalf: { position: 'absolute', right: 0, top: 0, bottom: 0, width: '50%' },
  themeSwatchLabel: { fontSize: 10, color: '#a09e95', marginTop: 6 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: '#1f1e24', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 24, paddingTop: 10, paddingBottom: 36,
  },
  grabberWrap: { alignItems: 'center', paddingVertical: 10 },
  grabber: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.18)' },
  modalTitle: { fontSize: 18, fontWeight: '600', color: '#e8e6df', marginBottom: 16 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#2a292f' },
  rowLabel: { color: '#c1bfb6', fontSize: 15 },
  rowInput: {
    minWidth: 56, textAlign: 'right',
    backgroundColor: '#26242c', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 8,
    color: '#e8e6df', fontSize: 16, fontVariant: ['tabular-nums'],
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 16 },
  modalBtn: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10, backgroundColor: '#26242c' },
  modalBtnPressed: { backgroundColor: '#33313a' },
  modalBtnPrimary: { backgroundColor: '#c75050' },
  modalBtnPrimaryPressed: { backgroundColor: '#a84141' },
  modalBtnText: { color: '#c1bfb6', fontSize: 14, fontWeight: '600' },
  modalBtnTextPrimary: { color: '#fff' },
});
