export type PackingType = 'drums' | 'bags' | 'bottles' | 'cans' | 'cartons' | 'pallets' | 'other';
export type ReconciliationStatus = 'matching' | 'short' | 'excess' | 'missing';

export interface PvEntryInput {
  rack_number: string;
  item_name: string;
  item_key: string;
  batch_number: string;
  units: number;
  packing_size: number;
  uom: string;
  packing_type: PackingType;
  mfg_date: string;
  expiry_date: string;
  idempotency_key?: string;
}

export interface PvEntry extends PvEntryInput {
  id: string;
  session_id: string;
  total_quantity: number;
  is_potential_duplicate: boolean;
  created_by: string;
  created_by_username: string;
  created_at: string;
  deleted_at: string | null;
}

export interface ReconciliationRow {
  item_key: string;
  item_name: string;
  system_quantity: number;
  litmus_quantity: number;
  variance: number;
  status: ReconciliationStatus;
}
