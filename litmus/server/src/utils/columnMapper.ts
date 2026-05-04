export interface ColumnMap {
  item_key:      string | null;
  item_name:     string | null;
  location_code: string | null;   // short code, e.g. WH001
  warehouse:     string | null;   // full name, e.g. "Scope Logistics | BHIWANDI"
  quantity:      string | null;
  uom:           string | null;
  cas_number:    string | null;
  uom_options:   string | null;
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
  // Short warehouse code detected before full name so it wins the "location" column
  location_code: [
    'location','loc','location_code','loc_code','wh_code','wh code',
    'warehouse_code','warehouse code','site_code','site code',
  ],
  // Full warehouse name / description
  warehouse: [
    'warehouse','warehouse_name','warehouse name','locationdesc','location_desc',
    'location desc','location name','wh_name','wh name','site','plant','facility',
  ],
  quantity: [
    'quantity','qty','stock','available','available qty','count',
    'stock qty','on hand','balance','lotqtyonhand',
    // Common ERP / Indian inventory column names
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
  uom:         ['uom','unit','unit of measure','units','measure','stockuomcode'],
  cas_number:  ['cas','cas_number','cas number','cas no','cas#'],
  uom_options: ['uom_options','uom options','allowed units','units allowed'],
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function detectColumns(rawHeaders: string[]): MappingResult {
  const warnings: string[] = [];
  const columnMap: ColumnMap = {
    item_key: null, item_name: null, location_code: null,
    warehouse: null, quantity: null, uom: null, cas_number: null, uom_options: null,
  };

  const used = new Set<string>();

  // First pass: exact / prefix match
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

  // Second pass: substring match for still-unmapped fields
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
  if (!columnMap.location_code && !columnMap.warehouse)
    warnings.push('No warehouse column — all rows applied to every warehouse');

  return { columnMap, confidence, warnings };
}
