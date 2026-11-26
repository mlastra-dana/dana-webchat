import { brand } from '../config/brand'

export function Avatar({ advisor = false, companyName = brand.companyName, operatorName = '' }) {
  const initials = operatorName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'A'
  return <span className={`message-avatar ${advisor ? 'advisor-avatar' : ''}`} aria-hidden="true">{advisor ? initials : companyName === brand.companyName ? <img src={brand.icon} alt="" /> : companyName.slice(0, 1).toUpperCase()}</span>
}

export default function ChatMessage({ message, advisor = false, companyName, operatorName }) {
  const outgoing = message.type === 'outgoing'
  return <div className={`message-row ${outgoing ? 'message-row-outgoing' : ''}`}>
    {!outgoing && <Avatar advisor={advisor} companyName={companyName} operatorName={operatorName} />}
    <div className={`message-bubble ${outgoing ? 'message-bubble-outgoing' : ''}`}>
      <p>{message.text}</p>
      {message.mediaUrl && <a className="message-media-link" href={message.mediaUrl} target="_blank" rel="noopener noreferrer">Ver archivo adjunto</a>}
      <time className="message-time">{message.time}</time>
    </div>
  </div>
}
