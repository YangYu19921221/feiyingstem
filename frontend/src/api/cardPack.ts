/** 新政策卡包(2026-10-08)。价格、张数、规则全由后端 services/card_pack.py 下发,
 *  前端**不写死任何一个数字** —— 两处各写一份,改价时必然一处漏改。 */
import api from './client';

export type CardKind = 'trial' | 'b15' | 'b5' | 'p2' | 'b1';
export type PackTier = 'trial' | 'basic' | 'premium' | 'school';

export interface CardKindSpec {
  kind: CardKind;
  label: string;
  price: number;
  /** none=入门卡不用选 / books=发码时勾 n 本 */
  pick: 'none' | 'books';
  n: number;
  /** 能勾哪些档位的书 */
  tiers: PackTier[];
  /** 只能勾这个学段(如 primary),null=不限 */
  stage: string | null;
  covers: string;
}

export interface PackCatalog {
  card_days: number;
  code_valid_years: number;
  kinds: CardKindSpec[];
  tiers: Record<PackTier, string>;
  pack_price: number;
  pack_totals: Record<CardKind, number>;
  /** value = 这一期机构要付的钱;card_value = 这一期开的卡按单价合计 */
  installments: { no: number; cards: Partial<Record<CardKind, number>>; value: number; card_value: number; due_month: number }[];
  bonus_kind: CardKind;
  bonus_full_pay: number;
  bonus_early_settle: number;
  restock_min: number;
}

export interface PackKindStatus { kind: CardKind; label: string; quota: number; used: number; left: number }
export interface PackStatus { kinds: PackKindStatus[]; paid_installments: number[]; next_installment: number | null }

export interface PackBook { id: number; name: string; series: string | null; stage: string; stage_label: string }
export interface PackOptions {
  series: { series: string; total: number; stages: { stage: string; label: string; count: number }[] }[];
  basic_books: PackBook[];
  premium_books: PackBook[];
  trial_books: { id: number; name: string }[];
}

export interface PackInfo {
  card_plan: 'legacy' | 'pack';
  catalog: PackCatalog;
  options: PackOptions;
  status?: PackStatus;
}

export interface PackLedgerRow {
  id: number; card_kind: CardKind; count: number;
  source: 'installment' | 'bonus' | 'restock';
  installment_no: number | null; note: string | null; created_at: string;
}

export const cardPackApi = {
  /** 老师/机构管理员都能看的规则(含本机构是不是新卡包政策) */
  rules: () => api.get<{ card_plan: 'legacy' | 'pack'; catalog: PackCatalog }>('/teacher/card-rules'),
  info: (orgId?: number) =>
    api.get<PackInfo>('/admin/subscriptions/pack', { params: orgId ? { org_id: orgId } : {} }),
  generate: (data: { card_kind: CardKind; count: number; book_ids?: number[]; batch_note?: string }) =>
    api.post('/admin/subscriptions/pack/generate', data),
  books: () =>
    api.get<{ tiers: Record<PackTier, string>; books: { id: number; name: string; series: string; stage_label: string; pack_tier: PackTier | null }[] }>(
      '/admin/subscriptions/pack/books'),
  setTier: (bookId: number, pack_tier: PackTier | null) =>
    api.put<{ synced_students: number }>(`/admin/subscriptions/pack/books/${bookId}`, { pack_tier }),
  orgPack: (orgId: number) =>
    api.get<{ org_name: string; card_plan: string; catalog: PackCatalog; status: PackStatus; ledger: PackLedgerRow[] }>(
      `/admin/organizations/${orgId}/card-pack`),
  pay: (orgId: number, data: { action: 'installment' | 'settle' | 'restock'; restock?: Partial<Record<CardKind, number>>; note?: string }) =>
    api.post<{ granted: Partial<Record<CardKind, number>>; status: PackStatus }>(`/admin/organizations/${orgId}/card-pack`, data),
};
