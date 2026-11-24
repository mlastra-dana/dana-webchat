function formatMoney(value, currency) {
  if (value === undefined || value === null || !Number.isFinite(Number(value))) return '—'
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(Number(value)) }
  catch { return `${currency || ''} ${value ?? ''}`.trim() }
}

const statusLabels = { PENDING: 'Pendiente', PAID: 'Pagado', OVERDUE: 'Vencido' }
const modeLabels = { BOT: 'Bot', WAITING_AGENT: 'Esperando asesor', AGENT: 'Atención humana' }

export default function CustomerContext({ session, onClose }) {
  const collection = session.collection || {}
  return <section className="operator-context" aria-label="Datos de la sesión">
    <div className="operator-context-title"><h2>Contexto del cliente</h2><button type="button" className="operator-context-close" onClick={onClose}>Cerrar</button></div>
    <strong className="operator-customer-name">{session.customer?.firstName || 'Cliente'}</strong>
    <dl>
      <div><dt>Saldo</dt><dd>{formatMoney(collection.balance, collection.currency)}</dd></div>
      <div><dt>Moneda</dt><dd>{collection.currency || '—'}</dd></div>
      <div><dt>Fecha límite</dt><dd>{collection.dueDate || '—'}</dd></div>
      <div><dt>Referencia</dt><dd>{collection.reference || '—'}</dd></div>
      <div><dt>Estado</dt><dd>{statusLabels[collection.status] || collection.status || '—'}</dd></div>
      <div><dt>Modo</dt><dd>{modeLabels[session.mode] || session.mode || '—'}</dd></div>
    </dl>
  </section>
}
