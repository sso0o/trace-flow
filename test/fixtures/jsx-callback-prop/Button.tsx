export function Button(props: { onClick: () => void; label: string }) {
  return <button onClick={props.onClick}>{props.label}</button>;
}
