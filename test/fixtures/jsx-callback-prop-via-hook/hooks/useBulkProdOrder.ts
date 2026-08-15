import { productionOrderService } from "../services/productionOrderService.js";

export function useBulkProdOrder() {
  function handleBulkOrder() {
    return productionOrderService.bulkCreateProductionOrders("1");
  }

  return { handleBulkOrder };
}
