import { productionOrderService } from "./productionOrderService.js";

export function handleBulkOrder() {
  return productionOrderService.bulkCreateProductionOrders("1");
}
