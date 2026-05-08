import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import jsrsasign from 'jsrsasign';
import { useEffect, useMemo, useRef, useState } from 'react';
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

type CheckinResultCode =
  | 'accepted'
  | 'duplicate'
  | 'invalid_signature'
  | 'expired'
  | 'not_yet_valid'
  | 'revoked'
  | 'invalid_registration'
  | 'not_assigned'
  | 'wrong_room'
  | 'unknown_error';

type PendingScan = {
  idempotencyKey: string;
  qrToken: string;
  regId: string | null;
  workshopId: string | null;
  scannedAt: string;
  deviceId: string;
  synced: number;
  resultCode: CheckinResultCode | null;
  errorMessage: string | null;
};

type AuthState = {
  accessToken: string;
  refreshToken: string;
  fullName?: string;
};

type JwksState = {
  alg: 'RS256';
  issuer: string;
  publicKey: string;
  fetchedAt: string;
};

type QrPayload = {
  regId: string;
  workshopId: string;
  studentId: string;
  validFrom: number;
  validTo: number;
  exp?: number;
  iss?: string;
  jti?: string;
};

type BatchItemResult = {
  idempotencyKey: string;
  regId?: string;
  result: CheckinResultCode;
  message?: string;
  scannedAt?: string;
};

type BatchResponse = {
  accepted?: BatchItemResult[];
  duplicates?: BatchItemResult[];
  invalid?: BatchItemResult[];
};

const { KJUR } = jsrsasign;

const DEFAULT_API_BASE_URL = 'http://localhost:3000';
const AUTH_STORAGE_KEY = 'unihub.mobile.auth';
const API_BASE_STORAGE_KEY = 'unihub.mobile.apiBaseUrl';
const DEVICE_ID_STORAGE_KEY = 'unihub.mobile.deviceId';
const JWKS_STORAGE_KEY = 'unihub.mobile.jwks';
const POST_END_GRACE_MS = 60 * 60 * 1000;

const db = SQLite.openDatabaseSync('unihub-checkin.db');

export default function App() {
  const [apiBaseUrl, setApiBaseUrl] = useState(DEFAULT_API_BASE_URL);
  const [email, setEmail] = useState('staff@unihub.local');
  const [password, setPassword] = useState('Test@12345');
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [jwks, setJwks] = useState<JwksState | null>(null);
  const [qrToken, setQrToken] = useState('');
  const [pending, setPending] = useState<PendingScan[]>([]);
  const [busy, setBusy] = useState(false);
  const [deviceId, setDeviceId] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [isOnline, setIsOnline] = useState<boolean | null>(null);
  const [lastSyncMessage, setLastSyncMessage] = useState('No sync yet');
  const [permission, requestPermission] = useCameraPermissions();
  const syncingRef = useRef(false);

  const pendingCount = useMemo(
    () => pending.filter((item) => item.synced === 0).length,
    [pending],
  );
  const completedCount = useMemo(
    () => pending.filter((item) => item.synced === 1).length,
    [pending],
  );

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const online = Boolean(state.isConnected && state.isInternetReachable !== false);
      setIsOnline(online);
      if (online && auth) {
        void syncPending(true);
      }
    });
    return unsubscribe;
  }, [auth, apiBaseUrl]);

  async function bootstrap() {
    db.execSync('PRAGMA journal_mode = WAL;');
    db.execSync(`
      CREATE TABLE IF NOT EXISTS pending_scans (
        idempotency_key TEXT PRIMARY KEY NOT NULL,
        qr_token TEXT NOT NULL,
        reg_id TEXT,
        workshop_id TEXT,
        scanned_at TEXT NOT NULL,
        device_id TEXT NOT NULL,
        synced INTEGER NOT NULL DEFAULT 0,
        result_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    safeAlter('ALTER TABLE pending_scans ADD COLUMN reg_id TEXT');
    safeAlter('ALTER TABLE pending_scans ADD COLUMN workshop_id TEXT');
    safeAlter('ALTER TABLE pending_scans ADD COLUMN result_code TEXT');
    safeAlter('ALTER TABLE pending_scans ADD COLUMN error_message TEXT');

    const [storedAuth, storedApiBaseUrl, storedDeviceId, storedJwks] = await Promise.all([
      SecureStore.getItemAsync(AUTH_STORAGE_KEY),
      AsyncStorage.getItem(API_BASE_STORAGE_KEY),
      AsyncStorage.getItem(DEVICE_ID_STORAGE_KEY),
      AsyncStorage.getItem(JWKS_STORAGE_KEY),
    ]);

    if (storedApiBaseUrl) setApiBaseUrl(storedApiBaseUrl);
    if (storedAuth) setAuth(JSON.parse(storedAuth) as AuthState);
    if (storedJwks) setJwks(JSON.parse(storedJwks) as JwksState);

    const nextDeviceId = storedDeviceId ?? `mobile-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    if (!storedDeviceId) await AsyncStorage.setItem(DEVICE_ID_STORAGE_KEY, nextDeviceId);
    setDeviceId(nextDeviceId);
    await reloadPending();
  }

  function safeAlter(sql: string) {
    try {
      db.execSync(sql);
    } catch {
      // Column already exists.
    }
  }

  async function reloadPending() {
    const rows = await db.getAllAsync<PendingScan>(
      `SELECT
        idempotency_key as idempotencyKey,
        qr_token as qrToken,
        reg_id as regId,
        workshop_id as workshopId,
        scanned_at as scannedAt,
        device_id as deviceId,
        synced,
        result_code as resultCode,
        error_message as errorMessage
       FROM pending_scans
       ORDER BY created_at DESC`,
    );
    setPending(rows);
  }

  async function login() {
    setBusy(true);
    try {
      await AsyncStorage.setItem(API_BASE_STORAGE_KEY, apiBaseUrl);
      const base = apiBaseUrl.replace(/\/$/, '');
      const res = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.message ?? body?.code ?? 'login_failed');
      const roles = body.roles ?? [];
      if (!roles.includes('CHECKIN_STAFF') && !roles.includes('SYS_ADMIN')) {
        throw new Error('Account does not have CHECKIN_STAFF permission.');
      }

      const nextAuth: AuthState = {
        accessToken: body.accessToken,
        refreshToken: body.refreshToken,
        fullName: body.fullName,
      };
      await SecureStore.setItemAsync(AUTH_STORAGE_KEY, JSON.stringify(nextAuth));
      setAuth(nextAuth);

      const nextJwks = await fetchJwks();
      setJwks(nextJwks);
      Alert.alert('Login complete', 'Public key cached for offline QR verification.');
    } catch (error) {
      Alert.alert('Login failed', (error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function fetchJwks(): Promise<JwksState> {
    const res = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/auth/jwks`);
    const body = await res.json();
    if (!res.ok) throw new Error(body?.message ?? body?.code ?? 'jwks_fetch_failed');
    const next: JwksState = {
      alg: 'RS256',
      issuer: body.issuer,
      publicKey: body.publicKey,
      fetchedAt: new Date().toISOString(),
    };
    await AsyncStorage.setItem(JWKS_STORAGE_KEY, JSON.stringify(next));
    return next;
  }

  async function refreshJwks() {
    setBusy(true);
    try {
      const next = await fetchJwks();
      setJwks(next);
      Alert.alert('Public key refreshed', `Issuer: ${next.issuer}`);
    } catch (error) {
      Alert.alert('Refresh failed', (error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    if (pendingCount > 0) {
      const ok = await confirmAsync(
        'Pending queue',
        `${pendingCount} scan(s) are not synced yet. Logout anyway?`,
        'Logout',
      );
      if (!ok) return;
    }
    await SecureStore.deleteItemAsync(AUTH_STORAGE_KEY);
    setAuth(null);
  }

  async function queueScan(tokenInput = qrToken) {
    const token = tokenInput.trim();
    if (!token) return;

    let payload: QrPayload;
    try {
      payload = verifyQrOffline(token);
    } catch (error) {
      Alert.alert('Invalid QR', (error as Error).message);
      return;
    }

    if (auth && isOnline) {
      const canQueue = await verifyOnlineBeforeQueue(payload);
      if (!canQueue) return;
    }

    const scannedAt = new Date().toISOString();
    const scannedMs = new Date(scannedAt).getTime();
    const idempotencyKey = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      `${payload.regId}${deviceId}${scannedMs}`,
    );

    await db.runAsync(
      `INSERT OR IGNORE INTO pending_scans
       (idempotency_key, qr_token, reg_id, workshop_id, scanned_at, device_id, synced, result_code)
       VALUES (?, ?, ?, ?, ?, ?, 0, NULL)`,
      [idempotencyKey, token, payload.regId, payload.workshopId, scannedAt, deviceId],
    );
    setQrToken('');
    setScannerOpen(false);
    await reloadPending();
    setLastSyncMessage(`Queued ${payload.regId.slice(0, 8)} at ${new Date(scannedAt).toLocaleTimeString()}`);

    if (auth && isOnline) {
      void syncPending(true);
    }
  }

  function verifyQrOffline(token: string): QrPayload {
    if (!jwks) {
      throw new Error('No cached public key. Login online once before offline check-in.');
    }

    let parsed: { headerObj?: { alg?: string }; payloadObj?: QrPayload };
    try {
      parsed = KJUR.jws.JWS.parse(token) as { headerObj?: { alg?: string }; payloadObj?: QrPayload };
    } catch {
      throw new Error('Malformed QR token.');
    }

    if (parsed.headerObj?.alg !== 'RS256') {
      throw new Error('Unexpected QR algorithm.');
    }
    const payload = parsed.payloadObj;
    if (!payload?.regId || !payload.workshopId || !payload.validFrom || !payload.validTo) {
      throw new Error('QR token is missing required fields.');
    }

    const ok = KJUR.jws.JWS.verifyJWT(token, jwks.publicKey, {
      alg: ['RS256'],
      iss: [jwks.issuer],
      verifyAt: Math.floor(Date.now() / 1000),
    });
    if (!ok) {
      throw new Error('QR signature is invalid or token is expired.');
    }

    const now = Date.now();
    if (now < payload.validFrom * 1000) throw new Error('QR is not valid yet.');
    if (now > payload.validTo * 1000 + POST_END_GRACE_MS) throw new Error('QR is expired.');
    return payload;
  }

  async function verifyOnlineBeforeQueue(payload: QrPayload): Promise<boolean> {
    try {
      const res = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/registrations/${payload.regId}/verify`, {
        headers: { Authorization: `Bearer ${auth?.accessToken}` },
      });
      const body = await res.json();
      if (res.ok) {
        if (body?.alreadyCheckedIn) {
          return confirmAsync('Duplicate check-in', 'This registration is already checked in. Queue scan anyway?', 'Queue');
        }
        return true;
      }
      return confirmAsync(
        'Assignment warning',
        `${body?.message ?? body?.code ?? 'verify_failed'}\nQueue scan anyway?`,
        'Queue',
      );
    } catch {
      return true;
    }
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

  async function syncPending(silent = false) {
    if (!auth || syncingRef.current) return;
    const unsynced = await db.getAllAsync<PendingScan>(
      `SELECT
        idempotency_key as idempotencyKey,
        qr_token as qrToken,
        reg_id as regId,
        workshop_id as workshopId,
        scanned_at as scannedAt,
        device_id as deviceId,
        synced,
        result_code as resultCode,
        error_message as errorMessage
       FROM pending_scans
       WHERE synced = 0
       ORDER BY created_at ASC
       LIMIT 100`,
    );
    if (unsynced.length === 0) return;

    syncingRef.current = true;
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
      const body = (await res.json()) as BatchResponse & { code?: string; message?: string };
      if (!res.ok) throw new Error(body?.message ?? body?.code ?? 'sync_failed');

      const accepted = body.accepted ?? [];
      const duplicates = body.duplicates ?? [];
      const invalid = body.invalid ?? [];

      for (const item of [...accepted, ...duplicates]) {
        await markResult(item, true);
      }
      for (const item of invalid) {
        await markResult(item, item.result !== 'unknown_error');
      }

      await reloadPending();
      const message = `Sync: ${accepted.length} accepted, ${duplicates.length} duplicate, ${invalid.length} invalid`;
      setLastSyncMessage(message);
      if (!silent) Alert.alert('Sync complete', message);
    } catch (error) {
      const message = `${(error as Error).message}. Scans stay in SQLite and will retry.`;
      setLastSyncMessage(message);
      if (!silent) Alert.alert('Sync failed', message);
    } finally {
      syncingRef.current = false;
      setBusy(false);
    }
  }

  async function markResult(item: BatchItemResult, synced: boolean) {
    await db.runAsync(
      `UPDATE pending_scans
       SET synced = ?, result_code = ?, error_message = ?
       WHERE idempotency_key = ?`,
      [
        synced ? 1 : 0,
        item.result,
        item.message ?? null,
        item.idempotencyKey,
      ],
    );
  }

  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>UniHub Check-in</Text>
          <Text style={styles.subtitle}>{auth ? auth.fullName ?? 'Check-in staff' : 'Staff login'}</Text>
        </View>
        <View style={[styles.statusPill, isOnline ? styles.online : styles.offline]}>
          <Text style={styles.statusText}>{isOnline ? 'Online' : isOnline === false ? 'Offline' : 'Network'}</Text>
        </View>
      </View>

      {!auth ? (
        <View style={styles.panel}>
          <TextInput value={apiBaseUrl} onChangeText={setApiBaseUrl} style={styles.input} autoCapitalize="none" />
          <TextInput value={email} onChangeText={setEmail} style={styles.input} autoCapitalize="none" />
          <TextInput value={password} onChangeText={setPassword} style={styles.input} secureTextEntry />
          <ActionButton label="Login + cache public key" onPress={login} disabled={busy} />
        </View>
      ) : (
        <View style={styles.panel}>
          <View style={styles.metaPanel}>
            <Text style={styles.metaText}>Device: {deviceId}</Text>
            <Text style={styles.metaText}>
              Public key: {jwks ? `${jwks.issuer}, ${new Date(jwks.fetchedAt).toLocaleString()}` : 'not cached'}
            </Text>
            <Text style={styles.metaText}>Last sync: {lastSyncMessage}</Text>
          </View>

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
            <ActionButton label={`Sync ${pendingCount}`} onPress={() => syncPending(false)} disabled={busy || pendingCount === 0} />
            <ActionButton label="Refresh key" onPress={refreshJwks} disabled={busy || !isOnline} />
          </View>
          <Pressable onPress={logout} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Logout</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.listHeader}>
        <Text style={styles.sectionTitle}>Local Queue</Text>
        <Text style={styles.queueText}>
          {pendingCount} pending / {completedCount} done
        </Text>
        {busy ? <ActivityIndicator /> : null}
      </View>
      <FlatList
        data={pending}
        keyExtractor={(item) => item.idempotencyKey}
        renderItem={({ item }) => (
          <View style={styles.scanItem}>
            <Text style={styles.scanTitle}>{item.resultCode ?? (item.synced ? 'synced' : 'pending')}</Text>
            <Text style={styles.scanMeta}>{new Date(item.scannedAt).toLocaleString()}</Text>
            <Text style={styles.scanMeta}>reg={item.regId ?? 'unknown'}</Text>
            {item.errorMessage ? <Text style={styles.errorText}>{item.errorMessage}</Text> : null}
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

function confirmAsync(title: string, message: string, confirmLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f8fafc', padding: 16 },
  header: { marginBottom: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  title: { color: '#0f172a', fontSize: 28, fontWeight: '700' },
  subtitle: { color: '#475569', marginTop: 4 },
  statusPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  online: { backgroundColor: '#dcfce7' },
  offline: { backgroundColor: '#fee2e2' },
  statusText: { color: '#0f172a', fontSize: 12, fontWeight: '700' },
  panel: { gap: 10, marginBottom: 18 },
  metaPanel: { backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderWidth: 1, borderRadius: 8, padding: 10, gap: 4 },
  metaText: { color: '#475569', fontSize: 12 },
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
  listHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8 },
  sectionTitle: { color: '#0f172a', fontSize: 18, fontWeight: '700' },
  queueText: { color: '#475569', fontSize: 12 },
  scanItem: {
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  scanTitle: { color: '#0f172a', fontWeight: '700' },
  scanMeta: { color: '#64748b', marginTop: 4 },
  scanKey: { color: '#475569', marginTop: 6, fontSize: 11 },
  errorText: { color: '#b91c1c', marginTop: 4, fontSize: 12 },
});
