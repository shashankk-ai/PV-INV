/**
 * Intelligent column mapper for XLSX/CSV inventory uploads.
 *
 * Accepts a row of raw header strings and returns a ColumnMap that
 * indicates which raw column maps to which canonical field.
 * Falls back gracefully — only item_key and item_name are required.
 */

export interface ColumnMap {
  item_key:      string | null;
  item_name:     string | null;
  warehouse:     string | null;
  quantity:      string | null;
  uom:           string | null;
  cas_number:    string | null;
  uom_options:   string | null;
}

export interface MappingResult {
  columnMap: ColumnMap;
  confidence: number;   // 0-1, fraction of required fields detected
  warnings: string[];
}

const ALIASES: Record<keyof ColumnMap, string[]> = {
  item_key:    ['item_key','item key','sku','code','item code','item no','item number','part no','part number','material code','material no','product code','product id'],
  item_name:   ['item_name','item name','name','description','product name','material name','chemical name','chemical','substance','product description'],
  warehouse:   ['warehouse','warehouse_id','warehouse id','warehouse code','location','location code','site','site code','plant'],
  quantity:    ['quantity','qty','stock','available','available qty','count','stock qty','on hand','balance'],
  uom:         ['uom','unit','unit of measure','units','measure'],
  cas_number:  ['cas','cas_number','cas number','cas no','cas#'],
  uom_options: ['uom_options','uom options','allowed units','units allowed'],
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function detectColumns(rawHeaders: string[]): MappingResult {
  const warnings: string[] = [];
  const columnMap: ColumnMap = {
    item_key: null, item_name: null, warehouse: null,
    quantity: null, uom: null, cas_number: null, uom_options: null,
  };

  const used = new Set<string>();

  for (const [field, aliases] of Object.entries(ALIASES) as [keyof ColumnMap, string[]][]) {
    for (const raw of rawHeaders) {
      if (used.has(raw)) continue;
      const n = normalize(raw);
      if (aliases.some((a) => n === normalize(a) || n.startsWith(normalize(a)))) {
        columnMap[field] = raw;
        used.add(raw);
        break;
      }
    }
  }

  // If still missing item_key / item_name try substring match
  for (const [field, aliases] of Object.entries(ALIASES) as [keyof ColumnMap, string[]][]) {
    if (columnMap[field]) continue;
    for (const raw of rawHeaders) {
      if (used.has(raw)) continue;
      const n = normalize(raw);
      if (aliases.some((a) => n.includes(normalize(a)) || normalize(a).includes(n))) {
        columnMap[field] = raw;
        used.add(raw);
        break;
      }
    }
  }

  const required: (keyof ColumnMap)[] = ['item_key', 'item_name'];
  const found = required.filter((f) => columnMap[f] !== null).length;
  const confidence = found / required.length;

  if (!columnMap.item_key)  warnings.push('Could not detect item key column — please set manually');
  if (!columnMap.item_name) warnings.push('Could not detect item name column — please set manually');
  if (!columnMap.quantity)  warnings.push('No quantity column found — system quantities will be 0');
  if (!columnMap.warehouse) warnings.push('No warehouse column — all rows applied to every warehouse');

  return { columnMap, confidence, warnings };
}
