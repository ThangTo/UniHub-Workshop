import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

type PendingScan = {
  idempotencyKey: string;
  qrToken: string;
  scannedAt: string;
  deviceId: string;
  synced: number;
};

type AuthState = {
  accessToken: string;
  refreshToken: string;
  fullName?: string;
};

const DEFAULT_API_BASE_URL = 'http://localhost:3000';
const AUTH_STORAGE_KEY = 'unihub.mobile.auth';
const API_BASE_STORAGE_KEY = 'unihub.mobile.apiBaseUrl';
const DEVICE_ID_STORAGE_KEY = 'unihub.mobile.deviceId';

const db = SQLite.openDatabaseSync('unihub-checkin.db');

export default function App() {
  const [apiBaseUrl, setApiBaseUrl] = useState(DEFAULT_API_BASE_URL);
  const [email, setEmail] = useState('staff@unihub.local');
  const [password, setPassword] = useState('Test@12345');
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [qrToken, setQrToken] = useState('');
  const [pending, setPending] = useState<PendingScan[]>([]);
  const [busy, setBusy] = useState(false);
  const [deviceId, setDeviceId] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  const pendingCount = useMemo(() => pending.filter((item) => item.synced === 0).length, [pending]);

  useEffect(() => {
    void bootstrap();
  }, []);

  async function bootstrap() {
    db.execSync(`
      CREATE TABLE IF NOT EXISTS pending_scans (
        idempotency_key TEXT PRIMARY KEY NOT NULL,
        qr_token TEXT NOT NULL,
        scanned_at TEXT NOT NULL,
        device_id TEXT NOT NULL,
        synced INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const [storedAuth, storedApiBaseUrl, storedDeviceId] = await Promise.all([
      SecureStore.getItemAsync(AUTH_STORAGE_KEY),
      AsyncStorage.getItem(API_BASE_STORAGE_KEY),
      AsyncStorage.getItem(DEVICE_ID_STORAGE_KEY),
    ]);
    if (storedApiBaseUrl) setApiBaseUrl(storedApiBaseUrl);
    if (storedAuth) setAuth(JSON.parse(storedAuth) as AuthState);

    const nextDeviceId = storedDeviceId ?? `mobile-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    if (!storedDeviceId) await AsyncStorage.setItem(DEVICE_ID_STORAGE_KEY, nextDeviceId);
    setDeviceId(nextDeviceId);
    await reloadPending();
  }

  async function reloadPending() {
    const rows = await db.getAllAsync<PendingScan>(
      `SELECT
        idempotency_key as idempotencyKey,
        qr_token as qrToken,
        scanned_at as scannedAt,
        device_id as deviceId,
        synced
       FROM pending_scans
       ORDER BY created_at DESC`,
    );
    setPending(rows);
  }

  async function login() {
    setBusy(true);
    try {
      await AsyncStorage.setItem(API_BASE_STORAGE_KEY, apiBaseUrl);
      const res = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.message ?? body?.code ?? 'login_failed');
      const roles = body.roles ?? [];
      if (!roles.includes('CHECKIN_STAFF') && !roles.includes('SYS_ADMIN')) {
        throw new Error('Tài khoản không có quyền CHECKIN_STAFF.');
      }
      const nextAuth: AuthState = {
        accessToken: body.accessToken,
        refreshToken: body.refreshToken,
        fullName: body.fullName,
      };
      await SecureStore.setItemAsync(AUTH_STORAGE_KEY, JSON.stringify(nextAuth));
      setAuth(nextAuth);
    } catch (error) {
      Alert.alert('Login failed', (error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await SecureStore.deleteItemAsync(AUTH_STORAGE_KEY);
    setAuth(null);
  }

  async function queueScan(tokenInput = qrToken) {
    const token = tokenInput.trim();
    if (!token) return;
    const scannedAt = new Date().toISOString();
    const idempotencyKey = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      `${token}:${deviceId}:${scannedAt}`,
    );
    await db.runAsync(
      `INSERT OR IGNORE INTO pending_scans (idempotency_key, qr_token, scanned_at, device_id, synced)
       VALUES (?, ?, ?, ?, 0)`,
      [idempotencyKey, token, scannedAt, deviceId],
    );
    setQrToken('');
    setScannerOpen(false);
    await reloadPending();
  }

  async function openScanner() {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert('Camera permission required', 'Camera access is needed to scan QR codes.');
        return;
      }
    }
    setScannerOpen(true);
  }

  async function syncPending() {
    if (!auth) return;
    const unsynced = pending.filter((item) => item.synced === 0);
    if (unsynced.length === 0) return;
    setBusy(true);
    try {
      const batchKey = await Crypto.randomUUID();
      const res = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/checkin/batch`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': batchKey,
        },
        body: JSON.stringify({
          items: unsynced.map((item) => ({
            qrToken: item.qrToken,
            scannedAt: item.scannedAt,
            deviceId: item.deviceId,
            idempotencyKey: item.idempotencyKey,
          })),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.message ?? body?.code ?? 'sync_failed');

      const acceptedKeys = [...(body.accepted ?? []), ...(body.duplicates ?? [])].map(
        (item: { idempotencyKey: string }) => item.idempotencyKey,
      );
      for (const key of acceptedKeys) {
        await db.runAsync('UPDATE pending_scans SET synced = 1 WHERE idempotency_key = ?', [key]);
      }
      await reloadPending();
      Alert.alert('Sync complete', `${acceptedKeys.length}/${unsynced.length} scans synced.`);
    } catch (error) {
      Alert.alert('Sync failed', `${(error as Error).message}\nScans stay in SQLite and can be retried.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.header}>
        <Text style={styles.title}>UniHub Check-in</Text>
        <Text style={styles.subtitle}>{auth ? auth.fullName ?? 'Check-in staff' : 'Staff login'}</Text>
      </View>

      {!auth ? (
        <View style={styles.panel}>
          <TextInput value={apiBaseUrl} onChangeText={setApiBaseUrl} style={styles.input} autoCapitalize="none" />
          <TextInput value={email} onChangeText={setEmail} style={styles.input} autoCapitalize="none" />
          <TextInput value={password} onChangeText={setPassword} style={styles.input} secureTextEntry />
          <ActionButton label="Login" onPress={login} disabled={busy} />
        </View>
      ) : (
        <View style={styles.panel}>
          {scannerOpen ? (
            <View style={styles.cameraFrame}>
              <CameraView
                style={styles.camera}
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={({ data }) => {
                  if (!busy && data) void queueScan(data);
                }}
              />
              <Pressable onPress={() => setScannerOpen(false)} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>Close camera</Text>
              </Pressable>
            </View>
          ) : null}
          <TextInput
            value={qrToken}
            onChangeText={setQrToken}
            style={[styles.input, styles.qrInput]}
            autoCapitalize="none"
            multiline
            placeholder="Paste QR token"
          />
          <View style={styles.row}>
            <ActionButton label="Scan QR" onPress={openScanner} disabled={busy} />
            <ActionButton label="Queue Token" onPress={() => queueScan()} disabled={busy || !qrToken.trim()} />
          </View>
          <View style={styles.row}>
            <ActionButton label={`Sync ${pendingCount}`} onPress={syncPending} disabled={busy || pendingCount === 0} />
          </View>
          <Pressable onPress={logout} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Logout</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.listHeader}>
        <Text style={styles.sectionTitle}>Local Queue</Text>
        {busy ? <ActivityIndicator /> : null}
      </View>
      <FlatList
        data={pending}
        keyExtractor={(item) => item.idempotencyKey}
        renderItem={({ item }) => (
          <View style={styles.scanItem}>
            <Text style={styles.scanTitle}>{item.synced ? 'Synced' : 'Pending'}</Text>
            <Text style={styles.scanMeta}>{new Date(item.scannedAt).toLocaleString()}</Text>
            <Text style={styles.scanKey}>{item.idempotencyKey}</Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

function ActionButton(props: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      style={[styles.button, props.disabled ? styles.buttonDisabled : null]}
    >
      <Text style={styles.buttonText}>{props.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f8fafc', padding: 16 },
  header: { marginBottom: 18 },
  title: { color: '#0f172a', fontSize: 28, fontWeight: '700' },
  subtitle: { color: '#475569', marginTop: 4 },
  panel: { gap: 10, marginBottom: 18 },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    backgroundColor: '#ffffff',
    color: '#0f172a',
    padding: 12,
  },
  qrInput: { minHeight: 96, textAlignVertical: 'top' },
  cameraFrame: { borderRadius: 8, overflow: 'hidden', backgroundColor: '#0f172a' },
  camera: { height: 260 },
  row: { flexDirection: 'row', gap: 10 },
  button: { flex: 1, backgroundColor: '#0f766e', borderRadius: 8, padding: 14, alignItems: 'center' },
  buttonDisabled: { backgroundColor: '#94a3b8' },
  buttonText: { color: '#ffffff', fontWeight: '700' },
  secondaryButton: { alignItems: 'center', padding: 10 },
  secondaryButtonText: { color: '#334155', fontWeight: '600' },
  listHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  sectionTitle: { color: '#0f172a', fontSize: 18, fontWeight: '700' },
  scanItem: { backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderWidth: 1, borderRadius: 8, padding: 12, marginBottom: 8 },
  scanTitle: { color: '#0f172a', fontWeight: '700' },
  scanMeta: { color: '#64748b', marginTop: 4 },
  scanKey: { color: '#475569', marginTop: 6, fontSize: 11 },
});
