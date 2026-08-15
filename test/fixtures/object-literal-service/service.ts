export const productionOrderService = {
  bulkCreateProductionOrders: (id: string) => save(id),
};

function save(id: string): string {
  return `saved:${id}`;
}
