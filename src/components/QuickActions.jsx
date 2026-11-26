import { ArrowLeft, CreditCard, Headset } from 'lucide-react'

const actions = {
  pay: { label: 'Pagar ahora', Icon: CreditCard },
  advisor: { label: 'Hablar con un asesor', Icon: Headset },
  back: { label: 'Volver al inicio', Icon: ArrowLeft },
}

export default function QuickActions({ items, onAction, compact = false, disabled = false }) {
  return <div className={`quick-actions ${compact ? 'quick-actions-compact' : ''}`} aria-label="Opciones de respuesta">
    {items.map((key) => {
      const { label, Icon } = actions[key]
      return <button type="button" className={`quick-action ${key === 'pay' ? 'quick-action-primary' : ''}`} key={key} onClick={() => onAction(key)} disabled={disabled}><Icon size={17} strokeWidth={1.8} /><span>{label}</span></button>
    })}
  </div>
}
