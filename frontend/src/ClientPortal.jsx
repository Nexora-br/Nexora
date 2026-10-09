import { useEffect, useState } from 'react'
import { ArrowLeft, Download, LogOut, ShieldCheck } from 'lucide-react'
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
  const [portalTab, setPortalTab] = useState('diaries')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [previewPhoto, setPreviewPhoto] = useState(null)

  useEffect(() => {
    if (!session?.token) return
    let alive = true
    Promise.all([api('/client-portal/me', session.token), api('/client-portal/projects', session.token)])
      .then(([who, rows]) => { if (!alive) return; setUser(who); setProjects(rows); setSelected((current) => current || rows[0] || null) })
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
  async function download(route, name) {
    try { const response = await fetch(`${API_URL}${route}`, { headers: { Authorization: `Bearer ${session.token}` } }); if (!response.ok) throw new Error('Arquivo não disponível.'); const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href = url; link.download = name || 'arquivo'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000) }
    catch (e) { setError(e.message) }
  }
  async function openPhoto(route, name) { try { const response = await fetch(`${API_URL}${route}`, { headers: { Authorization: `Bearer ${session.token}` } }); if (!response.ok) throw new Error('Foto não disponível.'); setPreviewPhoto({ url: URL.createObjectURL(await response.blob()), name }) } catch (e) { setError(e.message) } }
  function logout() { localStorage.removeItem(tokenKey); setSession(null); setUser(null); setProjects([]); setSelected(null); setProject(null) }
  function exitPortal() { localStorage.removeItem(tokenKey); onExit() }

  if (!session?.token) return <main className="client-portal-login"><button className="landing-text-link" onClick={exitPortal}><ArrowLeft size={16} /> Voltar ao site</button><form className="panel client-portal-login-card" onSubmit={login}><img src={`${import.meta.env.BASE_URL}logo_sem_fundo.png`} alt="Nexora" /><span className="section-kicker">ACESSO EXTERNO</span><h1>Portal do cliente</h1><p>Acompanhe suas obras e consulte arquivos liberados.</p>{error && <div className="inline-error">{error}</div>}<label className="field"><span>E-mail</span><input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label><label className="field"><span>Senha</span><input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label><button className="blue-button" disabled={busy}>{busy ? 'Entrando…' : 'Entrar no portal'}</button><small><ShieldCheck size={14} /> Acesso limitado às obras da sua empresa.</small></form></main>

  return <main className="client-portal-shell"><header className="client-portal-header"><div><img src={`${import.meta.env.BASE_URL}logo_sem_fundo.png`} alt="Nexora" /><span>PORTAL DO CLIENTE</span></div><p>{user?.clientName} <small>{user?.user?.name}</small></p><button className="outline-button" onClick={logout}><LogOut size={15} /> Sair</button></header>
    {error && <div className="client-portal-error" role="alert">{error}<button onClick={() => setError('')}>Fechar</button></div>}
    <section className="client-portal-welcome"><span className="section-kicker">ÁREA DO CLIENTE</span><h1>Acompanhe o andamento da obra</h1><p>Consulte atualizações e arquivos que a equipe da obra liberou para você.</p></section>
    <div className="client-portal-layout"><aside className="panel client-portal-projects"><h2>Suas obras</h2><label className="field"><span>Selecionar obra</span><select value={selected?.id || ''} onChange={(event) => { setProject(null); setPortalTab('diaries'); setSelected(projects.find((item) => item.id === event.target.value) || null) }} disabled={!projects.length}><option value="">{projects.length ? 'Escolha uma obra' : 'Nenhuma obra vinculada'}</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label><p>O portal mostra somente as obras vinculadas a este contratante.</p></aside>
      <section className="client-portal-content">{project ? <><article className="panel client-portal-progress"><div><span className="section-kicker">{project.project.code} · {project.project.status}</span><h2>{project.project.name}</h2><p>{[project.project.location, project.project.city, project.project.state].filter(Boolean).join(' · ') || 'Local da obra não informado'}</p></div><strong>{Number(project.project.progress || 0)}%</strong><div className="client-portal-progress-track"><i style={{ width: `${Math.max(0, Math.min(100, Number(project.project.progress || 0)))}%` }} /></div>{project.stages?.length > 0 && <div className="client-portal-stages">{project.stages.map((stage) => <div key={stage.id}><span>{stage.name}</span><b>{stage.status} · {Number(stage.progress || 0)}%</b></div>)}</div>}</article>
        <div className="client-portal-tabs" role="tablist" aria-label="Conteúdo da obra"><button type="button" role="tab" aria-selected={portalTab === 'diaries'} className={portalTab === 'diaries' ? 'selected' : ''} onClick={() => setPortalTab('diaries')}>Diários de obra</button><button type="button" role="tab" aria-selected={portalTab === 'documents'} className={portalTab === 'documents' ? 'selected' : ''} onClick={() => setPortalTab('documents')}>Documentos</button></div>
        {portalTab === 'diaries' ? <article className="panel" role="tabpanel"><h2>Diários de obra</h2><div className="client-portal-updates">{project.diaries.map((entry) => <section key={entry.id}><h3>{new Date(`${entry.entry_date}T12:00:00`).toLocaleDateString('pt-BR')}</h3><p>{entry.activities || 'Atualização da obra.'}</p>{entry.photos.length > 0 && <div className="client-portal-files">{entry.photos.map((photo) => <button key={photo.id} className="outline-button" onClick={() => openPhoto(photo.url, photo.name)}>{photo.name}</button>)}</div>}{entry.has_pdf && <button className="outline-button" onClick={() => download(`/client-portal/projects/${project.project.id}/diaries/${entry.id}/pdf`, entry.pdf_name)}><Download size={14} /> {entry.pdf_name || 'Baixar diário PDF'}</button>}</section>)}{!project.diaries.length && <p className="client-portal-empty">Nenhum diário cadastrado para esta obra.</p>}</div></article> : <article className="panel" role="tabpanel"><h2>Documentos liberados</h2><div className="client-portal-files">{project.documents.map((doc) => <button key={doc.id} className="outline-button" onClick={() => download(`/client-portal/projects/${project.project.id}/documents/${doc.id}`, doc.name)}><Download size={14} /> {doc.name}</button>)}</div>{!project.documents.length && <p className="client-portal-empty">Nenhum documento foi liberado.</p>}</article>}
      </> : <article className="panel client-portal-empty">{selected ? 'Carregando as informações da obra…' : projects.length ? 'Selecione uma obra para consultar os diários e arquivos liberados.' : 'Nenhuma obra está vinculada a este acesso.'}</article>}
    </section>{previewPhoto && <div className="modal-layer" onClick={() => { URL.revokeObjectURL(previewPhoto.url); setPreviewPhoto(null) }}><figure className="modal-card client-portal-photo-preview" onClick={(event) => event.stopPropagation()}><button className="modal-x" onClick={() => { URL.revokeObjectURL(previewPhoto.url); setPreviewPhoto(null) }}>Fechar</button><img src={previewPhoto.url} alt={previewPhoto.name} /><figcaption>{previewPhoto.name}</figcaption></figure></div>}</div></main>
}
