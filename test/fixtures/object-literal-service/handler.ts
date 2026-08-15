import { productionOrderService } from "./service.js";

export const handleBulkOrder = async () => {
  return productionOrderService.bulkCreateProductionOrders("1");
};
