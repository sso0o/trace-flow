import { Button } from "./Button.js";

interface Props {
  onBulkOrder: () => void;
}

export const BulkSaveToolbar = ({ onBulkOrder }: Props) => {
  return <Button onClick={onBulkOrder} />;
};
