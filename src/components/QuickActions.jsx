import { CalendarDays, CreditCard, FileText, Headset, Layers3, ListChecks, Wallet } from 'lucide-react'

const actions = {
  pay: { label: 'Pagar ahora', Icon: CreditCard },
  detail: { label: 'Ver detalle', Icon: FileText },
  alternative: { label: 'Necesito una alternativa', Icon: Layers3 },
  advisor: { label: 'Hablar con un asesor', Icon: Headset },
  partial: { label: 'Pagar una parte', Icon: Wallet },
  date: { label: 'Elegir una fecha', Icon: CalendarDays },
  options: { label: 'Revisar opciones', Icon: ListChecks },
}

export function actionLabel(action) { return actions[action]?.label || action }

export default function QuickActions({ items, onAction, compact = false, disabled = false }) {
  return <div className={`quick-actions ${compact ? 'quick-actions-compact' : ''}`} aria-label="Opciones de respuesta">
    {items.map((key) => {
      const { label, Icon } = actions[key]
      return <button type="button" className={`quick-action ${key === 'pay' ? 'quick-action-primary' : ''}`} key={key} onClick={() => onAction(key)} disabled={disabled}><Icon size={17} strokeWidth={1.8} /><span>{label}</span></button>
    })}
  </div>
}
