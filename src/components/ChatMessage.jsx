import { brand } from '../config/brand'

export function Avatar({ advisor = false }) {
  return <span className={`message-avatar ${advisor ? 'advisor-avatar' : ''}`} aria-hidden="true">{advisor ? 'LM' : <img src={brand.icon} alt="" />}</span>
}

export default function ChatMessage({ message, advisor = false }) {
  const outgoing = message.type === 'outgoing'
  return <div className={`message-row ${outgoing ? 'message-row-outgoing' : ''}`}>
    {!outgoing && <Avatar advisor={advisor} />}
    <div className={`message-bubble ${outgoing ? 'message-bubble-outgoing' : ''}`}>
      <p>{message.text}</p>
      <time className="message-time">{message.time}</time>
    </div>
  </div>
}
