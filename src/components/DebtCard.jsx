import { CalendarDays, Wallet } from 'lucide-react'

function formatMoney(value, code) {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(Number(value)) }
  catch { return `${code || ''} ${value ?? ''}`.trim() }
}

const statusLabels = { PENDING: 'Pendiente', PAID: 'Pagado', OVERDUE: 'Vencido', RECEIPT_MATCHED: 'Comprobante recibido' }

export default function DebtCard({ collection, receiptMatched = false }) {
  const status = receiptMatched ? 'PAID' : collection.status
  return <div className="card-row"><div className="debt-card">
    <div className="debt-card-top"><span className="card-eyebrow"><Wallet size={16} />Resumen de cuenta</span>{status && <span className="card-status">{statusLabels[status] || status}</span>}</div>
    <div className="debt-label">{receiptMatched ? 'Monto pagado' : 'Saldo pendiente'}</div>
    <div className="debt-amount">{formatMoney(collection.balance, collection.currency)}</div>
    <div className="debt-divider" />
    {!receiptMatched && <div className="debt-due"><CalendarDays size={17} /><span>Fecha límite</span><strong>{collection.dueDate}</strong></div>}
    {collection.reference && <div className="debt-reference"><span>Referencia</span><strong>{collection.reference}</strong></div>}
  </div></div>
}
