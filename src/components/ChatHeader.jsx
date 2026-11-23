import { Info, ShieldCheck, X } from 'lucide-react'
import { useState } from 'react'
import { brand } from '../config/brand'

export default function ChatHeader({ advisor }) {
  const [showInfo, setShowInfo] = useState(false)
  return <>
    <header className="chat-header">
      <div className="header-inner">
        <div className="brand-avatar"><img src={brand.icon} alt="" /></div>
        <div className="header-copy">
          <div className="header-name">{brand.companyName}<ShieldCheck size={16} aria-label="Canal oficial" className="verified-icon" /></div>
          <div className="header-subtitle">{advisor ? 'Laura Martínez · Asesora' : brand.subtitle}<span className="header-separator" /> <span className="online"><span className="online-dot" />En línea</span></div>
        </div>
        <button className="header-info icon-button" type="button" aria-label="Información de la conversación" onClick={() => setShowInfo(true)}><Info size={21} strokeWidth={1.8} /></button>
      </div>
    </header>
    {showInfo && <div className="dialog-backdrop" onClick={() => setShowInfo(false)}>
      <section className="info-dialog" role="dialog" aria-modal="true" aria-labelledby="info-title" onClick={(event) => event.stopPropagation()}>
        <button className="dialog-close icon-button" type="button" aria-label="Cerrar información" onClick={() => setShowInfo(false)}><X size={20} /></button>
        <div className="dialog-mark"><ShieldCheck size={24} /></div>
        <img className="dialog-logo" src={brand.logo} alt={brand.companyName} />
        <h2 id="info-title">Canal de atención digital</h2>
        <p>Esta conversación de demostración pertenece a {brand.companyName}. Los datos mostrados son ficticios y ninguna acción genera un pago real.</p>
        <button className="dialog-action" type="button" onClick={() => setShowInfo(false)}>Entendido</button>
      </section>
    </div>}
  </>
}
