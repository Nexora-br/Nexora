import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CalendarDays, Check, Factory, History, MapPin, Plus, RefreshCw, UserRound, UsersRound, X } from 'lucide-react'
import { API_URL } from './apiConfig'

const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
const dateText = (value) => value ? new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : 'Em andamento'

export function TeamsPage({ session, can, notify }) {
  const [data, setData] = useState({ projects: [], employees: [], allocations: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [modal, setModal] = useState(false)
  const [ending, setEnding] = useState(null)
  const [expanded, setExpanded] = useState({})
  const headers = { Authorization: `Bearer ${session.token}` }

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const response = await fetch(`${API_URL}/teams`, { headers })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Não foi possível carregar as equipes.')
      setData(result)
    } catch (problem) { setError(problem instanceof TypeError ? 'Não foi possível conectar ao sistema.' : problem.message || 'Não foi possível carregar as equipes.') }
    finally { setLoading(false) }
  }, [session.token])
  useEffect(() => { void load() }, [load])

  async function request(url, options = {}) {
    const response = await fetch(`${API_URL}${url}`, { ...options, headers: { ...headers, ...(options.headers || {}) } })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(result.error || 'Não foi possível concluir a operação.')
    return result
  }
  async function saveAllocation(event) {
    event.preventDefault()
    const form = Object.fromEntries(new FormData(event.currentTarget))
    try {
      await request('/teams/allocations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      notify('Funcionário alocado à obra. A alocação anterior, se houver, foi encerrada e mantida no histórico.')
      setModal(false); await load()
    } catch (problem) { notify(problem.message || 'Não foi possível alocar o funcionário.') }
  }
  async function endAllocation(event) {
    event.preventDefault()
    const endDate = new FormData(event.currentTarget).get('end_date')
    try {
      await request(`/teams/allocations/${ending.id}/end`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ end_date: endDate }) })
      notify('Alocação encerrada. O histórico da equipe foi preservado.')
      setEnding(null); await load()
    } catch (problem) { notify(problem.message || 'Não foi possível encerrar a alocação.') }
  }

  if (!can('teams', 'view')) return <><header className="section-heading"><div><span className="section-kicker">OBRAS E EQUIPE</span><h1>Equipes</h1><p>Seu perfil não tem permissão para consultar as equipes das obras.</p></div></header><div className="panel team-empty">Peça ao administrador acesso ao módulo Equipes.</div></>

  const availableProjects = data.projects.filter((project) => !['FINALIZADO', 'CANCELADO'].includes(String(project.status || '').toUpperCase()))
  const activeAllocations = data.allocations.filter((item) => !item.end_date)
  const assignedIds = new Set(activeAllocations.map((item) => item.employee_id))
  const unassignedCount = data.employees.filter((person) => !assignedIds.has(person.id)).length
  return <>
    <header className="section-heading"><div><span className="section-kicker">ALOCAÇÃO DE CAMPO</span><h1>Equipes por obra</h1><p>Monte a equipe de cada obra e acompanhe as realocações sem perder o histórico.</p></div>{can('teams', 'create') && <button className="blue-button" onClick={() => setModal(true)} disabled={!availableProjects.length || !data.employees.length}><Plus size={17} /> Alocar funcionário</button>}</header>
    <div className="team-metrics"><article className="panel"><span><Factory size={16} /> Obras disponíveis</span><b>{data.projects.length}</b><small>Obras cadastradas e em andamento</small></article><article className="panel"><span><UsersRound size={16} /> Alocações ativas</span><b>{activeAllocations.length}</b><small>Funcionários atualmente nas obras</small></article><article className="panel"><span><UserRound size={16} /> Sem alocação ativa</span><b>{unassignedCount}</b><small>Funcionários ativos disponíveis</small></article></div>
    <section className="page-panel panel team-panel"><div className="panel-heading"><div><h2>Equipes de montagem</h2><p>As obras e os funcionários vêm dos cadastros do Nexora.</p></div><button className="quiet-button" onClick={load}><RefreshCw size={14} /> Atualizar</button></div>
      {loading ? <div className="team-empty">Carregando equipes…</div> : error ? <div className="team-empty team-error">{error}<button className="outline-button" onClick={load}>Tentar novamente</button></div> : !data.projects.length ? <div className="team-empty"><Factory size={22} /><b>Nenhuma obra disponível</b><span>Cadastre uma obra em “Projetos e obras” para começar a montar equipes.</span></div> : <div className="team-project-list">{data.projects.map((project) => {
        const projectAssignments = data.allocations.filter((item) => item.project_id === project.id)
        const active = projectAssignments.filter((item) => !item.end_date)
        const isExpanded = Boolean(expanded[project.id])
        return <article className="team-project-card" key={project.id}>
          <div className="team-project-top"><span className="team-project-icon"><Factory size={17} /></span><div className="team-project-title"><div><b>{project.name}</b><small>{project.code} · {project.status?.replaceAll('_', ' ')}</small></div>{project.location && <small className="team-location"><MapPin size={12} />{project.location}</small>}</div><span className="team-count"><UsersRound size={14} />{active.length} ativos</span></div>
          {active.length ? <div className="team-roster">{active.map((item) => <div className="team-person" key={item.id}><span className="team-person-avatar"><UserRound size={14} /></span><div><b>{item.employee_name}</b><small>{item.job_title || 'Montagem'} · desde {dateText(item.start_date)}</small></div>{can('teams', 'edit') && <button className="table-action danger" onClick={() => setEnding(item)}>Realocar / encerrar</button>}</div>)}</div> : <div className="team-no-members">Ainda não há funcionários alocados nesta obra.</div>}
          {projectAssignments.length > active.length && <button className="team-history-toggle" onClick={() => setExpanded((current) => ({ ...current, [project.id]: !isExpanded }))}><History size={14} />{isExpanded ? 'Ocultar histórico' : `Ver histórico (${projectAssignments.length - active.length})`}</button>}
          {isExpanded && <div className="team-history-list">{projectAssignments.filter((item) => item.end_date).map((item) => <div className="team-history-row" key={item.id}><Check size={14} /><span><b>{item.employee_name}</b>{item.job_title ? ` · ${item.job_title}` : ''}</span><small>{dateText(item.start_date)} – {dateText(item.end_date)}</small></div>)}</div>}
        </article>
      })}</div>}
    </section>
    {modal && <div className="modal-layer" onClick={() => setModal(false)}><form className="modal-card team-form" onClick={(event) => event.stopPropagation()} onSubmit={saveAllocation}><button type="button" className="modal-x" onClick={() => setModal(false)}><X size={18} /></button><span className="section-kicker">EQUIPE DA OBRA</span><h2>Alocar funcionário</h2><p>Escolha uma obra existente e um funcionário ativo já cadastrado.</p><label className="field"><span>Obra</span><select name="project_id" required defaultValue=""><option value="" disabled>Selecione a obra</option>{availableProjects.map((project) => <option key={project.id} value={project.id}>{project.code} · {project.name}</option>)}</select></label><label className="field"><span>Funcionário ativo</span><select name="employee_id" required defaultValue=""><option value="" disabled>Selecione o funcionário</option>{data.employees.map((person) => <option key={person.id} value={person.id}>{person.name}{person.job_title ? ` · ${person.job_title}` : ''}{assignedIds.has(person.id) ? ' · atualmente em outra obra' : ''}</option>)}</select></label><div className="form-grid"><label className="field"><span>Função nesta obra</span><input name="job_title" placeholder="Ex.: Montador líder" /></label><label className="field"><span>Início da alocação</span><input name="start_date" type="date" defaultValue={today()} required /></label></div><label className="field"><span>Previsão de término (opcional)</span><input name="end_date" type="date" /></label><label className="field"><span>Observações</span><textarea name="notes" rows="3" placeholder="Turno, frente de montagem ou outras informações" /></label><div className="team-reallocation-note"><AlertTriangle size={15} /><span>Se o funcionário já estiver em outra obra, a alocação atual será encerrada no dia anterior à nova data de início e ficará no histórico daquela obra.</span></div><div className="modal-actions"><button type="button" className="outline-button" onClick={() => setModal(false)}>Cancelar</button><button className="blue-button"><Plus size={15} /> Confirmar alocação</button></div></form></div>}
    {ending && <div className="modal-layer" onClick={() => setEnding(null)}><form className="modal-card team-form" onClick={(event) => event.stopPropagation()} onSubmit={endAllocation}><button type="button" className="modal-x" onClick={() => setEnding(null)}><X size={18} /></button><span className="section-kicker">REALOCAR FUNCIONÁRIO</span><h2>Encerrar alocação atual</h2><p>{ending.employee_name} · {ending.project_name}</p><label className="field"><span>Último dia nesta obra</span><input name="end_date" type="date" min={ending.start_date} defaultValue={today() < ending.start_date ? ending.start_date : today()} required /></label><div className="team-reallocation-note"><CalendarDays size={15} /><span>O registro continua no histórico. Para movê-lo, depois cadastre uma nova alocação na obra de destino.</span></div><div className="modal-actions"><button type="button" className="outline-button" onClick={() => setEnding(null)}>Cancelar</button><button className="blue-button">Encerrar alocação</button></div></form></div>}
  </>
}
