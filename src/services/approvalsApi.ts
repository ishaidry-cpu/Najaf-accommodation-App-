import type { ApprovalRecord, ApprovalSettings, ApprovalSnapshot, Segment } from './approvalPlanner';

export interface ApprovalState {
  snapshot: ApprovalSnapshot;
  records: Record<string, ApprovalRecord>;
  settings: ApprovalSettings;
  refresh: { running: boolean; error: string | null };
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch('/api/approvals' + path, body === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok) throw new Error(data?.error || `The approval request failed (${response.status}).`);
  return data as T;
}

export const loadApprovals = () => call<ApprovalState>('');
export const refreshApprovals = () => call<ApprovalState>('/refresh', {});
export const saveApprovalEdit = (id: number, segments: Segment[] | null, modifiedOn: string) =>
  call<ApprovalState>('/edit', { id, segments, modifiedOn });
export const saveApprovalReview = (id: number, reviewed: boolean) => call<ApprovalState>('/review', { id, reviewed });
export const saveApprovalSettings = (settings: ApprovalSettings) => call<ApprovalState>('/settings', settings);
export const approveInNkerp = (id: number, segments: Segment[], modifiedOn: string) =>
  call<ApprovalState & { record: ApprovalRecord }>('/approve', { id, segments, modifiedOn, confirm: true });
