import { TYPE_LABEL, typeSlug, type TypeName } from './labels'

// 4KB 미만 SVG는 vite가 data URI로 번들한다(외부 요청 없음). 인라인 SVG는 내부 <style>이 문서 전역에 새므로 <img>로만 쓴다.
const ICON_URL = import.meta.glob<string>('../assets/type-icons/*.svg', { eager: true, import: 'default' })

/** 장식 아이콘(alt ""). 타입명은 숨김 텍스트("불꽃 타입")로 읽히고, labelId를 주면 aria-describedby 대상으로 쓸 수 있다. */
export function TypeIcon({ type, labelId }: { type: TypeName; labelId?: string }) {
  const slug = typeSlug(type)
  return (
    <>
      <img className="type-icon" src={ICON_URL[`../assets/type-icons/${slug}.svg`]} alt="" width={20} height={20} data-type-icon={slug} />
      <span id={labelId} className="sr-only">
        {TYPE_LABEL[type]} 타입
      </span>
    </>
  )
}
