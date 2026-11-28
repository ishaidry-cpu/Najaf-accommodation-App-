import type { Applicant, ApprovalRecord, ApprovalSettings, ApprovalSnapshot, ApprovalTour, ApprovedTour, Segment } from './approvalPlanner';

export interface ApprovalState {
  snapshot: ApprovalSnapshot;
  records: Record<string, ApprovalRecord>;
  settings: ApprovalSettings;
  refresh: { running: boolean; error: string | null };
  /** NKERP's Approved list (the last search) and the approved Tour IDs opened for a change. */
  approved?: { at: string | null; window: { from: string; to: string } | null; tours: ApprovalTour[]; open: Record<string, ApprovedTour> };
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
export const saveApprovalEdit = (id: number, segments: Segment[] | null, modifiedOn: string, by?: string, confirmed?: boolean) =>
  call<ApprovalState>('/edit', { id, segments, modifiedOn, by, confirmed });
export const saveApprovalAccommodation = (id: number, paxFaiz: number | null, paxHotel: number | null, by?: string) =>
  call<ApprovalState>('/accommodation', { id, paxFaiz, paxHotel, by });
export const loadApplicants = (id: number, paxFaiz: number) =>
  call<{ applicants: Applicant[]; mustMatch: boolean; hasApplicants: boolean }>('/applicants', { id, paxFaiz });
export const saveApprovalReview = (id: number, reviewed: boolean) => call<ApprovalState>('/review', { id, reviewed });
export const saveApprovalSettings = (settings: ApprovalSettings) => call<ApprovalState>('/settings', settings);
export const approveInNkerp = (id: number, segments: Segment[], modifiedOn: string, by?: string, faizApplicants?: number[]) =>
  call<ApprovalState & { record: ApprovalRecord }>('/approve', { id, segments, modifiedOn, by, faizApplicants, confirm: true });
export const sendChatToNkerp = (id: number, message: string, by?: string) =>
  call<ApprovalState & { record: ApprovalRecord; visible: boolean | null }>('/chat', { id, message, by, confirm: true });
export const reloadTourChat = (id: number) => call<ApprovalState>('/chat-read', { id });
export const searchApprovedTours = (refresh = false) => call<ApprovalState>('/approved/search', { refresh });
export const openApprovedTour = (id: number) => call<ApprovalState>('/approved/open', { id });
export const reapproveApprovedTour = (id: number, segments: Segment[], modifiedOn: string, by?: string, faizApplicants?: number[]) =>
  call<ApprovalState & { record: ApprovalRecord }>('/approved/reapprove', { id, segments, modifiedOn, by, faizApplicants, confirm: true });
