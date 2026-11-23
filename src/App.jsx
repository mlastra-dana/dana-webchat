import ChatPage from './pages/ChatPage.jsx'

export default function App() {
  const match = window.location.pathname.match(/^\/c\/([^/]+)\/?$/)
  const sessionToken = match ? decodeURIComponent(match[1]) : 'demo-session'
  return <ChatPage key={sessionToken} sessionToken={sessionToken} />
}
