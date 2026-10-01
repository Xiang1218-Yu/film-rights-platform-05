export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

const api = '/api';
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${api}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(body.code || `HTTP_${response.status}`, body.message || `请求失败 (${response.status})`, response.status);
  return body as T;
}

export const money = (n: number) => `¥${(n / 10000).toFixed(1)}万`;
export const moneyExact = (n: number) => n.toLocaleString('zh-CN');
/** 输入框以“万元”为单位编辑大数，落盘时换算回元 */
export const toWan = (yuan: number) => yuan / 10000;
export const fromWan = (wan: number) => Math.round(wan * 10000);
export const signed = (n: number) => (n > 0 ? '+' : '') + money(n);

export type VersionLine = {
  lineId: string; category: string; subcategory: string; owner: string; risk: 'low' | 'medium' | 'high';
  planned: number; committed: number; actual: number; forecast: number;
  varForecast: number; varCommitted: number; varActual: number;
  baselinePlanned: number | null; plannedDeltaVsBaseline: number | null;
};
export type BudgetVersionView = {
  id: string; projectId: string; name: string; status: 'draft' | 'in_review' | 'rejected' | 'active' | 'superseded';
  statusText: string; basedOnVersionId: string | null; revision: number; reviewRound: number;
  createdBy: string; createdAt: string; updatedAt: string; submittedAt?: string; decidedAt?: string;
  approver?: string; decisionComment?: string; openApprovalId?: string;
  totals: { planned: number; committed: number; actual: number; forecast: number; variance: number };
  baseline: { id: string; name: string; status: string } | null;
  lines: VersionLine[];
  audit: { id: string; action: string; actor: string; at: string; details: string }[];
};
export type BudgetVersionSummary = Omit<BudgetVersionView, 'lines' | 'audit' | 'baseline'>;
