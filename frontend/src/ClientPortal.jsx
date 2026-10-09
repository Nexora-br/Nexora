import { useEffect, useState } from 'react'
import { ArrowLeft, Download, LogOut, Send, ShieldCheck } from 'lucide-react'
import { API_URL } from './apiConfig'
import './AppNew.css'

const tokenKey = 'nexora-client-portal-session'
const api = async (route, token, options = {}) => {
  const response = await fetch(`${API_URL}${route}`, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || 'Não foi possível concluir a operação.')
  return body
}

export default function ClientPortal({ initialSession, onExit }) {
  const [session, setSession] = useState(initialSession)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [user, setUser] = useState(null)
  const [projects, setProjects] = useState([])
  const [selected, setSelected] = useState(null)
  const [project, setProject] = useState(null)
  const [approvals, setApprovals] = useState([])
  const [form, setForm] = useState({ project_id: '', title: '', description: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [previewPhoto, setPreviewPhoto] = useState(null)

  useEffect(() => {
    if (!session?.token) return
    let alive = true
    Promise.all([api('/client-portal/me', session.token), api('/client-portal/projects', session.token), api('/client-portal/approvals', session.token)])
      .then(([who, rows, requests]) => { if (!alive) return; setUser(who); setProjects(rows); setApprovals(requests); setSelected((current) => current || rows[0] || null); setForm((current) => ({ ...current, project_id: current.project_id || rows[0]?.id || '' })) })
      .catch((e) => { if (alive) { localStorage.removeItem(tokenKey); setSession(null); setError(e.message) } })
    return () => { alive = false }
  }, [session?.token])

  useEffect(() => {
    if (!selected || !session?.token) { setProject(null); return }
    let alive = true
    api(`/client-portal/projects/${encodeURIComponent(selected.id)}`, session.token).then((data) => { if (alive) setProject(data) }).catch((e) => { if (alive) setError(e.message) })
    return () => { alive = false }
  }, [selected?.id, session?.token])

  async function login(event) {
    event.preventDefault(); setBusy(true); setError('')
    try { const result = await api('/client-portal/auth/login', null, { method: 'POST', body: JSON.stringify({ email, password }) }); const next = { token: result.token }; localStorage.setItem(tokenKey, JSON.stringify(next)); setSession(next); setPassword('') }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  async function createApproval(event) {
    event.preventDefault(); setBusy(true); setError('')
    try { await api('/client-portal/approvals', session.token, { method: 'POST', body: JSON.stringify(form) }); setApprovals(await api('/client-portal/approvals', session.token)); setForm((current) => ({ ...current, title: '', description: '' })) }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  async function download(route, name) {
    try { const response = await fetch(`${API_URL}${route}`, { headers: { Authorization: `Bearer ${session.token}` } }); if (!response.ok) throw new Error('Arquivo não disponível.'); const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href = url; link.download = name || 'arquivo'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000) }
    catch (e) { setError(e.message) }
  }
  async function openPhoto(route, name) { try { const response = await fetch(`${API_URL}${route}`, { headers: { Authorization: `Bearer ${session.token}` } }); if (!response.ok) throw new Error('Foto não disponível.'); setPreviewPhoto({ url: URL.createObjectURL(await response.blob()), name }) } catch (e) { setError(e.message) } }
  function logout() { localStorage.removeItem(tokenKey); setSession(null); setUser(null); setProjects([]); setSelected(null); setProject(null); setApprovals([]) }
  function exitPortal() { localStorage.removeItem(tokenKey); onExit() }

  if (!session?.token) return <main className="client-portal-login"><button className="landing-text-link" onClick={exitPortal}><ArrowLeft size={16} /> Voltar ao site</button><form className="panel client-portal-login-card" onSubmit={login}><img src={`${import.meta.env.BASE_URL}logo_sem_fundo.png`} alt="Nexora" /><span className="section-kicker">ACESSO EXTERNO</span><h1>Portal do cliente</h1><p>Acompanhe suas obras, arquivos liberados e solicitações de aprovação.</p>{error && <div className="inline-error">{error}</div>}<label className="field"><span>E-mail</span><input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label><label className="field"><span>Senha</span><input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label><button className="blue-button" disabled={busy}>{busy ? 'Entrando…' : 'Entrar no portal'}</button><small><ShieldCheck size={14} /> Acesso limitado às obras da sua empresa.</small></form></main>

  return <main className="client-portal-shell"><header className="client-portal-header"><div><img src={`${import.meta.env.BASE_URL}logo_sem_fundo.png`} alt="Nexora" /><span>PORTAL DO CLIENTE</span></div><p>{user?.clientName} <small>{user?.user?.name}</small></p><button className="outline-button" onClick={logout}><LogOut size={15} /> Sair</button></header>
    {error && <div className="client-portal-error" role="alert">{error}<button onClick={() => setError('')}>Fechar</button></div>}
    <section className="client-portal-welcome"><span className="section-kicker">ÁREA DO CLIENTE</span><h1>Acompanhe o andamento da obra</h1><p>Consulte atualizações e arquivos que a equipe da obra liberou para você.</p></section>
    <div className="client-portal-layout"><aside className="panel client-portal-projects"><h2>Suas obras</h2>{projects.map((item) => <button key={item.id} className={selected?.id === item.id ? 'selected' : ''} onClick={() => setSelected(item)}><b>{item.name}</b><small>{item.code} · {Number(item.progress || 0)}% concluído</small></button>)}{!projects.length && <p>Nenhuma obra está vinculada a este acesso.</p>}</aside>
      <section className="client-portal-content">{project ? <><article className="panel client-portal-progress"><div><span className="section-kicker">{project.project.code} · {project.project.status}</span><h2>{project.project.name}</h2><p>{[project.project.location, project.project.city, project.project.state].filter(Boolean).join(' · ') || 'Local da obra não informado'}</p></div><strong>{Number(project.project.progress || 0)}%</strong><div className="client-portal-progress-track"><i style={{ width: `${Math.max(0, Math.min(100, Number(project.project.progress || 0)))}%` }} /></div>{project.stages?.length > 0 && <div className="client-portal-stages">{project.stages.map((stage) => <div key={stage.id}><span>{stage.name}</span><b>{stage.status} · {Number(stage.progress || 0)}%</b></div>)}</div>}</article>
        <article className="panel"><h2>Atualizações e fotos liberadas</h2><div className="client-portal-updates">{project.diaries.map((entry) => <section key={entry.id}><h3>{new Date(`${entry.entry_date}T12:00:00`).toLocaleDateString('pt-BR')}</h3><p>{entry.activities || 'Atualização da obra.'}</p>{entry.photos.length > 0 && <div className="client-portal-files">{entry.photos.map((photo) => <button key={photo.id} className="outline-button" onClick={() => openPhoto(photo.url, photo.name)}>{photo.name}</button>)}</div>}{entry.has_pdf && <button className="outline-button" onClick={() => download(`/client-portal/projects/${project.project.id}/diaries/${entry.id}/pdf`, entry.pdf_name)}><Download size={14} /> {entry.pdf_name || 'Baixar diário PDF'}</button>}</section>)}{!project.diaries.length && <p className="client-portal-empty">A equipe ainda não liberou atualizações para esta obra.</p>}</div></article>
        <article className="panel"><h2>Documentos liberados</h2><div className="client-portal-files">{project.documents.map((doc) => <button key={doc.id} className="outline-button" onClick={() => download(`/client-portal/projects/${project.project.id}/documents/${doc.id}`, doc.name)}><Download size={14} /> {doc.name}</button>)}</div>{!project.documents.length && <p className="client-portal-empty">Nenhum documento foi liberado.</p>}</article>
      </> : <article className="panel client-portal-empty">Selecione uma obra para consultar atualizações e arquivos.</article>}
      <article className="panel"><h2>Solicitar aprovação</h2><p>Envie uma pergunta ou decisão necessária para a equipe responsável.</p><form className="client-portal-approval-form" onSubmit={createApproval}><label className="field"><span>Obra</span><select required value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })}><option value="">Selecione uma obra</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="field"><span>O que precisa de aprovação?</span><input maxLength="160" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ex.: Aprovação do acabamento" /></label><label className="field"><span>Detalhes</span><textarea maxLength="3000" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label><button className="blue-button" disabled={busy || !projects.length}><Send size={15} /> Enviar solicitação</button></form><div className="client-portal-requests">{approvals.map((item) => <div key={item.id}><b>{item.title}</b><small>{item.project_name} · {item.status} · {new Date(item.created_at).toLocaleDateString('pt-BR')}</small>{item.response_note && <p>Resposta: {item.response_note}</p>}</div>)}{!approvals.length && <p className="client-portal-empty">Suas solicitações aparecerão aqui.</p>}</div></article>
    </section>{previewPhoto && <div className="modal-layer" onClick={() => { URL.revokeObjectURL(previewPhoto.url); setPreviewPhoto(null) }}><figure className="modal-card client-portal-photo-preview" onClick={(event) => event.stopPropagation()}><button className="modal-x" onClick={() => { URL.revokeObjectURL(previewPhoto.url); setPreviewPhoto(null) }}>Fechar</button><img src={previewPhoto.url} alt={previewPhoto.name} /><figcaption>{previewPhoto.name}</figcaption></figure></div>}</div></main>
}
