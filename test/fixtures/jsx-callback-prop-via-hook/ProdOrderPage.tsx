import { Button } from "./Button.js";
import { useBulkProdOrder } from "./hooks/useBulkProdOrder.js";

export function ProdOrderPage() {
  const { handleBulkOrder } = useBulkProdOrder();
  return <Button onClick={handleBulkOrder} />;
}
