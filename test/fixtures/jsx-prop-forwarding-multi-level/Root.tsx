import { Middle } from "./Middle.js";

export function Root() {
  function handleSave() {}
  return <Middle onSave={handleSave} />;
}
