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
  InputAccessoryView,
  Keyboard,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

type AppPage = 'workshops' | 'info' | 'checkin' | 'students' | 'queue' | 'staff';

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
  userId?: string;
  fullName?: string;
  email?: string;
  roles?: string[];
};

type StaffProfile = {
  id: string;
  email: string;
  fullName: string;
  phone?: string | null;
  roles: string[];
  createdAt?: string;
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

type AssignedWorkshop = {
  id: string;
  title: string;
  description?: string | null;
  startAt: string;
  endAt: string;
  status: string;
  roomName?: string | null;
  roomCode?: string | null;
  speakerName?: string | null;
  assignmentStartsAt?: string | null;
  assignmentEndsAt?: string | null;
};

type StaffWorkshopsResponse = {
  items: AssignedWorkshop[];
};

type StudentCheckinRow = {
  registrationId: string;
  studentId: string;
  studentName: string;
  studentCode?: string | null;
  email?: string | null;
  registrationStatus: string;
  qrStatus: 'CONFIRMED' | 'NOT_CONFIRMED';
  checkedInAt?: string | null;
  checkedBy?: string | null;
  deviceId?: string | null;
};

type WorkshopStudentsResponse = {
  items: StudentCheckinRow[];
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
  const { width } = useWindowDimensions();
  const isCompact = width < 760;
  const [apiBaseUrl, setApiBaseUrl] = useState(DEFAULT_API_BASE_URL);
  const [email, setEmail] = useState('staff@unihub.local');
  const [password, setPassword] = useState('Test@12345');
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [staffProfile, setStaffProfile] = useState<StaffProfile | null>(null);
  const [jwks, setJwks] = useState<JwksState | null>(null);
  const [qrToken, setQrToken] = useState('');
  const [pending, setPending] = useState<PendingScan[]>([]);
  const [busy, setBusy] = useState(false);
  const [deviceId, setDeviceId] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [isOnline, setIsOnline] = useState<boolean | null>(null);
  const [lastSyncMessage, setLastSyncMessage] = useState('No sync yet');
  const [lastQrError, setLastQrError] = useState<string | null>(null);
  const [activePage, setActivePage] = useState<AppPage>('workshops');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const isMenuConstrained = isCompact && sidebarOpen;
  const forceSingleColumn = isCompact || isMenuConstrained;
  const [staffWorkshops, setStaffWorkshops] = useState<AssignedWorkshop[]>([]);
  const [selectedWorkshopId, setSelectedWorkshopId] = useState<string | null>(null);
  const [studentRows, setStudentRows] = useState<StudentCheckinRow[]>([]);
  const [studentRowsWorkshopId, setStudentRowsWorkshopId] = useState<string | null>(null);
  const [staffDataLoading, setStaffDataLoading] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const syncingRef = useRef(false);
  const scanInFlightRef = useRef(false);
  const lastCameraTokenRef = useRef<{ token: string; at: number } | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedWorkshopIdRef = useRef<string | null>(null);
  const studentsLoadSeqRef = useRef(0);

  const pendingCount = useMemo(
    () => pending.filter((item) => item.synced === 0).length,
    [pending],
  );
  const completedCount = useMemo(
    () => pending.filter((item) => item.synced === 1).length,
    [pending],
  );
  const selectedWorkshop = useMemo(
    () => staffWorkshops.find((workshop) => workshop.id === selectedWorkshopId) ?? null,
    [staffWorkshops, selectedWorkshopId],
  );
  const visibleStudentRows = useMemo(
    () => (studentRowsWorkshopId === selectedWorkshopId ? studentRows : []),
    [studentRows, studentRowsWorkshopId, selectedWorkshopId],
  );
  const confirmedStudents = useMemo(
    () => visibleStudentRows.filter((student) => student.qrStatus === 'CONFIRMED').length,
    [visibleStudentRows],
  );

  useEffect(() => {
    void bootstrap();
    return () => clearSyncRetry();
  }, []);

  useEffect(() => {
    setSidebarOpen(true);
  }, [isCompact]);

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

  useEffect(() => {
    if (auth && isOnline !== false) {
      void loadStaffProfile(true);
      void loadStaffWorkshops(true);
    }
  }, [auth?.accessToken, apiBaseUrl, isOnline]);

  useEffect(() => {
    selectedWorkshopIdRef.current = selectedWorkshopId;
    studentsLoadSeqRef.current += 1;
    setStudentRows([]);
    setStudentRowsWorkshopId(selectedWorkshopId);
  }, [selectedWorkshopId]);

  useEffect(() => {
    selectedWorkshopIdRef.current = selectedWorkshopId;
    if (auth && selectedWorkshopId && isOnline !== false) {
      void loadWorkshopStudents(selectedWorkshopId, true);
    }
  }, [auth?.accessToken, apiBaseUrl, selectedWorkshopId, isOnline]);

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
        userId: body.userId,
        fullName: body.fullName,
        email,
        roles,
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

  async function loadStaffProfile(silent = false, authOverride = auth) {
    if (!authOverride) return;
    setProfileLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/auth/me`, {
        headers: { Authorization: `Bearer ${authOverride.accessToken}` },
      });
      const body = (await res.json()) as StaffProfile & { code?: string; message?: string };
      if (!res.ok) throw new Error(body?.message ?? body?.code ?? 'load_staff_profile_failed');
      setStaffProfile(body);
    } catch (error) {
      if (!silent) Alert.alert('Load staff failed', (error as Error).message);
    } finally {
      setProfileLoading(false);
    }
  }

  async function loadStaffWorkshops(silent = false) {
    if (!auth) return;
    setStaffDataLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/checkin/my-workshops`, {
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      });
      const body = (await res.json()) as StaffWorkshopsResponse & { code?: string; message?: string };
      if (!res.ok) throw new Error(body?.message ?? body?.code ?? 'load_workshops_failed');
      setStaffWorkshops(body.items ?? []);
      setSelectedWorkshopId((current) => {
        if (current && body.items?.some((workshop) => workshop.id === current)) return current;
        return body.items?.[0]?.id ?? null;
      });
    } catch (error) {
      if (!silent) Alert.alert('Load workshops failed', (error as Error).message);
    } finally {
      setStaffDataLoading(false);
    }
  }

  async function loadWorkshopStudents(workshopId = selectedWorkshopId, silent = false) {
    if (!auth || !workshopId) {
      setStudentRows([]);
      setStudentRowsWorkshopId(null);
      return;
    }
    const targetWorkshopId = workshopId;
    const loadSeq = ++studentsLoadSeqRef.current;
    setStaffDataLoading(true);
    try {
      const res = await fetch(
        `${apiBaseUrl.replace(/\/$/, '')}/checkin/workshops/${targetWorkshopId}/students`,
        { headers: { Authorization: `Bearer ${auth.accessToken}` } },
      );
      const body = (await res.json()) as WorkshopStudentsResponse & { code?: string; message?: string };
      if (!res.ok) throw new Error(body?.message ?? body?.code ?? 'load_students_failed');
      if (loadSeq === studentsLoadSeqRef.current && selectedWorkshopIdRef.current === targetWorkshopId) {
        setStudentRows(body.items ?? []);
        setStudentRowsWorkshopId(targetWorkshopId);
      }
    } catch (error) {
      if (loadSeq === studentsLoadSeqRef.current && selectedWorkshopIdRef.current === targetWorkshopId) {
        setStudentRows([]);
        setStudentRowsWorkshopId(targetWorkshopId);
      }
      if (!silent) Alert.alert('Load students failed', (error as Error).message);
    } finally {
      if (loadSeq === studentsLoadSeqRef.current) {
        setStaffDataLoading(false);
      }
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
    setActivePage('workshops');
    setStaffProfile(null);
    setStaffWorkshops([]);
    setSelectedWorkshopId(null);
    setStudentRows([]);
    setStudentRowsWorkshopId(null);
  }

  async function queueScan(tokenInput = qrToken, source: 'manual' | 'camera' = 'manual') {
    const token = extractJwtToken(tokenInput);
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
    const normalizedToken = extractJwtToken(token);
    if (!keySet) {
      throw new QrValidationError(
        'missing_key',
        'No cached public key. Login online once, then scan again.',
      );
    }

    let parsed: { headerObj?: { alg?: string }; payloadObj?: QrPayload };
    try {
      parsed = KJUR.jws.JWS.parse(normalizedToken) as { headerObj?: { alg?: string }; payloadObj?: QrPayload };
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

    if (payload.iss && payload.iss !== keySet.issuer) {
      throw new QrValidationError(
        'invalid_signature_or_expired',
        `QR issuer "${payload.iss}" does not match cached issuer "${keySet.issuer}".`,
      );
    }

    const ok = KJUR.jws.JWS.verify(normalizedToken, keySet.publicKey, ['RS256']);
    if (!ok) {
      throw new QrValidationError(
        'invalid_signature_or_expired',
        'QR signature does not match the cached public key. Refresh the key, then make sure this QR was generated by the same backend instance.',
      );
    }

    const now = Date.now();
    if (payload.exp && now > payload.exp * 1000 + POST_END_GRACE_MS) {
      throw new QrValidationError(
        'expired',
        `QR JWT is expired. It expired at ${formatQrTime(payload.exp)}.`,
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
      if (selectedWorkshopId && (accepted.length > 0 || duplicates.length > 0)) {
        void loadWorkshopStudents(selectedWorkshopId, true);
      }
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

  function selectPage(page: AppPage) {
    setActivePage(page);
  }

  return (
    <SafeAreaView style={[styles.page, isCompact ? styles.pageCompact : null]}>
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
        <View style={[styles.appShell, isCompact ? styles.appShellCompact : null]}>
          {sidebarOpen ? (
            <View style={[styles.sidebar, isCompact ? styles.sidebarCompact : null]}>
              <View style={styles.navGroup}>
                <Text style={styles.sidebarTitle}>Workshop</Text>
                <NavButton label="List workshop" active={activePage === 'workshops'} onPress={() => selectPage('workshops')} compact={isCompact} nested />
                <NavButton label="Thông tin" active={activePage === 'info'} onPress={() => selectPage('info')} compact={isCompact} nested />
                <NavButton label="Check-in" active={activePage === 'checkin'} onPress={() => selectPage('checkin')} compact={isCompact} nested />
                <NavButton label="Danh sách sinh viên" active={activePage === 'students'} onPress={() => selectPage('students')} compact={isCompact} nested />
                <NavButton label={`Queue ${pendingCount}`} active={activePage === 'queue'} onPress={() => selectPage('queue')} compact={isCompact} nested />
              </View>
              <View style={styles.navGroup}>
                <NavButton label="Thông tin nhân viên" active={activePage === 'staff'} onPress={() => selectPage('staff')} compact={isCompact} />
              </View>
              <Pressable onPress={logout} style={styles.sidebarLogout}>
                <Text style={styles.sidebarLogoutText}>Logout</Text>
              </Pressable>
            </View>
          ) : null}

          <View style={[styles.content, isMenuConstrained ? styles.contentConstrained : null]}>
            <View style={[styles.contentHeader, isCompact ? styles.contentHeaderCompact : null, isMenuConstrained ? styles.contentHeaderConstrained : null]}>
              <View style={[styles.headerTitleGroup, isMenuConstrained ? styles.headerTitleGroupConstrained : null]}>
                <Pressable onPress={() => setSidebarOpen((current) => !current)} style={styles.menuButton}>
                  <Text style={styles.menuButtonText}>{sidebarOpen ? (isMenuConstrained ? 'Ẩn' : 'Ẩn menu') : 'Menu'}</Text>
                </Pressable>
                <Text style={[styles.title, isCompact ? styles.titleCompact : null, isMenuConstrained ? styles.titleConstrained : null]}>UniHub Check-in</Text>
                <Text style={[styles.subtitle, isMenuConstrained ? styles.subtitleConstrained : null]}>{auth.fullName ?? 'Check-in staff'}</Text>
              </View>
              <View style={[styles.statusPill, isMenuConstrained ? styles.statusPillConstrained : null, isOnline ? styles.online : styles.offline]}>
                <Text style={styles.statusText}>{isOnline ? 'Online' : isOnline === false ? 'Offline' : 'Network'}</Text>
              </View>
            </View>

            <ScrollView
              style={styles.contentScroll}
              contentContainerStyle={styles.contentScrollInner}
              showsVerticalScrollIndicator
              indicatorStyle="black"
            >
            {activePage === 'workshops' ? (
              <View style={styles.pageSection}>
                <View style={styles.listHeader}>
                  <Text style={styles.sectionTitle}>Workshop được phân công</Text>
                  <Text style={styles.queueText}>{staffWorkshops.length}</Text>
                  {staffDataLoading ? <ActivityIndicator /> : null}
                </View>
                {staffWorkshops.length === 0 ? (
                  <Text style={styles.helpText}>Chưa có workshop nào được phân công cho tài khoản này.</Text>
                ) : (
                  staffWorkshops.map((item) => (
                    <Pressable
                      key={item.id}
                      onPress={() => setSelectedWorkshopId(item.id)}
                      style={[styles.workshopCard, isMenuConstrained ? styles.itemCompact : null, item.id === selectedWorkshopId ? styles.workshopCardActive : null]}
                    >
                      <Text style={styles.workshopCardTitle}>{item.title}</Text>
                      <Text style={styles.scanMeta}>
                        {new Date(item.startAt).toLocaleString()} - {new Date(item.endAt).toLocaleString()}
                      </Text>
                      <Text style={styles.scanMeta}>
                        Phòng: {item.roomCode ?? item.roomName ?? 'Chưa có'} | Diễn giả: {item.speakerName ?? 'Chưa có'}
                      </Text>
                      <Text style={styles.scanMeta}>Trạng thái: {item.status}</Text>
                    </Pressable>
                  ))
                )}
              </View>
            ) : null}

            {activePage === 'staff' ? (
              <View style={styles.pageSection}>
                <View style={styles.listHeader}>
                  <Text style={styles.sectionTitle}>Thông tin nhân viên</Text>
                  {profileLoading || staffDataLoading ? <ActivityIndicator /> : null}
                </View>
                <View style={[styles.panel, isCompact ? styles.panelCompact : null, isMenuConstrained ? styles.panelConstrained : null]}>
                  <Text style={styles.workshopTitle}>{staffProfile?.fullName ?? auth.fullName ?? 'Check-in staff'}</Text>
                  <Text style={styles.scanMeta}>Email: {staffProfile?.email ?? auth.email ?? email}</Text>
                  <Text style={styles.scanMeta}>User ID: {staffProfile?.id ?? auth.userId ?? 'Chưa tải'}</Text>
                  <Text style={styles.scanMeta}>Vai trò: {(staffProfile?.roles ?? auth.roles ?? ['CHECKIN_STAFF']).join(', ')}</Text>
                  {staffProfile?.phone ? <Text style={styles.scanMeta}>SĐT: {staffProfile.phone}</Text> : null}
                  <Text style={styles.scanMeta}>Device: {deviceId}</Text>
                  <Text style={styles.scanMeta}>Backend: {apiBaseUrl}</Text>
                  <View style={[styles.row, forceSingleColumn ? styles.rowSingleColumn : null]}>
                    <ActionButton label="Refresh staff" onPress={() => loadStaffProfile(false)} disabled={profileLoading || !isOnline} />
                    <ActionButton label="Refresh workshop" onPress={() => loadStaffWorkshops(false)} disabled={staffDataLoading || !isOnline} />
                  </View>
                </View>
              </View>
            ) : null}

            {activePage === 'info' ? (
              <View style={styles.pageSection}>
                <View style={styles.listHeader}>
                  <Text style={styles.sectionTitle}>Thông tin phân công</Text>
                  {staffDataLoading ? <ActivityIndicator /> : null}
                </View>
                <View style={[styles.panel, isCompact ? styles.panelCompact : null, isMenuConstrained ? styles.panelConstrained : null]}>
                  {selectedWorkshop ? (
                    <>
                      <Text style={styles.workshopTitle}>{selectedWorkshop.title}</Text>
                      <Text style={styles.scanMeta}>
                        {new Date(selectedWorkshop.startAt).toLocaleString()} - {new Date(selectedWorkshop.endAt).toLocaleString()}
                      </Text>
                      <Text style={styles.scanMeta}>
                        Phòng: {selectedWorkshop.roomCode ?? selectedWorkshop.roomName ?? 'Chưa có'} | Diễn giả: {selectedWorkshop.speakerName ?? 'Chưa có'}
                      </Text>
                      <Text style={styles.scanMeta}>Trạng thái: {selectedWorkshop.status}</Text>
                      {selectedWorkshop.assignmentStartsAt ? (
                        <Text style={styles.scanMeta}>
                          Ca phân công: {new Date(selectedWorkshop.assignmentStartsAt).toLocaleString()} - {new Date(selectedWorkshop.assignmentEndsAt ?? selectedWorkshop.endAt).toLocaleString()}
                        </Text>
                      ) : null}
                      {selectedWorkshop.description ? (
                        <Text style={styles.descriptionText}>{selectedWorkshop.description}</Text>
                      ) : null}
                    </>
                  ) : (
                    <Text style={styles.helpText}>Chưa có workshop nào được phân công cho tài khoản này.</Text>
                  )}
                  <View style={[styles.row, forceSingleColumn ? styles.rowSingleColumn : null]}>
                    <ActionButton label="Refresh" onPress={() => loadStaffWorkshops(false)} disabled={staffDataLoading || !isOnline} />
                    <ActionButton label="Load sinh viên" onPress={() => loadWorkshopStudents(undefined, false)} disabled={!selectedWorkshopId || staffDataLoading || !isOnline} />
                  </View>
                </View>

                {staffWorkshops.length > 1 ? (
                  staffWorkshops.map((item) => (
                      <Pressable
                        key={item.id}
                        onPress={() => setSelectedWorkshopId(item.id)}
                        style={[styles.workshopCard, isMenuConstrained ? styles.itemCompact : null, item.id === selectedWorkshopId ? styles.workshopCardActive : null]}
                      >
                        <Text style={styles.workshopCardTitle}>{item.title}</Text>
                        <Text style={styles.scanMeta}>{item.roomCode ?? item.roomName ?? 'Chưa có phòng'}</Text>
                      </Pressable>
                    ))
                ) : null}
              </View>
            ) : null}

            {activePage === 'checkin' ? (
              <View style={styles.pageSection}>
                <View style={[styles.panel, isCompact ? styles.panelCompact : null, isMenuConstrained ? styles.panelConstrained : null]}>
                  <View style={styles.metaPanel}>
                    <Text style={styles.metaText}>Workshop: {selectedWorkshop?.title ?? 'Chưa chọn'}</Text>
                    <Text style={styles.metaText}>Device: {deviceId}</Text>
                    <Text style={styles.metaText}>
                      Public key: {jwks ? `${jwks.issuer}, ${new Date(jwks.fetchedAt).toLocaleString()}` : 'not cached'}
                    </Text>
                    <Text style={styles.metaText}>Last sync: {lastSyncMessage}</Text>
                    <Text style={styles.metaText}>Demo mode: cho phép quét trước giờ workshop.</Text>
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
                  <View style={[styles.row, forceSingleColumn ? styles.rowSingleColumn : null]}>
                    <ActionButton label="Scan QR" onPress={openScanner} disabled={busy} />
                    <ActionButton label="Queue Token" onPress={() => queueScan()} disabled={busy || !qrToken.trim()} />
                  </View>
                  <View style={[styles.row, forceSingleColumn ? styles.rowSingleColumn : null]}>
                    <ActionButton label={`Sync ${pendingCount}`} onPress={() => syncPending(false)} disabled={busy || pendingCount === 0} />
                    <ActionButton label="Refresh key" onPress={refreshJwks} disabled={busy || !isOnline} />
                  </View>
                </View>
              </View>
            ) : null}

            {activePage === 'students' ? (
              <View style={styles.pageSection}>
                <View style={styles.listHeader}>
                  <View>
                    <Text style={styles.sectionTitle}>Danh sách sinh viên</Text>
                    <Text style={styles.scanMetaBreak}>Workshop: {selectedWorkshop?.title ?? 'Chưa chọn'}</Text>
                    <Text style={styles.scanMeta}>{confirmedStudents} xác nhận / {visibleStudentRows.length} đăng ký</Text>
                  </View>
                  {staffDataLoading ? <ActivityIndicator /> : null}
                </View>
                <View style={[styles.row, forceSingleColumn ? styles.rowSingleColumn : null]}>
                  <ActionButton label="Refresh" onPress={() => loadWorkshopStudents(undefined, false)} disabled={!selectedWorkshopId || staffDataLoading || !isOnline} />
                </View>
                {visibleStudentRows.length === 0 ? (
                  <Text style={styles.helpText}>
                    {selectedWorkshopId ? 'Chưa có sinh viên đăng ký hoặc chưa tải dữ liệu.' : 'Chọn workshop trong List workshop trước.'}
                  </Text>
                ) : (
                  visibleStudentRows.map((item) => (
                    <View key={item.registrationId} style={[styles.studentItem, isMenuConstrained ? styles.itemCompact : null]}>
                      <View style={styles.studentRow}>
                        <View style={styles.studentMain}>
                          <Text style={styles.scanTitle}>{item.studentName}</Text>
                          <Text style={styles.scanMeta}>{item.studentCode ?? item.email ?? item.studentId}</Text>
                          <Text style={styles.scanMeta}>Đăng ký: {item.registrationStatus}</Text>
                          {item.checkedInAt ? <Text style={styles.scanMeta}>Lúc quét: {new Date(item.checkedInAt).toLocaleString()}</Text> : null}
                        </View>
                        <View style={[styles.qrBadge, item.qrStatus === 'CONFIRMED' ? styles.qrBadgeOk : styles.qrBadgeWait]}>
                          <Text style={styles.qrBadgeText}>{item.qrStatus === 'CONFIRMED' ? 'Xác nhận' : 'Chưa xác nhận'}</Text>
                        </View>
                      </View>
                    </View>
                  ))
                )}
              </View>
            ) : null}

            {activePage === 'queue' ? (
              <View style={styles.pageSection}>
                <View style={styles.listHeader}>
                  <Text style={styles.sectionTitle}>Local Queue</Text>
                  <Text style={styles.queueText}>
                    {pendingCount} pending / {completedCount} done
                  </Text>
                  {busy ? <ActivityIndicator /> : null}
                </View>
                {pending.map((item) => (
                    <View key={item.idempotencyKey} style={[styles.scanItem, isMenuConstrained ? styles.itemCompact : null]}>
                      <Text style={styles.scanTitle}>{item.resultCode ?? (item.synced ? 'synced' : 'pending')}</Text>
                      <Text style={styles.scanMeta}>{new Date(item.scannedAt).toLocaleString()}</Text>
                      <Text style={styles.scanMeta}>reg={item.regId ?? 'unknown'}</Text>
                      {item.errorMessage ? <Text style={styles.errorText}>{item.errorMessage}</Text> : null}
                      <Text style={styles.scanKey}>{item.idempotencyKey}</Text>
                    </View>
                  ))}
              </View>
            ) : null}
            </ScrollView>
          </View>
        </View>
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

function NavButton(props: { label: string; active: boolean; onPress: () => void; compact?: boolean; nested?: boolean }) {
  return (
    <Pressable
      onPress={props.onPress}
      style={[
        styles.navButton,
        props.compact ? styles.navButtonCompact : null,
        props.nested ? styles.navButtonNested : null,
        props.active ? styles.navButtonActive : null,
      ]}
    >
      <Text style={[styles.navButtonText, props.compact ? styles.navButtonTextCompact : null, props.active ? styles.navButtonTextActive : null]}>
        {props.label}
      </Text>
    </Pressable>
  );
}

function extractJwtToken(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  return match?.[0] ?? trimmed;
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
  page: { flex: 1, width: '100%', backgroundColor: '#f0f4f8', paddingHorizontal: 20, paddingTop: 12 },
  pageCompact: { paddingHorizontal: 6, paddingTop: 8 },
  appShell: { flex: 1, width: '100%', flexDirection: 'row', gap: 12, overflow: 'hidden' },
  appShellCompact: { gap: 6 },
  sidebar: {
    width: 184,
    backgroundColor: '#0f172a',
    borderRadius: 18,
    padding: 12,
    gap: 14,
    marginBottom: 10,
    flexShrink: 0,
  },
  sidebarCompact: {
    width: 104,
    paddingHorizontal: 8,
    paddingVertical: 10,
    gap: 8,
  },
  sidebarTitle: { color: '#e2e8f0', fontSize: 13, fontWeight: '900', marginBottom: 4 },
  navGroup: { gap: 7 },
  sidebarLogout: {
    marginTop: 'auto',
    borderRadius: 12,
    backgroundColor: '#fee2e2',
    paddingHorizontal: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  sidebarLogoutText: { color: '#991b1b', fontSize: 13, fontWeight: '900' },
  navButton: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  navButtonCompact: { paddingHorizontal: 6, paddingVertical: 8 },
  navButtonNested: { marginLeft: 8, borderLeftWidth: 2, borderLeftColor: 'rgba(148,163,184,0.45)' },
  navButtonActive: { backgroundColor: '#14b8a6' },
  navButtonText: { color: '#cbd5e1', fontSize: 12, fontWeight: '800', lineHeight: 16 },
  navButtonTextCompact: { fontSize: 10.5, lineHeight: 14 },
  navButtonTextActive: { color: '#ffffff' },
  content: { flex: 1, flexBasis: 0, flexShrink: 1, minWidth: 0, maxWidth: '100%', overflow: 'hidden' },
  contentConstrained: { flexBasis: 0, flexShrink: 1, minWidth: 0 },
  contentScroll: { flex: 1, width: '100%', maxWidth: '100%' },
  contentScrollInner: { flexGrow: 1, minWidth: 0, paddingRight: 4, paddingBottom: 28 },
  contentHeader: { marginBottom: 14, paddingTop: 4, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' },
  contentHeaderCompact: { alignItems: 'stretch' },
  contentHeaderConstrained: { gap: 8, marginBottom: 10 },
  headerTitleGroup: { flex: 1, minWidth: 210 },
  headerTitleGroupConstrained: { minWidth: 0, width: '100%' },
  menuButton: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    backgroundColor: '#e0f2fe',
    borderColor: '#bae6fd',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
  },
  menuButtonText: { color: '#0369a1', fontSize: 13, fontWeight: '900' },
  pageSection: { flex: 1, width: '100%', minWidth: 0, gap: 12 },
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
  titleCompact: { fontSize: 24, lineHeight: 30 },
  titleConstrained: { fontSize: 21, lineHeight: 26 },
  subtitle: { color: '#64748b', marginTop: 8, fontSize: 15, fontWeight: '500', lineHeight: 21 },
  subtitleConstrained: { marginTop: 4, fontSize: 13, lineHeight: 18 },
  statusPill: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  statusPillConstrained: { paddingHorizontal: 10, paddingVertical: 6 },
  online: { backgroundColor: '#dcfce7', borderWidth: 1, borderColor: '#bbf7d0' },
  offline: { backgroundColor: '#fee2e2', borderWidth: 1, borderColor: '#fecaca' },
  statusText: { color: '#0f172a', fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  panel: { width: '100%', minWidth: 0, gap: 14, marginBottom: 24, backgroundColor: '#ffffff', padding: 20, borderRadius: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.06, shadowRadius: 16, elevation: 4 },
  panelCompact: { padding: 16, borderRadius: 18, marginBottom: 16 },
  panelConstrained: { padding: 12, borderRadius: 14, gap: 12 },
  label: { color: '#334155', fontSize: 13, fontWeight: '700', marginLeft: 4, textTransform: 'uppercase', letterSpacing: 0 },
  metaPanel: { width: '100%', minWidth: 0, backgroundColor: '#f8fafc', borderColor: '#e2e8f0', borderWidth: 1, borderRadius: 16, padding: 14, gap: 6 },
  metaText: { color: '#475569', fontSize: 13, fontWeight: '500', flexShrink: 1, flexWrap: 'wrap' },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 16,
    backgroundColor: '#ffffff',
    color: '#0f172a',
    width: '100%',
    maxWidth: '100%',
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
  row: { width: '100%', minWidth: 0, flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  rowSingleColumn: { flexDirection: 'column', alignItems: 'stretch', gap: 10 },
  button: { flex: 1, minWidth: 0, minHeight: 52, justifyContent: 'center', backgroundColor: '#0f766e', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 14, alignItems: 'center', shadowColor: '#0f766e', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5 },
  buttonDisabled: { backgroundColor: '#94a3b8', shadowOpacity: 0 },
  buttonText: { color: '#ffffff', fontWeight: '800', fontSize: 15, letterSpacing: 0, textAlign: 'center' },
  secondaryButton: { alignItems: 'center', padding: 12, marginTop: 4 },
  secondaryButtonText: { color: '#475569', fontWeight: '700', fontSize: 15 },
  listHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8, paddingHorizontal: 4, flexWrap: 'wrap' },
  sectionTitle: { color: '#0f172a', fontSize: 20, fontWeight: '800' },
  queueText: { color: '#64748b', fontSize: 14, fontWeight: '600', backgroundColor: '#e2e8f0', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  workshopTitle: { color: '#0f172a', fontSize: 22, fontWeight: '900', lineHeight: 28 },
  descriptionText: { color: '#334155', marginTop: 12, fontSize: 14, lineHeight: 21, fontWeight: '500' },
  workshopCard: {
    width: '100%',
    minWidth: 0,
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
  },
  itemCompact: { padding: 12, borderRadius: 12 },
  workshopCardActive: { borderColor: '#14b8a6', backgroundColor: '#f0fdfa' },
  workshopCardTitle: { color: '#0f172a', fontSize: 15, fontWeight: '800' },
  scanItem: {
    width: '100%',
    minWidth: 0,
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.03, shadowRadius: 8, elevation: 2
  },
  scanTitle: { color: '#0f172a', fontWeight: '800', fontSize: 15, textTransform: 'uppercase' },
  scanMeta: { color: '#64748b', marginTop: 6, fontSize: 13, fontWeight: '500', flexShrink: 1, flexWrap: 'wrap' },
  scanMetaBreak: { color: '#64748b', marginTop: 6, fontSize: 13, fontWeight: '500', flexShrink: 1, flexWrap: 'wrap' },
  scanKey: { color: '#94a3b8', marginTop: 8, fontSize: 11, fontFamily: 'monospace', flexShrink: 1, flexWrap: 'wrap' },
  studentItem: {
    width: '100%',
    minWidth: 0,
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
  },
  studentRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
  studentMain: { flex: 1, minWidth: 0 },
  qrBadge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 8, maxWidth: 132 },
  qrBadgeOk: { backgroundColor: '#dcfce7' },
  qrBadgeWait: { backgroundColor: '#f1f5f9' },
  qrBadgeText: { color: '#0f172a', fontSize: 12, fontWeight: '900', textAlign: 'center' },
  errorText: { color: '#dc2626', marginTop: 6, fontSize: 13, fontWeight: '600', backgroundColor: '#fef2f2', padding: 8, borderRadius: 8, overflow: 'hidden' },
});
