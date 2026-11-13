import { pokemonIconUrl } from '../../ui/images'

interface Props {
  /** 스냅샷 종 id. 풀리지 않았거나 이미지가 없으면 같은 크기 빈 자리 */
  speciesId: string | undefined
  /** 표시 크기(px, 정사각) */
  size: number
  /** 목록 행처럼 많을 때 지연 로드 */
  lazy?: boolean
  className?: string
}

/** 포켓몬 아이콘(장식: 이름이 바로 옆에 있어 alt=""). 이미지가 없으면 같은 크기 자리만 둬 정렬을 유지한다. */
export function PokemonIcon({ speciesId, size, lazy = false, className = '' }: Props) {
  const url = pokemonIconUrl(speciesId)
  const cls = `mon-icon ${className}`.trim()
  if (url === undefined) {
    return <span className={`${cls} mon-icon-empty`} aria-hidden="true" data-testid="mon-icon" data-species-icon="" style={{ width: size, height: size }} />
  }
  return (
    <img
      className={cls}
      src={url}
      alt=""
      width={size}
      height={size}
      loading={lazy ? 'lazy' : undefined}
      decoding="async"
      draggable={false}
      data-testid="mon-icon"
      data-species-icon={speciesId}
    />
  )
}
