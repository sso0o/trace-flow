import { BulkSaveToolbar } from "./BulkSaveToolbar.js";
import { handleBulkOrder } from "./handleBulkOrder.js";

export function ProdPlanList() {
  return <BulkSaveToolbar onBulkOrder={handleBulkOrder} />;
}
