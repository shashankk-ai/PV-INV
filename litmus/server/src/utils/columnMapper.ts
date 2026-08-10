export interface ColumnMap {
  item_key:        string | null;
  item_name:       string | null;
  location_code:   string | null;   // short code, e.g. WH001
  warehouse:       string | null;   // full name, e.g. "Scope Logistics | BHIWANDI"
  quantity:        string | null;
  inventory_value: string | null;   // Extended Cost
  sci_lot_no:      string | null;
  vendor_lot_no:   string | null;
  uom:             string | null;
  cas_number:      string | null;
  uom_options:     string | null;
}

export interface MappingResult {
  columnMap: ColumnMap;
  confidence: number;
  warnings: string[];
}

const ALIASES: Record<keyof ColumnMap, string[]> = {
  item_key: [
    'item_key','item key','sku','code','item code','item no','item number',
    'part no','part number','material code','material no','product code','product id','itemkey',
  ],
  item_name: [
    'item_name','item name','name','description','product name','material name',
    'chemical name','chemical','substance','product description','itemkeydesc',
  ],
  location_code: [
    'location','loc','location_code','loc_code','wh_code','wh code',
    'warehouse_code','warehouse code','site_code','site code',
  ],
  warehouse: [
    'warehouse','warehouse_name','warehouse name','locationdesc','location_desc',
    'location desc','location name','wh_name','wh name','site','plant','facility',
  ],
  quantity: [
    'quantity','qty','stock','available','available qty','count',
    'stock qty','on hand','balance','lotqtyonhand',
    'closing stock','closing qty','closing quantity','closing balance',
    'current stock','current qty','current quantity',
    'opening stock','opening qty','opening balance',
    'free stock','net stock','net qty','net quantity',
    'inventory qty','inventory quantity','physical qty','physical quantity',
    'total qty','total quantity','total stock',
    'available quantity','available stock','available balance',
    'book stock','book qty','system stock','system qty',
    'on hand qty','onhand','on hand quantity','quantity on hand',
  ],
  // Total value only — NEVER alias per-unit "avg cost" here, or a file with
  // only a unit-price column would have that price wrongly stored as the
  // total system_value, corrupting every downstream calculation.
  inventory_value: [
    'inventory_value','inventory value','extendedcost','extended cost',
    'value','total value','stock value','cost value','item value',
    'valuation','stock valuation','inventory cost','total cost',
    'amount','total amount','net value','gross value',
    'total inventory value','inventory amount',
  ],
  sci_lot_no: [
    'sci lot no','sci_lot_no','sci lotno','sci lot number','sci lot',
  ],
  vendor_lot_no: [
    'vendor lot no','vendor_lot_no','vendor lotno','vendor lot number','vendor lot',
    'supplier lot no','supplier lot',
  ],
  uom:         ['uom','unit','unit of measure','units','measure','stockuomcode'],
  cas_number:  ['cas','cas_number','cas number','cas no','cas#'],
  uom_options: ['uom_options','uom options','allowed units','units allowed'],
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function detectColumns(rawHeaders: string[], sampleRows?: Record<string, unknown>[]): MappingResult {
  const warnings: string[] = [];
  const columnMap: ColumnMap = {
    item_key: null, item_name: null, location_code: null,
    warehouse: null, quantity: null, inventory_value: null,
    sci_lot_no: null, vendor_lot_no: null,
    uom: null, cas_number: null, uom_options: null,
  };

  const used = new Set<string>();

  // First pass: exact match, or prefix match — but ONLY for aliases specific
  // enough (>=5 normalized chars) that a false positive is unlikely. Short
  // generic tokens like "qty"/"cas"/"loc" must match exactly; otherwise a
  // header like "QtyCommitSal" (a repeated per-item field, not a real
  // per-lot quantity) would wrongly win over the correct "LotQtyonhand"
  // column simply because it starts with "qty".
  for (const [field, aliases] of Object.entries(ALIASES) as [keyof ColumnMap, string[]][]) {
    for (const raw of rawHeaders) {
      if (used.has(raw)) continue;
      const n = normalize(raw);
      if (aliases.some((a) => {
        const na = normalize(a);
        return n === na || (na.length >= 5 && n.startsWith(na));
      })) {
        columnMap[field] = raw;
        used.add(raw);
        break;
      }
    }
  }

  // Second pass: substring match for still-unmapped fields. Same guard as
  // above — a short alias must not match merely by appearing anywhere inside
  // a longer, unrelated header. (The reverse direction — a short header like
  // "Qty" being an abbreviation contained in a longer alias like "quantity"
  // — is intentional and stays unguarded.)
  for (const [field, aliases] of Object.entries(ALIASES) as [keyof ColumnMap, string[]][]) {
    if (columnMap[field]) continue;
    for (const raw of rawHeaders) {
      if (used.has(raw)) continue;
      const n = normalize(raw);
      if (aliases.some((a) => {
        const na = normalize(a);
        return (na.length >= 5 && n.includes(na)) || na.includes(n);
      })) {
        columnMap[field] = raw;
        used.add(raw);
        break;
      }
    }
  }

  // Third pass: if quantity still undetected, find any unmapped column with mostly numeric values
  if (!columnMap.quantity && sampleRows?.length) {
    for (const raw of rawHeaders) {
      if (used.has(raw)) continue;
      const vals = sampleRows
        .map((r) => r[raw])
        .filter((v) => v !== '' && v !== null && v !== undefined);
      if (!vals.length) continue;
      const numericCount = vals.filter((v) => {
        const cleaned = String(v).replace(/,/g, '').trim();
        return cleaned !== '' && !isNaN(Number(cleaned));
      }).length;
      if (numericCount / vals.length >= 0.8) {
        columnMap.quantity = raw;
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
  if (!columnMap.quantity)  warnings.push('No quantity column found — please select manually');
  if (!columnMap.location_code && !columnMap.warehouse)
    warnings.push('No warehouse column — all rows applied to every warehouse');

  return { columnMap, confidence, warnings };
}
