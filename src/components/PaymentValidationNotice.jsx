import { FileCheck2, FileQuestion, SearchCheck } from 'lucide-react'

const notices = {
  MATCH: { label: 'Pago acreditado', Icon: FileCheck2 },
  REVIEW: { label: 'El comprobante necesita revisión.', Icon: SearchCheck },
  INVALID_RECEIPT: { label: 'El archivo no parece ser un comprobante de pago.', Icon: FileQuestion },
}

export default function PaymentValidationNotice({ validation, waitingForAgent }) {
  const notice = notices[validation?.result]
  if (!notice) return null
  const { label, Icon } = notice
  return <div className={`payment-validation-notice payment-validation-${validation.result.toLowerCase()}`} role="status">
    <Icon size={18} aria-hidden="true" />
    <span>{label}{validation.result === 'REVIEW' && waitingForAgent && <small>Buscando asesor...</small>}</span>
  </div>
}
