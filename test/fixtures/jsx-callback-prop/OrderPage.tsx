import { Button } from "./Button.js";

export function handleBulkOrder(): void {
  console.log("bulk order submitted");
}

export function OrderPage() {
  return <Button onClick={handleBulkOrder} label="Submit bulk order" />;
}
