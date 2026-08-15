import { CycleB } from "./CycleB.js";

export const CycleA = ({ onGo }: { onGo: () => void }) => {
  return <CycleB onGo={onGo} />;
};
