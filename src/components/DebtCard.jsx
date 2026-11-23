import { CalendarDays, Wallet } from 'lucide-react'

const currency = (value) => new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)

export default function DebtCard({ collection }) {
  return <div className="card-row"><div className="debt-card">
    <div className="debt-card-top"><span className="card-eyebrow"><Wallet size={16} />Resumen de cuenta</span><span className="card-status">Pendiente</span></div>
    <div className="debt-label">Saldo pendiente</div>
    <div className="debt-amount"><span>$</span> {currency(collection.balance)}</div>
    <div className="debt-divider" />
    <div className="debt-due"><CalendarDays size={17} /><span>Fecha límite</span><strong>{collection.dueDate}</strong></div>
  </div></div>
}

export function DetailCard({ detail }) {
  return <div className="card-row"><div className="detail-card">
    <div className="detail-card-heading"><FileTitle /> <div><span className="card-eyebrow">DETALLE DEL SALDO</span><h3>Resumen de la cuenta</h3></div></div>
    <dl>
      <div><dt>Concepto</dt><dd>{detail.concept}</dd></div>
      <div><dt>Referencia</dt><dd>{detail.reference}</dd></div>
      <div><dt>Fecha</dt><dd>{detail.date}</dd></div>
      <div><dt>Monto original</dt><dd>$ {currency(detail.originalAmount)}</dd></div>
      <div className="detail-total"><dt>Saldo pendiente</dt><dd>$ {currency(detail.balance)}</dd></div>
    </dl>
  </div></div>
}

function FileTitle() { return <span className="detail-icon"><Wallet size={20} /></span> }
