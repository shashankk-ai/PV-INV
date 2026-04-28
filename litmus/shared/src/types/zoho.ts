export interface ZohoChemical {
  item_key: string;
  item_name: string;
  uom_options: string[];
  cas_number?: string;
}

export interface ZohoWarehouse {
  warehouse_id: string;
  warehouse_name: string;
  location_code: string;
}

export interface ZohoInventoryRecord {
  item_key: string;
  warehouse_id: string;
  quantity: number;
  uom: string;
}
