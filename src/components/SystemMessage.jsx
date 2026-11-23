import { ShieldCheck } from 'lucide-react'

export default function SystemMessage({ text }) {
  return <div className="system-message" role="status"><ShieldCheck size={15} strokeWidth={1.8} /><span>{text}</span></div>
}
