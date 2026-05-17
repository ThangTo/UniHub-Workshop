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
  InputAccessoryView,
  Keyboard,
  Platform,
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

type QrValidationErrorCode =
  | 'missing_key'
  | 'malformed'
  | 'unexpected_alg'
  | 'missing_fields'
  | 'invalid_signature_or_expired'
  | 'not_yet_valid'
  | 'expired';

class QrValidationError extends Error {
  constructor(
    public readonly code: QrValidationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'QrValidationError';
  }
}

const { KJUR } = jsrsasign;

const DEFAULT_API_BASE_URL = 'http://localhost:3000';
const AUTH_STORAGE_KEY = 'unihub.mobile.auth';
const API_BASE_STORAGE_KEY = 'unihub.mobile.apiBaseUrl';
const DEVICE_ID_STORAGE_KEY = 'unihub.mobile.deviceId';
const JWKS_STORAGE_KEY = 'unihub.mobile.jwks';
const POST_END_GRACE_MS = 60 * 60 * 1000;
const QR_TOKEN_INPUT_ACCESSORY_ID = 'qr-token-input-accessory';

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
  const [lastQrError, setLastQrError] = useState<string | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const syncingRef = useRef(false);
  const scanInFlightRef = useRef(false);
  const lastCameraTokenRef = useRef<{ token: string; at: number } | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    return () => clearSyncRetry();
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

  function clearSyncRetry() {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }

  function scheduleSyncRetry() {
    if (retryTimerRef.current) return;
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      void syncPending(true);
    }, 30_000);
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

  async function queueScan(tokenInput = qrToken, source: 'manual' | 'camera' = 'manual') {
    const token = tokenInput.trim();
    if (!token) return;

    if (source === 'camera') {
      const now = Date.now();
      const last = lastCameraTokenRef.current;
      if (scanInFlightRef.current || (last?.token === token && now - last.at < 3000)) {
        return;
      }
      scanInFlightRef.current = true;
      lastCameraTokenRef.current = { token, at: now };
    }

    try {
      const payload = await verifyQrWithOptionalKeyRefresh(token);

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
      setLastQrError(null);
      await reloadPending();
      const queueMessage = `Queued ${payload.regId.slice(0, 8)} at ${new Date(scannedAt).toLocaleTimeString()}`;
      setLastSyncMessage(queueMessage);
      if (isOnline === false) {
        Alert.alert(
          'Offline scan queued',
          'QR signature is valid and the scan is saved locally. Room assignment will be checked when sync runs.',
        );
      }

      if (auth && isOnline) {
        void syncPending(true);
      }
    } catch (error) {
      const detail = describeQrError(error);
      setLastQrError(`${detail.title}: ${detail.message}`);
      if (source === 'camera') setScannerOpen(false);
      Alert.alert(detail.title, detail.message);
      return;
    } finally {
      if (source === 'camera') {
        setTimeout(() => {
          scanInFlightRef.current = false;
        }, 1200);
      }
    }
  }

  async function verifyQrWithOptionalKeyRefresh(token: string): Promise<QrPayload> {
    try {
      return verifyQrOffline(token);
    } catch (error) {
      if (
        error instanceof QrValidationError &&
        error.code === 'invalid_signature_or_expired' &&
        auth &&
        isOnline
      ) {
        const nextJwks = await fetchJwks();
        setJwks(nextJwks);
        setLastSyncMessage('Public key refreshed after QR signature mismatch.');
        return verifyQrOffline(token, nextJwks);
      }
      throw error;
    }
  }

  function verifyQrOffline(token: string, keySet = jwks): QrPayload {
    if (!keySet) {
      throw new QrValidationError(
        'missing_key',
        'No cached public key. Login online once, then scan again.',
      );
    }

    let parsed: { headerObj?: { alg?: string }; payloadObj?: QrPayload };
    try {
      parsed = KJUR.jws.JWS.parse(token) as { headerObj?: { alg?: string }; payloadObj?: QrPayload };
    } catch {
      throw new QrValidationError('malformed', 'This QR is not a UniHub check-in token.');
    }

    if (parsed.headerObj?.alg !== 'RS256') {
      throw new QrValidationError(
        'unexpected_alg',
        `Unexpected QR algorithm: ${parsed.headerObj?.alg ?? 'missing'}.`,
      );
    }
    const payload = parsed.payloadObj;
    if (!payload?.regId || !payload.workshopId || !payload.validFrom || !payload.validTo) {
      throw new QrValidationError('missing_fields', 'QR token is missing registration or validity fields.');
    }

    const ok = KJUR.jws.JWS.verifyJWT(token, keySet.publicKey, {
      alg: ['RS256'],
      iss: [keySet.issuer],
      verifyAt: Math.floor(Date.now() / 1000),
    });
    if (!ok) {
      throw new QrValidationError(
        'invalid_signature_or_expired',
        'QR signature does not match the cached public key, or the JWT has expired. The app tried to refresh the key if online.',
      );
    }

    const now = Date.now();
    if (now < payload.validFrom * 1000) {
      throw new QrValidationError(
        'not_yet_valid',
        `QR is not valid yet. It opens at ${formatQrTime(payload.validFrom)}.`,
      );
    }
    if (now > payload.validTo * 1000 + POST_END_GRACE_MS) {
      throw new QrValidationError(
        'expired',
        `QR is expired. It closed at ${formatQrTime((payload.validTo * 1000 + POST_END_GRACE_MS) / 1000)}.`,
      );
    }
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
      const code = String(body?.code ?? body?.message ?? 'verify_failed');
      if (code === 'not_assigned' || code === 'wrong_room') {
        return confirmAsync(
          'Room assignment warning',
          'This staff account is not assigned to the workshop room for this QR. Queue anyway?',
          'Queue anyway',
        );
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
    scanInFlightRef.current = false;
    lastCameraTokenRef.current = null;
    setLastQrError(null);
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
    if (unsynced.length === 0) {
      clearSyncRetry();
      return;
    }

    syncingRef.current = true;
    setBusy(true);
    try {
      const batchKey = await stableBatchKey(unsynced);
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
      const assignmentWarnings = invalid.filter((item) => (
        item.result === 'not_assigned' || item.result === 'wrong_room'
      ));
      if (invalid.some((item) => item.result === 'unknown_error')) {
        scheduleSyncRetry();
      } else {
        clearSyncRetry();
      }
      if (!silent) {
        Alert.alert(
          assignmentWarnings.length > 0 ? 'Sync complete with assignment warnings' : 'Sync complete',
          assignmentWarnings.length > 0
            ? `${message}\n${assignmentWarnings.length} scan(s) are not assigned to this staff/room.`
            : message,
        );
      }
    } catch (error) {
      const message = `${(error as Error).message}. Scans stay in SQLite and will retry.`;
      setLastSyncMessage(message);
      scheduleSyncRetry();
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

  async function stableBatchKey(items: PendingScan[]): Promise<string> {
    const canonical = items.map((item) => item.idempotencyKey).join('|');
    return Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      `checkin-batch:${canonical}`,
    );
  }

  return (
    <SafeAreaView style={styles.page}>
      {!auth ? (
        <View style={styles.loginContainer}>
          <View style={styles.loginHeader}>
            <Text style={styles.title}>UniHub Check-in</Text>
            <Text style={styles.subtitle}>Login once to cache the public key, then scan QR codes online or offline.</Text>
          </View>
          <View style={styles.loginCard}>
            <View style={[styles.statusPill, isOnline ? styles.online : styles.offline]}>
              <Text style={styles.statusText}>{isOnline ? 'Online' : isOnline === false ? 'Offline' : 'Network'}</Text>
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Backend API URL</Text>
              <TextInput
                value={apiBaseUrl}
                onChangeText={setApiBaseUrl}
                style={styles.input}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder="http://192.168.1.23:3000"
                placeholderTextColor="#94a3b8"
              />
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Staff email</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                style={styles.input}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                placeholder="staff@unihub.local"
                placeholderTextColor="#94a3b8"
              />
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Password</Text>
              <TextInput
                value={password}
                onChangeText={setPassword}
                style={styles.input}
                secureTextEntry
                placeholder="Test@12345"
                placeholderTextColor="#94a3b8"
              />
            </View>
            <ActionButton label={busy ? 'Logging in...' : 'Login and Cache Key'} onPress={login} disabled={busy} />
            <Text style={styles.helpText}>Use your computer IPv4 address for a real phone. Android emulator uses 10.0.2.2.</Text>
          </View>
        </View>
      ) : (
        <>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>UniHub Check-in</Text>
              <Text style={styles.subtitle}>{auth.fullName ?? 'Check-in staff'}</Text>
            </View>
            <View style={[styles.statusPill, isOnline ? styles.online : styles.offline]}>
              <Text style={styles.statusText}>{isOnline ? 'Online' : isOnline === false ? 'Offline' : 'Network'}</Text>
            </View>
          </View>

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
                    if (!busy && data) void queueScan(data, 'camera');
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
              autoCorrect={false}
              blurOnSubmit
              inputAccessoryViewID={Platform.OS === 'ios' ? QR_TOKEN_INPUT_ACCESSORY_ID : undefined}
              multiline
              onSubmitEditing={() => Keyboard.dismiss()}
              placeholder="Paste QR token"
              placeholderTextColor="#94a3b8"
              returnKeyType="done"
            />
            {Platform.OS === 'ios' ? (
              <InputAccessoryView nativeID={QR_TOKEN_INPUT_ACCESSORY_ID}>
                <View style={styles.keyboardAccessory}>
                  <Pressable onPress={() => Keyboard.dismiss()} style={styles.keyboardDoneButton}>
                    <Text style={styles.keyboardDoneText}>Done</Text>
                  </Pressable>
                </View>
              </InputAccessoryView>
            ) : null}
            {lastQrError ? <Text style={styles.errorText}>{lastQrError}</Text> : null}
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
        </>
      )}
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

function describeQrError(error: unknown): { title: string; message: string } {
  if (error instanceof QrValidationError) {
    switch (error.code) {
      case 'missing_key':
        return { title: 'Public key not cached', message: error.message };
      case 'malformed':
        return { title: 'Not a UniHub QR', message: error.message };
      case 'unexpected_alg':
      case 'missing_fields':
        return { title: 'Unsupported QR token', message: error.message };
      case 'invalid_signature_or_expired':
        return { title: 'QR signature mismatch', message: error.message };
      case 'not_yet_valid':
        return { title: 'QR not valid yet', message: error.message };
      case 'expired':
        return { title: 'QR expired', message: error.message };
    }
  }
  return {
    title: 'QR check failed',
    message: error instanceof Error ? error.message : 'Unknown QR validation error.',
  };
}

function formatQrTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString();
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f0f4f8', paddingHorizontal: 20, paddingTop: 12 },
  loginContainer: { flex: 1, justifyContent: 'center', paddingBottom: 36 },
  loginHeader: { marginBottom: 22, paddingHorizontal: 4 },
  loginCard: {
    gap: 16,
    backgroundColor: '#ffffff',
    padding: 22,
    borderRadius: 24,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 6,
  },
  fieldGroup: { gap: 8 },
  helpText: { color: '#64748b', fontSize: 13, lineHeight: 18, textAlign: 'center' },
  header: { marginBottom: 24, paddingTop: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  title: { color: '#0f172a', fontSize: 30, fontWeight: '800', letterSpacing: 0 },
  subtitle: { color: '#64748b', marginTop: 8, fontSize: 15, fontWeight: '500', lineHeight: 21 },
  statusPill: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  online: { backgroundColor: '#dcfce7', borderWidth: 1, borderColor: '#bbf7d0' },
  offline: { backgroundColor: '#fee2e2', borderWidth: 1, borderColor: '#fecaca' },
  statusText: { color: '#0f172a', fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  panel: { gap: 14, marginBottom: 24, backgroundColor: '#ffffff', padding: 20, borderRadius: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.06, shadowRadius: 16, elevation: 4 },
  label: { color: '#334155', fontSize: 13, fontWeight: '700', marginLeft: 4, textTransform: 'uppercase', letterSpacing: 0 },
  metaPanel: { backgroundColor: '#f8fafc', borderColor: '#e2e8f0', borderWidth: 1, borderRadius: 16, padding: 14, gap: 6 },
  metaText: { color: '#475569', fontSize: 13, fontWeight: '500' },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 16,
    backgroundColor: '#ffffff',
    color: '#0f172a',
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.02, shadowRadius: 4, elevation: 1
  },
  qrInput: { minHeight: 100, textAlignVertical: 'top' },
  keyboardAccessory: {
    minHeight: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
    borderTopColor: '#cbd5e1',
    borderTopWidth: 1,
    paddingHorizontal: 12,
  },
  keyboardDoneButton: { paddingHorizontal: 12, paddingVertical: 8 },
  keyboardDoneText: { color: '#0f766e', fontSize: 16, fontWeight: '800' },
  cameraFrame: { borderRadius: 16, overflow: 'hidden', backgroundColor: '#0f172a', borderWidth: 1, borderColor: '#e2e8f0' },
  camera: { height: 300 },
  row: { flexDirection: 'row', gap: 12 },
  button: { flex: 1, minHeight: 52, justifyContent: 'center', backgroundColor: '#0f766e', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 15, alignItems: 'center', shadowColor: '#0f766e', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5 },
  buttonDisabled: { backgroundColor: '#94a3b8', shadowOpacity: 0 },
  buttonText: { color: '#ffffff', fontWeight: '800', fontSize: 15, letterSpacing: 0, textAlign: 'center' },
  secondaryButton: { alignItems: 'center', padding: 12, marginTop: 4 },
  secondaryButtonText: { color: '#475569', fontWeight: '700', fontSize: 15 },
  listHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8, paddingHorizontal: 4 },
  sectionTitle: { color: '#0f172a', fontSize: 20, fontWeight: '800' },
  queueText: { color: '#64748b', fontSize: 14, fontWeight: '600', backgroundColor: '#e2e8f0', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  scanItem: {
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.03, shadowRadius: 8, elevation: 2
  },
  scanTitle: { color: '#0f172a', fontWeight: '800', fontSize: 15, textTransform: 'uppercase' },
  scanMeta: { color: '#64748b', marginTop: 6, fontSize: 13, fontWeight: '500' },
  scanKey: { color: '#94a3b8', marginTop: 8, fontSize: 11, fontFamily: 'monospace' },
  errorText: { color: '#dc2626', marginTop: 6, fontSize: 13, fontWeight: '600', backgroundColor: '#fef2f2', padding: 8, borderRadius: 8, overflow: 'hidden' },
});
