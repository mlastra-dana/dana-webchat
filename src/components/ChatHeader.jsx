import { Info, ShieldCheck, X } from 'lucide-react'
import { useState } from 'react'
import { brand } from '../config/brand'

export default function ChatHeader({ companyName, subtitle, mode, operatorName, customerName }) {
  const [showInfo, setShowInfo] = useState(false)
  const name = companyName || ''
  const knownBrand = name === brand.companyName
  const agentLabel = mode === 'AGENT' ? (operatorName ? `Atendido por ${operatorName}` : 'Atendido por un asesor') : subtitle
  const stateLabel = mode === 'WAITING_AGENT' ? 'Buscando asesor' : 'En línea'
  return <>
    <header className="chat-header">
      <div className="header-inner">
        <div className="brand-avatar">{knownBrand ? <img src={brand.icon} alt="" /> : <span aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>}</div>
        <div className="header-copy">
          <div className="header-name">{name}<ShieldCheck size={16} aria-label="Canal oficial" className="verified-icon" /></div>
          <div className="header-subtitle">{agentLabel}<span className="header-separator" /> <span className="online"><span className="online-dot" />{stateLabel}</span></div>
        </div>
        <button className="header-info icon-button" type="button" aria-label="Información de la conversación" onClick={() => setShowInfo(true)}><Info size={21} strokeWidth={1.8} /></button>
      </div>
    </header>
    {showInfo && <div className="dialog-backdrop" onClick={() => setShowInfo(false)}>
      <section className="info-dialog" role="dialog" aria-modal="true" aria-labelledby="info-title" onClick={(event) => event.stopPropagation()}>
        <button className="dialog-close icon-button" type="button" aria-label="Cerrar información" onClick={() => setShowInfo(false)}><X size={20} /></button>
        <div className="dialog-mark"><ShieldCheck size={24} /></div>
        {knownBrand && <img className="dialog-logo" src={brand.logo} alt={name} />}
        <h2 id="info-title">Canal de atención digital</h2>
        <p>Esta conversación de {name} está dirigida a {customerName}. Si necesitas ayuda con tu cuenta, puedes solicitar atención de un asesor.</p>
        <button className="dialog-action" type="button" onClick={() => setShowInfo(false)}>Entendido</button>
      </section>
    </div>}
  </>
}
