import { Avatar } from './ChatMessage'

export default function TypingIndicator({ advisor }) {
  return <div className="message-row" aria-label="Escribiendo"><Avatar advisor={advisor} /><div className="typing-bubble"><span /><span /><span /></div></div>
}
