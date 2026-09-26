import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Check, CheckCheck, Clock3, Inbox, Mail, MailOpen, MessageCircle, Plus, RefreshCw, Search, Send, Users, X } from 'lucide-react'
import './AppNew.css'
import { API_URL } from './apiConfig'

const requestStatuses = {
  PENDENTE: 'Aguardando',
  ABERTA: 'Aguardando',
  EM_ANDAMENTO: 'Em andamento',
  CONCLUIDA: 'Concluída',
  CANCELADA: 'Cancelada',
}

const recipientStatuses = { PENDENTE: 'Aguardando', EM_ANDAMENTO: 'Em andamento', CONCLUIDA: 'Concluída' }
const dateTime = (value) => value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''
const dateOnly = (value) => value ? new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR') : ''

function InternalRequestsPage({ session, notify, can }) {
  const headers = useMemo(() => ({ Authorization: `Bearer ${session.token}` }), [session.token])
  const [folder, setFolder] = useState('inbox')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [requests, setRequests] = useState([])
  const [counts, setCounts] = useState({ inbox: 0, unread: 0, sent: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [reply, setReply] = useState('')
  const [sendingReply, setSendingReply] = useState(false)
  const [composeOpen, setComposeOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const query = new URLSearchParams({ folder, limit: '100', ...(search ? { search } : {}) })
      const response = await fetch(`${API_URL}/tasks?${query}`, { headers })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Não foi possível carregar as solicitações.')
      setRequests(payload.data || [])
      setCounts(payload.counts || { inbox: 0, unread: 0, sent: 0 })
    } catch (requestError) {
      setError(requestError.message || 'Não foi possível carregar as solicitações.')
    } finally { setLoading(false) }
  }, [folder, headers, search])

  useEffect(() => { void load() }, [load])

  const openRequest = useCallback(async (requestId) => {
    setSelectedId(requestId)
    setDetail(null)
    setDetailLoading(true)
    setReply('')
    try {
      const response = await fetch(`${API_URL}/tasks/${requestId}`, { headers })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Não foi possível abrir esta solicitação.')
      setDetail(payload)
      if (folder === 'inbox') void load()
    } catch (requestError) {
      setDetail({ error: requestError.message || 'Não foi possível abrir esta solicitação.' })
    } finally { setDetailLoading(false) }
  }, [folder, headers, load])

  async function sendReply(event) {
    event.preventDefault()
    const message = reply.trim()
    if (!message || !detail) return
    setSendingReply(true)
    try {
      const response = await fetch(`${API_URL}/tasks/${detail.id}/messages`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ message }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Não foi possível enviar a resposta.')
      setReply('')
      await openRequest(detail.id)
      await load()
    } catch (requestError) { notify(requestError.message || 'Não foi possível enviar a resposta.') }
    finally { setSendingReply(false) }
  }

  async function updateStatus(status) {
    if (!detail) return
    try {
      const response = await fetch(`${API_URL}/tasks/${detail.id}/status`, {
        method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Não foi possível atualizar o andamento.')
      notify('Andamento da solicitação atualizado.')
      await openRequest(detail.id)
      await load()
    } catch (requestError) { notify(requestError.message || 'Não foi possível atualizar o andamento.') }
  }

  async function cancelRequest() {
    if (!detail || !window.confirm('Cancelar esta solicitação? O histórico continuará disponível.')) return
    try {
      const response = await fetch(`${API_URL}/tasks/${detail.id}/cancel`, { method: 'POST', headers })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Não foi possível cancelar a solicitação.')
      notify('Solicitação cancelada. O histórico foi preservado.')
      await openRequest(detail.id)
      await load()
    } catch (requestError) { notify(requestError.message || 'Não foi possível cancelar a solicitação.') }
  }

  if (!can('tasks', 'view')) return <><PageHeading title="Solicitações internas" description="Seu perfil não tem permissão para consultar solicitações." /><MailboxEmpty icon={Inbox} title="Acesso restrito" text="Peça ao administrador da empresa para conceder acesso a Tarefas." /></>

  return <>
    <PageHeading
      title="Solicitações internas"
      description="Peça ajuda, encaminhe demandas e acompanhe as respostas da equipe em um só lugar."
      action={can('tasks', 'create') && <button className="blue-button" onClick={() => setComposeOpen(true)}><Plus size={16} /> Nova solicitação</button>}
    />
    <div className={`internal-mailbox ${selectedId ? 'has-selection' : ''}`}>
      <section className="internal-mail-panel">
        <div className="internal-mail-toolbar">
          <div className="internal-mail-tabs" role="tablist" aria-label="Pastas de solicitações">
            <button className={folder === 'inbox' ? 'active' : ''} onClick={() => { setSelectedId(null); setDetail(null); setFolder('inbox') }}><Inbox size={15} /> Caixa de entrada <span>{counts.unread}</span></button>
            <button className={folder === 'sent' ? 'active' : ''} onClick={() => { setSelectedId(null); setDetail(null); setFolder('sent') }}><Send size={14} /> Enviados <span>{counts.sent}</span></button>
          </div>
          <form className="internal-mail-search" onSubmit={(event) => { event.preventDefault(); setSearch(searchInput.trim()) }}>
            <Search size={15} /><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Buscar solicitações" aria-label="Buscar solicitações" />
            {search && <button type="button" aria-label="Limpar busca" onClick={() => { setSearch(''); setSearchInput('') }}><X size={14} /></button>}
          </form>
          <button className="internal-mail-refresh" onClick={() => void load()} aria-label="Atualizar caixa de entrada"><RefreshCw size={15} /></button>
        </div>
        <div className="internal-mail-list" aria-live="polite">
          {loading && <MailboxEmpty icon={RefreshCw} title="Carregando solicitações" text="Aguarde enquanto atualizamos sua caixa." />}
          {!loading && error && <MailboxEmpty icon={Mail} title="Não foi possível carregar" text={error} action={<button className="outline-button" onClick={() => void load()}>Tentar novamente</button>} />}
          {!loading && !error && !requests.length && <MailboxEmpty icon={folder === 'inbox' ? Inbox : Send} title={search ? 'Nenhum resultado encontrado' : folder === 'inbox' ? 'Sua caixa de entrada está vazia' : 'Nenhuma solicitação enviada'} text={search ? 'Tente buscar por outro assunto ou pessoa.' : folder === 'inbox' ? 'Quando alguém enviar uma solicitação para você, ela aparecerá aqui.' : 'As solicitações que você enviar ficarão registradas nesta pasta.'} />}
          {!loading && !error && requests.map((item) => {
            const unread = folder === 'inbox' && !item.read_at
            const correspondent = folder === 'inbox' ? item.sender_name : (item.recipient_names || []).join(', ')
            return <button key={item.id} className={`internal-mail-row ${selectedId === item.id ? 'selected' : ''} ${unread ? 'unread' : ''}`} onClick={() => void openRequest(item.id)}>
              <span className="internal-mail-avatar">{(correspondent || '?').trim().charAt(0).toUpperCase()}</span>
              <span className="internal-mail-row-content">
                <span className="internal-mail-row-top"><b>{correspondent || (folder === 'sent' ? `${item.recipient_count} destinatários` : 'Usuário')}</b><time>{dateTime(item.updated_at)}</time></span>
                <strong>{item.title}</strong>
                <span className="internal-mail-preview">{item.description}</span>
                <span className="internal-mail-row-bottom"><StatusBadge status={folder === 'inbox' ? item.recipient_status || item.status : item.status} />{item.project_name && <small>{item.project_name}</small>}{item.recipient_count > 1 && folder === 'sent' && <small><Users size={12} /> {item.recipient_count} pessoas</small>}</span>
              </span>
              {unread && <i className="internal-mail-unread-dot" aria-label="Não lida" />}
            </button>
          })}
        </div>
        <footer className="internal-mail-list-footer">{folder === 'inbox' ? `${counts.inbox} solicitações recebidas` : `${counts.sent} solicitações enviadas`}{counts.unread > 0 && folder === 'inbox' ? ` · ${counts.unread} não lidas` : ''}</footer>
      </section>

      <section className={`internal-conversation ${selectedId ? 'visible' : ''}`}>
        {!selectedId && <MailboxEmpty icon={MailOpen} title="Abra uma solicitação" text="Selecione uma conversa para ver os detalhes e responder." />}
        {selectedId && detailLoading && <MailboxEmpty icon={RefreshCw} title="Abrindo solicitação" text="Carregando conversa e participantes." />}
        {selectedId && !detailLoading && detail?.error && <MailboxEmpty icon={Mail} title="Solicitação indisponível" text={detail.error} action={<button className="outline-button" onClick={() => { setSelectedId(null); setDetail(null) }}>Voltar à caixa</button>} />}
        {selectedId && !detailLoading && detail && !detail.error && <>
          <header className="internal-conversation-header">
            <button className="internal-back-button" onClick={() => { setSelectedId(null); setDetail(null) }} aria-label="Voltar à caixa"><ArrowLeft size={17} /></button>
            <div className="internal-conversation-title"><span className="section-kicker">{folder === 'inbox' ? 'RECEBIDA' : 'ENVIADA'} · {dateTime(detail.created_at)}</span><h2>{detail.title}</h2><p>{detail.project_name ? `Obra: ${detail.project_name}` : 'Solicitação interna'}{detail.due_date ? ` · Prazo: ${dateOnly(detail.due_date)}` : ''}</p></div>
            {detail.is_sender && detail.status !== 'CANCELADA' && detail.status !== 'CONCLUIDA' && <button className="internal-cancel-button" onClick={() => void cancelRequest()}>Cancelar</button>}
          </header>
          <div className="internal-conversation-meta">
            <div><span className="internal-mail-avatar large">{(detail.sender_name || '?').charAt(0).toUpperCase()}</span><span><b>{detail.sender_name}</b><small>{detail.sender_email} · enviou a {detail.recipients?.length || 0} pessoa(s)</small></span></div>
            <span className="internal-recipient-list"><Users size={14} /> {detail.recipients?.map((recipient) => recipient.name).join(', ')}</span>
          </div>
          <div className="internal-conversation-messages" aria-live="polite">
            {(detail.messages || []).map((message) => message.message_type === 'SISTEMA'
              ? <div className="internal-system-message" key={message.id}><Clock3 size={13} />{message.message}<time>{dateTime(message.created_at)}</time></div>
              : <article className={`internal-message ${message.user_id === session.id ? 'mine' : ''}`} key={message.id}><header><b>{message.user_id === session.id ? 'Você' : message.user_name}</b><time>{dateTime(message.created_at)}</time></header><p>{message.message}</p></article>)}
          </div>
          <div className="internal-conversation-bottom">
            {!detail.is_sender && <div className="internal-recipient-status"><span>Seu andamento</span><StatusBadge status={detail.recipient_status} /><div>{[['PENDENTE', 'Aguardando'], ['EM_ANDAMENTO', 'Em andamento'], ['CONCLUIDA', 'Concluída']].map(([status, label]) => <button key={status} className={detail.recipient_status === status ? 'active' : ''} disabled={detail.status === 'CANCELADA' || detail.recipient_status === status || !can('tasks', 'edit')} onClick={() => void updateStatus(status)}>{status === 'CONCLUIDA' && <Check size={13} />}{label}</button>)}</div></div>}
            {detail.status === 'CANCELADA' && <div className="internal-closed-note">Esta solicitação foi cancelada. O histórico continua disponível.</div>}
            {detail.status === 'CONCLUIDA' && <div className="internal-closed-note"><CheckCheck size={15} /> Todos os destinatários concluíram esta solicitação.</div>}
            {detail.status !== 'CANCELADA' && can('tasks', 'edit') && <form className="internal-reply-form" onSubmit={sendReply}><textarea value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Escreva uma resposta para esta conversa..." rows={3} maxLength={12000} aria-label="Escreva uma resposta" /><div><span>{reply.length}/12.000</span><button className="blue-button" disabled={sendingReply || !reply.trim()}><Send size={14} /> {sendingReply ? 'Enviando...' : 'Responder'}</button></div></form>}
          </div>
        </>}
      </section>
    </div>
    {composeOpen && <ComposeRequest session={session} headers={headers} onClose={() => setComposeOpen(false)} onSent={async (requestId) => { setComposeOpen(false); setFolder('sent'); setSearch(''); setSearchInput(''); await openRequest(requestId); void load() }} notify={notify} />}
  </>
}

function ComposeRequest({ session, headers, onClose, onSent, notify }) {
  const [people, setPeople] = useState([])
  const [projects, setProjects] = useState([])
  const [selectedPeople, setSelectedPeople] = useState([])
  const [peopleSearch, setPeopleSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState('')
  useEffect(() => {
    let active = true
    Promise.all([
      fetch(`${API_URL}/tasks/users`, { headers }).then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error || 'Não foi possível carregar as pessoas da empresa.'); return payload }),
      fetch(`${API_URL}/projects?page=1&pageSize=100`, { headers }).then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error || 'Não foi possível carregar as obras.'); return Array.isArray(payload) ? payload : payload.data || [] }),
    ]).then(([users, projectRows]) => { if (active) { setPeople(users); setProjects(projectRows) } }).catch((error) => { if (active) setLoadError(error.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [headers])
  const visiblePeople = people.filter((person) => `${person.name} ${person.email} ${person.job_title || ''}`.toLowerCase().includes(peopleSearch.toLowerCase()))

  async function submit(event) {
    event.preventDefault()
    if (!selectedPeople.length) { notify('Escolha pelo menos uma pessoa para receber a solicitação.'); return }
    const form = new FormData(event.currentTarget)
    const data = { title: String(form.get('title') || '').trim(), description: String(form.get('description') || '').trim(), recipient_ids: selectedPeople, project_id: form.get('project_id') || null, due_date: form.get('due_date') || null }
    setSaving(true)
    try {
      const response = await fetch(`${API_URL}/tasks`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Não foi possível enviar a solicitação.')
      notify('Solicitação enviada para a equipe.')
      await onSent(payload.id)
    } catch (error) { notify(error.message || 'Não foi possível enviar a solicitação.') }
    finally { setSaving(false) }
  }

  return <div className="modal-layer internal-compose-layer" onClick={onClose}>
    <form className="modal-card internal-compose" onClick={(event) => event.stopPropagation()} onSubmit={submit}>
      <button type="button" className="modal-x" onClick={onClose} aria-label="Fechar"><X size={18} /></button>
      <span className="section-kicker">NOVA SOLICITAÇÃO</span><h2>Escreva para a equipe</h2><p>O pedido e as respostas ficam registrados na caixa da empresa.</p>
      {loadError && <div className="form-error">{loadError}</div>}
      {loading ? <MailboxEmpty icon={RefreshCw} title="Carregando destinatários" text="Buscando usuários ativos da empresa." /> : <>
        <label className="field"><span>Para <small>{selectedPeople.length ? `${selectedPeople.length} selecionado(s)` : 'Selecione uma ou mais pessoas'}</small></span><div className="internal-recipient-picker"><div className="internal-recipient-search"><Search size={14} /><input value={peopleSearch} onChange={(event) => setPeopleSearch(event.target.value)} placeholder="Buscar por nome ou e-mail" /></div><div className="internal-recipient-options">{visiblePeople.map((person) => <label key={person.id} className={selectedPeople.includes(person.id) ? 'selected' : ''}><input type="checkbox" checked={selectedPeople.includes(person.id)} onChange={() => setSelectedPeople((current) => current.includes(person.id) ? current.filter((id) => id !== person.id) : [...current, person.id])} /><span><b>{person.name}</b><small>{person.job_title || person.email}</small></span></label>)}{!visiblePeople.length && <div className="internal-recipient-none">{people.length ? 'Nenhuma pessoa corresponde à busca.' : 'Não há outras contas ativas na empresa.'}</div>}</div></div></label>
        <label className="field"><span>Assunto</span><input name="title" required maxLength={180} placeholder="Ex.: Cotação de locação de caminhão munck 60 t" /></label>
        <label className="field"><span>Mensagem</span><textarea name="description" required maxLength={12000} rows={6} placeholder="Explique o que precisa, os detalhes e quando é necessário." /></label>
        <div className="form-grid"><label className="field"><span>Obra relacionada <small>opcional</small></span><select name="project_id" defaultValue=""><option value="">Nenhuma obra</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label className="field"><span>Prazo <small>opcional</small></span><input type="date" name="due_date" /></label></div>
      </>}
      <div className="modal-actions"><button type="button" className="outline-button" onClick={onClose}>Cancelar</button><button className="blue-button" disabled={loading || saving || Boolean(loadError) || !selectedPeople.length}><Send size={14} /> {saving ? 'Enviando...' : 'Enviar solicitação'}</button></div>
    </form>
  </div>
}

function StatusBadge({ status }) {
  const state = status || 'PENDENTE'
  const tone = state === 'CONCLUIDA' ? 'complete' : state === 'CANCELADA' ? 'cancelled' : state === 'EM_ANDAMENTO' ? 'progress' : 'pending'
  return <span className={`internal-status ${tone}`}>{requestStatuses[state] || recipientStatuses[state] || state}</span>
}

function MailboxEmpty({ icon: Icon, title, text, action }) {
  return <div className="internal-mail-empty"><span><Icon size={20} /></span><b>{title}</b><p>{text}</p>{action}</div>
}

function PageHeading({ title, description, action }) {
  return <section className="section-heading"><div><span className="section-kicker">COMUNICAÇÃO DA EMPRESA</span><h1>{title}</h1><p>{description}</p></div>{action}</section>
}

export { InternalRequestsPage }
