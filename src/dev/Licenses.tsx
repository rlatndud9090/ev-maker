import type { Snapshot } from '../data/schema'
import licenses from '../data/licenses.json'

export function Licenses({ snapshot }: { snapshot: Snapshot | undefined }) {
  const src = snapshot?.manifest.source
  return (
    <footer className="panel wide">
      <h2>라이선스·출처</h2>
      {src && (
        <p>
          현재 스냅샷 {snapshot.manifest.regulation.name}: 게임 데이터{' '}
          {Object.entries(src.gameData.packages)
            .map(([k, v]) => `${k}@${v}`)
            .join(', ')}{' '}
          ({src.gameData.mode}, 기준 시각 {src.gameData.sourceTime}) · 한국어 PokeAPI {src.ko.pokeapiCommit} (기준 시각{' '}
          {src.ko.sourceTime}) · 스키마 v{snapshot.manifest.schemaVersion}
        </p>
      )}
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">이름</th>
              <th scope="col">버전</th>
              <th scope="col">라이선스</th>
              <th scope="col">용도</th>
              <th scope="col">출처</th>
            </tr>
          </thead>
          <tbody>
            {licenses.entries.map((e) => (
              <tr key={e.id}>
                <td>{e.name}</td>
                <td>{e.version}</td>
                <td>{e.license}</td>
                <td>{e.usage}</td>
                <td className="src">{e.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">{licenses.trademark}</p>
    </footer>
  )
}
