import AsyncStorage from '@react-native-async-storage/async-storage';
import * as cloudStorage from './cloudStorage';
import { applyManifest, type BackupPayload } from './backup';
import { buildCanonicalManifest, hashManifestAsync } from './manifestHash';
import { db, generateId } from './db';
import * as financialAccounts from './financialAccounts';
import * as categories from './categories';
import * as transactions from './transactions';
import type { SnapshotFrequency } from '@/types';

const CLOUD_ROOT = 'Finante';
const MANIFEST_PATH = `${CLOUD_ROOT}/manifest.json`;
const META_PATH = `${CLOUD_ROOT}/manifest.meta.json`;
const SNAPSHOTS_PREFIX = `${CLOUD_ROOT}/snapshots/`;
const MANIFEST_VERSION = 1;
const APP_TAG = 'finante';

const KEY_LAST_HASH = 'cloud_last_manifest_hash';
const KEY_LAST_UPLOADED = 'cloud_last_uploaded_at';
const KEY_LAST_SNAPSHOT = 'cloud_last_snapshot_at';
const KEY_DEVICE_ID = 'cloud_device_id';

interface CloudState {
  lastManifestHash: string | null;
  lastUploadedAt: number | null;
  lastSnapshotAt: number | null;
  deviceId: string;
}

interface CloudManifestMeta {
  version: number;
  uploadedAt: number;
  hash: string;
  deviceId: string;
  recordCount: number;
}

async function getOrCreateDeviceId(): Promise<string> {
  let id = await AsyncStorage.getItem(KEY_DEVICE_ID);
  if (!id) {
    id = generateId();
    await AsyncStorage.setItem(KEY_DEVICE_ID, id);
  }
  return id;
}

export async function getCloudState(): Promise<CloudState> {
  const [hash, uploaded, snapshot, deviceId] = await Promise.all([
    AsyncStorage.getItem(KEY_LAST_HASH),
    AsyncStorage.getItem(KEY_LAST_UPLOADED),
    AsyncStorage.getItem(KEY_LAST_SNAPSHOT),
    getOrCreateDeviceId(),
  ]);
  return {
    lastManifestHash: hash,
    lastUploadedAt: uploaded ? parseInt(uploaded, 10) : null,
    lastSnapshotAt: snapshot ? parseInt(snapshot, 10) : null,
    deviceId,
  };
}

async function setCloudState(patch: Partial<CloudState>): Promise<void> {
  const ops: [string, string][] = [];
  if (patch.lastManifestHash !== undefined && patch.lastManifestHash !== null) {
    ops.push([KEY_LAST_HASH, patch.lastManifestHash]);
  }
  if (patch.lastUploadedAt !== undefined && patch.lastUploadedAt !== null) {
    ops.push([KEY_LAST_UPLOADED, String(patch.lastUploadedAt)]);
  }
  if (patch.lastSnapshotAt !== undefined && patch.lastSnapshotAt !== null) {
    ops.push([KEY_LAST_SNAPSHOT, String(patch.lastSnapshotAt)]);
  }
  if (ops.length) await AsyncStorage.multiSet(ops);
}

async function getAllBankStatements() {
  return await db.getAllAsync<{
    id: string;
    account_id: string;
    period_from: string;
    period_to: string;
    file_path: string | null;
    file_hash: string | null;
    imported_at: string;
    transaction_count: number;
    total_inflow: number;
    total_outflow: number;
    notes: string | null;
    created_at: string;
  }>('SELECT * FROM bank_statements ORDER BY period_to DESC, imported_at DESC');
}

async function buildManifestPayload(): Promise<BackupPayload> {
  const [accounts, cats, txs, statements, fxRows] = await Promise.all([
    financialAccounts.getFinancialAccounts(true),
    categories.getCategories(true),
    transactions.getTransactions({ excludeDuplicates: false }),
    getAllBankStatements(),
    db.getAllAsync<{
      date: string;
      currency: string;
      rate: number;
      fetched_at: string;
    }>('SELECT date, currency, rate, fetched_at FROM fx_rates'),
  ]);

  return {
    version: MANIFEST_VERSION,
    app: APP_TAG,
    exportDate: new Date().toISOString(),
    financialAccounts: accounts,
    expenseCategories: cats,
    transactions: txs,
    bankStatements: (statements ?? []).map(r => ({
      id: r.id,
      account_id: r.account_id,
      period_from: r.period_from,
      period_to: r.period_to,
      file_path: r.file_path ?? undefined,
      file_hash: r.file_hash ?? undefined,
      imported_at: r.imported_at,
      transaction_count: r.transaction_count,
      total_inflow: r.total_inflow,
      total_outflow: r.total_outflow,
      notes: r.notes ?? undefined,
      createdAt: r.created_at,
    })),
    fxRates: fxRows ?? [],
  };
}

export async function isAvailable(): Promise<boolean> {
  return await cloudStorage.isAvailable();
}

export async function uploadManifestIfChanged(): Promise<boolean> {
  if (!(await cloudStorage.isAvailable())) return false;

  const payload = await buildManifestPayload();
  const canonical = buildCanonicalManifest(payload as unknown as Record<string, unknown>);
  const hash = await hashManifestAsync(canonical);

  const state = await getCloudState();
  if (state.lastManifestHash === hash) {
    return false;
  }

  const json = JSON.stringify(payload);
  const recordCount =
    payload.financialAccounts.length +
    payload.expenseCategories.length +
    payload.transactions.length +
    payload.bankStatements.length +
    payload.fxRates.length;

  const meta: CloudManifestMeta = {
    version: MANIFEST_VERSION,
    uploadedAt: Date.now(),
    hash,
    deviceId: state.deviceId,
    recordCount,
  };

  const previousMeta = await readCloudMeta();
  await cloudStorage.writeFile(META_PATH, JSON.stringify(meta), 'utf8');
  try {
    await cloudStorage.writeFile(MANIFEST_PATH, json, 'utf8');
  } catch (e) {
    if (previousMeta) {
      try {
        await cloudStorage.writeFile(META_PATH, JSON.stringify(previousMeta), 'utf8');
      } catch {
        // best-effort rollback
      }
    }
    throw e;
  }

  await setCloudState({
    lastManifestHash: hash,
    lastUploadedAt: meta.uploadedAt,
  });
  return true;
}

export async function readCloudMeta(): Promise<CloudManifestMeta | null> {
  if (!(await cloudStorage.isAvailable())) return null;
  if (!(await cloudStorage.exists(META_PATH))) return null;
  try {
    const text = await cloudStorage.readFile(META_PATH, 'utf8');
    return JSON.parse(text) as CloudManifestMeta;
  } catch {
    return null;
  }
}

const FREQUENCY_MS: Record<SnapshotFrequency, number> = {
  off: Number.POSITIVE_INFINITY,
  daily: 24 * 60 * 60 * 1000,
  every3days: 3 * 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

function todaySnapshotName(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `manifest_${y}-${m}-${day}.json`;
}

export async function maybeSnapshot(
  frequency: SnapshotFrequency,
  retention: number
): Promise<boolean> {
  if (frequency === 'off') return false;
  if (!(await cloudStorage.isAvailable())) return false;
  if (!(await cloudStorage.exists(MANIFEST_PATH))) return false;

  const state = await getCloudState();
  const interval = FREQUENCY_MS[frequency];
  const now = Date.now();
  if (state.lastSnapshotAt && now - state.lastSnapshotAt < interval) {
    return false;
  }

  const manifestText = await cloudStorage.readFile(MANIFEST_PATH, 'utf8');
  const snapshotPath = `${SNAPSHOTS_PREFIX}${todaySnapshotName()}`;
  await cloudStorage.writeFile(snapshotPath, manifestText, 'utf8');
  await setCloudState({ lastSnapshotAt: now });
  await cleanupSnapshots(retention);
  return true;
}

async function cleanupSnapshots(retention: number): Promise<void> {
  const safe = Math.max(1, retention);
  const files = await cloudStorage.listDir(SNAPSHOTS_PREFIX);
  const snapshots = files
    .filter(f => f.startsWith('manifest_') && f.endsWith('.json'))
    .sort()
    .reverse();
  for (const name of snapshots.slice(safe)) {
    await cloudStorage.deleteFile(`${SNAPSHOTS_PREFIX}${name}`);
  }
}

export async function listSnapshots(): Promise<string[]> {
  const files = await cloudStorage.listDir(SNAPSHOTS_PREFIX);
  return files
    .filter(f => f.startsWith('manifest_') && f.endsWith('.json'))
    .sort()
    .reverse();
}

export interface RestoreProgress {
  phase: 'manifest' | 'apply' | 'done';
  current: number;
  total: number;
}

export async function restoreFromCloud(
  onProgress?: (p: RestoreProgress) => void
): Promise<{ recordCount: number }> {
  if (!(await cloudStorage.isAvailable())) {
    throw new Error('iCloud nu este disponibil');
  }
  onProgress?.({ phase: 'manifest', current: 0, total: 1 });
  if (!(await cloudStorage.exists(MANIFEST_PATH))) {
    throw new Error('Nu există backup în iCloud');
  }
  const manifestText = await cloudStorage.readFile(MANIFEST_PATH, 'utf8');
  const payload = JSON.parse(manifestText) as Record<string, unknown>;
  const version = (payload.version as number) ?? 0;
  if (version > MANIFEST_VERSION) {
    throw new Error('Backup-ul a fost creat cu o versiune mai nouă a aplicației.');
  }
  if (payload.app !== APP_TAG) {
    throw new Error('Backup-ul nu provine din aplicația Finanțe.');
  }
  onProgress?.({ phase: 'manifest', current: 1, total: 1 });

  onProgress?.({ phase: 'apply', current: 0, total: 1 });
  await applyManifest(payload, { wipeFirst: true });
  onProgress?.({ phase: 'apply', current: 1, total: 1 });

  const meta = await readCloudMeta();
  if (meta) {
    await setCloudState({
      lastManifestHash: meta.hash,
      lastUploadedAt: meta.uploadedAt,
    });
  }

  const recordCount =
    (Array.isArray(payload.financialAccounts) ? payload.financialAccounts.length : 0) +
    (Array.isArray(payload.expenseCategories) ? payload.expenseCategories.length : 0) +
    (Array.isArray(payload.transactions) ? payload.transactions.length : 0) +
    (Array.isArray(payload.bankStatements) ? payload.bankStatements.length : 0) +
    (Array.isArray(payload.fxRates) ? payload.fxRates.length : 0);

  onProgress?.({ phase: 'done', current: 1, total: 1 });
  return { recordCount };
}
