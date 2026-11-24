import { CalendarDays, Wallet } from 'lucide-react'

function formatMoney(value, code) {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(Number(value)) }
  catch { return `${code || ''} ${value ?? ''}`.trim() }
}

const statusLabels = { PENDING: 'Pendiente', PAID: 'Pagado', OVERDUE: 'Vencido' }

export default function DebtCard({ collection }) {
  return <div className="card-row"><div className="debt-card">
    <div className="debt-card-top"><span className="card-eyebrow"><Wallet size={16} />Resumen de cuenta</span>{collection.status && <span className="card-status">{statusLabels[collection.status] || collection.status}</span>}</div>
    <div className="debt-label">Saldo pendiente</div>
    <div className="debt-amount">{formatMoney(collection.balance, collection.currency)}</div>
    <div className="debt-divider" />
    <div className="debt-due"><CalendarDays size={17} /><span>Fecha límite</span><strong>{collection.dueDate}</strong></div>
    {collection.reference && <div className="debt-reference"><span>Referencia</span><strong>{collection.reference}</strong></div>}
  </div></div>
}
