export function Errors({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="errors" role="alert">
      <strong>{title}</strong>
      <ul>
        {lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
    </div>
  )
}
