import { CycleA } from "./CycleA.js";

export const CycleB = ({ onGo }: { onGo: () => void }) => {
  return <CycleA onGo={onGo} />;
};
