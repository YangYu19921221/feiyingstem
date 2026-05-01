import axios from 'axios';
import { API_BASE_URL } from '../config/env';

export type ScopeType = 'book' | 'unit' | 'group';

export interface AssignBookPayload {
  book_id: number;
  student_ids: number[];
  scope_type: ScopeType;
  unit_id?: number | null;
  group_index?: number | null;
  deadline?: string;
}

export interface BookUnitItem {
  id: number;
  unit_number: number;
  name: string;
  word_count: number;
  group_count: number;
}

export interface UnitGroupItem {
  index: number;
  word_ids: number[];
  word_count: number;
}

export interface ListAssignmentsParams {
  student_id?: number;
  class_id?: number;
  scope_type?: ScopeType;
}

const BASE = `${API_BASE_URL}/teacher`;

export const teacherAssignments = {
  listBookUnits: async (book_id: number): Promise<BookUnitItem[]> => {
    const r = await axios.get(`${BASE}/books/${book_id}/units`);
    return r.data;
  },

  listUnitGroups: async (unit_id: number): Promise<UnitGroupItem[]> => {
    const r = await axios.get(`${BASE}/units/${unit_id}/groups`);
    return r.data;
  },

  assignBook: async (payload: AssignBookPayload): Promise<{ created: number; total: number; skipped: number }> => {
    const r = await axios.post(`${BASE}/assign`, payload);
    return r.data;
  },

  listAssignments: async (params: ListAssignmentsParams) => {
    const r = await axios.get(`${BASE}/assignments`, { params });
    return r.data;
  },

  deleteAssignment: async (id: number) => {
    const r = await axios.delete(`${BASE}/assignments/${id}`);
    return r.data;
  },
};
