import { Leaf } from "./Leaf.js";

export const Middle = ({ onSave }: { onSave: () => void }) => {
  return <Leaf onGo={onSave} />;
};
