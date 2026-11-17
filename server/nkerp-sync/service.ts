/** Builds the real dependencies (NKERP client, Sheets client, Sync History tab) from server configuration. */
import { googleServiceAccount, nkerpLogin } from './credentials';
import type { RunDeps } from './engine';
import { GoogleTokenSource } from './googleAuth';
import { NkerpClient } from './nkerpClient';
import { DEFAULT_SHEET_ID, SheetsApi, SyncHistoryTab } from './sheets';
import type { ProgressSink } from './types';

export function sheetId(env: NodeJS.ProcessEnv = process.env): string {
  return env.NAJAF_SHEET_ID?.trim() || DEFAULT_SHEET_ID;
}

let tokenSource: { account: string; source: GoogleTokenSource } | null = null;

/** One token source per service account, shared across runs (tokens are cached for ~55 minutes). */
export function googleTokens(): GoogleTokenSource {
  const key = googleServiceAccount();
  if (!tokenSource || tokenSource.account !== key.client_email) {
    tokenSource = { account: key.client_email, source: new GoogleTokenSource(key) };
  }
  return tokenSource.source;
}

export function realDeps(apply: boolean, progress: ProgressSink, signal: AbortSignal): RunDeps {
  // Fail fast, before any network call, when the server is not configured.
  nkerpLogin();
  const api = new SheetsApi(sheetId(), googleTokens());
  const concurrency = Math.max(1, Math.min(8, parseInt(process.env.NKERP_SYNC_CONCURRENCY || '4', 10) || 4));
  return {
    nkerp: new NkerpClient({ allowWrite: apply, signal }),
    readSheet: () => api.readGrid(),
    history: new SyncHistoryTab(api),
    progress,
    signal,
    concurrency,
  };
}
