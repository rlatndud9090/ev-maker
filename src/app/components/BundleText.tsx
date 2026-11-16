import { bundleLabel, bundleSpoken, type NatureSign } from '../../cards'

/** 배분 표기 "S32↑"(.bundle-mark, 화살표는 읽기에서 숨기고 "S32 성격 상승"으로 읽힌다) */
export function BundleText({ sp, nature, className }: { sp: number; nature: NatureSign; className?: string }) {
  return (
    <span className={className}>
      <span className="bundle-mark" aria-hidden="true">
        {bundleLabel(sp, nature)}
      </span>
      <span className="sr-only">{bundleSpoken(sp, nature)}</span>
    </span>
  )
}
