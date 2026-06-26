import type { PopGroup } from '@sim/types/popGroup'
import { useTranslation } from 'react-i18next'
import { formatPopCount } from '@/app/utils/format'

export function PopGroupCard({
  pop,
  onClick,
  subtitle,
}: {
  pop: PopGroup
  onClick?: (id: string) => void
  subtitle?: string
}) {
  const { t } = useTranslation()

  const employmentLabel = pop.employerId
    ? t(`detail.province.pop_employer_${pop.employerId.kind}`, {
        defaultValue: t('detail.province.pop_employed'),
      })
    : t('detail.province.pop_unemployed')

  const header = (
    <>
      {t(`detail.province.pop_type.${pop.popType}`, { defaultValue: pop.popType })}{' '}
      <span className="text-xs font-normal text-gray-400">
        ({t(`detail.province.${pop.class}`, { defaultValue: pop.class })}
        {subtitle !== undefined ? ` / ${subtitle}` : ` / ${employmentLabel}`})
      </span>
    </>
  )

  return (
    <div className="rounded bg-gray-700 p-1.5 text-xs">
      {onClick ? (
        <button
          className="w-full cursor-pointer text-left font-medium text-blue-400 capitalize hover:text-blue-300"
          onClick={() => onClick(pop.id)}
        >
          {header} →
        </button>
      ) : (
        <div className="font-medium text-gray-300 capitalize">{header}</div>
      )}
      <div className="flex justify-between">
        <span className="text-gray-400">{t('detail.province.size')}:</span>
        <span>{formatPopCount(pop.size)}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-gray-400">{t('detail.province.money')}:</span>
        <span>{pop.money.toFixed(1)}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-gray-400">{t('detail.province.need_satisfaction')}:</span>
        <span>{pop.needSatisfaction.toFixed(1)}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-gray-400">{t('detail.province.unrest')}:</span>
        <span className={pop.unrest > 60 ? 'text-red-400' : 'text-gray-200'}>
          {pop.unrest.toFixed(1)}
        </span>
      </div>
    </div>
  )
}
