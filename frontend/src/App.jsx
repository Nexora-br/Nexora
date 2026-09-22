import { useEffect, useMemo, useState } from 'react'
import { Bell, CalendarDays, ChevronDown, CircleHelp, ClipboardList, CloudSun, Factory, LayoutDashboard, Menu, Package, Plus, Search, Settings2, Truck, Users, Warehouse, X } from 'lucide-react'
import './App.css'

const API_URL = 'http://localhost:3333/api'
const fallbackData = {
  stats: [
    { label: 'Projetos em andamento', value: '12', detail: '+2 este mês', tone: 'blue', icon: Factory },
    { label: 'Obras em campo', value: '07', detail: '3 com entrega esta semana', tone: 'orange', icon: Truck },
    { label: 'Estoque comprometido', value: '68%', detail: 'Dentro do planejado', tone: 'green', icon: Warehouse },
    { label: 'Faturamento previsto', value: 'R$ 842 mil', detail: '+18,4% vs. mês anterior', tone: 'purple', icon: ClipboardList },
  ],
  projects: [
    { code: 'NX-2408', name: 'Fazenda Santa Helena', location: 'Rio Verde, GO', type: 'Silo + Secador', progress: 78, status: 'Em montagem', value: 'R$ 486.200', due: '18 set 2026', tone: 'orange' },
    { code: 'NX-2411', name: 'Cooperativa Vale Grãos', location: 'Sorriso, MT', type: 'Bateria de silos', progress: 46, status: 'Fundação', value: 'R$ 1.240.000', due: '04 out 2026', tone: 'blue' },
    { code: 'NX-2405', name: 'Agroindustrial Boa Safra', location: 'Uberlândia, MG', type: 'Secador contínuo', progress: 92, status: 'Comissionamento', value: 'R$ 318.750', due: '12 set 2026', tone: 'green' },
  ],
  activities: [
    { title: 'Nota fiscal emitida', description: 'NF 004.821 · Fazenda Santa Helena', time: 'há 18 min', icon: ClipboardList, tone: 'blue' },
    { title: 'Carga saiu para o campo', description: 'Transportadora Rota 28 · NX-2411', time: 'há 1 h', icon: Truck, tone: 'orange' },
    { title: 'Medição aprovada', description: 'Etapa 03 · Agroindustrial Boa Safra', time: 'há 3 h', icon: Factory, tone: 'green' },
  ],
}
const menuItems = [
  { label: 'Visão geral', icon: LayoutDashboard },
  { label: 'Projetos e obras', icon: Factory, badge: '12' },
  { label: 'Estoque', icon: Package },
  { label: 'Agenda de campo', icon: CalendarDays },
  { label: 'Clientes', icon: Users },
]

function App() {
  const [activeMenu, setActiveMenu] = useState('Visão geral')
  const [query, setQuery] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [data, setData] = useState(fallbackData)

  useEffect(() => {
    fetch(`${API_URL}/dashboard`)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('API indisponível')))
      .then(setData)
      .catch(() => {})
  }, [])

  const filteredProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return data.projects
    return data.projects.filter((project) => `${project.name} ${project.location} ${project.code}`.toLowerCase().includes(normalizedQuery))
  }, [data.projects, query])

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? 'is-open' : ''}`}>
        <div className="brand"><img src="/logo_sem_fundo.png" alt="Nexora" /><span>gestão de projetos</span></div>
        <div className="workspace-switcher"><div className="workspace-avatar">NG</div><div><strong>Nexora Grãos</strong><small>Unidade central</small></div><ChevronDown size={16} /></div>
        <nav className="main-nav" aria-label="Navegação principal"><span className="nav-caption">GESTÃO</span>{menuItems.map(({ label, icon: Icon, badge }) => <button key={label} className={activeMenu === label ? 'active' : ''} onClick={() => { setActiveMenu(label); setSidebarOpen(false) }}><Icon size={18} /><span>{label}</span>{badge && <b>{badge}</b>}</button>)}<span className="nav-caption secondary-caption">ADMINISTRAÇÃO</span><button onClick={() => setActiveMenu('Configurações')} className={activeMenu === 'Configurações' ? 'active' : ''}><Settings2 size={18} /><span>Configurações</span></button><button onClick={() => setActiveMenu('Ajuda')} className={activeMenu === 'Ajuda' ? 'active' : ''}><CircleHelp size={18} /><span>Central de ajuda</span></button></nav>
        <div className="sidebar-footer"><div className="profile-avatar">AC</div><div><strong>André Costa</strong><small>Administrador</small></div><ChevronDown size={16} /></div>
      </aside>
      <main className="main-content">
        <header className="topbar"><button className="icon-button mobile-menu" aria-label="Abrir menu" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button><div className="breadcrumbs"><span>Início</span><strong>/</strong><b>{activeMenu}</b></div><div className="topbar-actions"><div className="global-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar projeto, cliente..." /><kbd>⌘ K</kbd></div><button className="icon-button notification-button" aria-label="Notificações"><Bell size={19} /><i /></button><div className="date-pill"><CalendarDays size={16} /> 21 de setembro, 2026</div></div></header>
        <div className="page-content"><section className="page-heading"><div><p className="eyebrow">SEGUNDA-FEIRA, 21 DE SETEMBRO DE 2026</p><h1>Bom dia, André <span>↗</span></h1><p className="heading-copy">Aqui está o panorama da sua operação hoje.</p></div><button className="primary-button" onClick={() => setShowModal(true)}><Plus size={18} /> Novo projeto</button></section><section className="stats-grid">{data.stats.map(({ label, value, detail, tone, icon: Icon }) => <article className="stat-card" key={label}><div className={`stat-icon ${tone}`}><Icon size={19} /></div><p>{label}</p><strong>{value}</strong><small className={detail.startsWith('+') ? 'positive' : ''}>{detail}</small></article>)}</section>
          <section className="content-grid"><div className="panel projects-panel"><div className="panel-heading"><div><h2>Projetos em andamento</h2><p>Acompanhe o avanço das obras ativas</p></div><button className="text-button">Ver todos <span>↗</span></button></div><div className="table-wrap"><table><thead><tr><th>PROJETO</th><th>TIPO</th><th>PROGRESSO</th><th>STATUS</th><th>ENTREGA</th></tr></thead><tbody>{filteredProjects.map((project) => <tr key={project.code}><td><div className="project-cell"><div className={`project-mark ${project.tone}`}><Factory size={16} /></div><div><strong>{project.name}</strong><small>{project.code} · {project.location}</small></div></div></td><td>{project.type}</td><td><div className="progress-cell"><div className="progress-track"><span style={{ width: `${project.progress}%` }} /></div><small>{project.progress}%</small></div></td><td><span className={`status-pill ${project.tone}`}>{project.status}</span></td><td className="due-date">{project.due}</td></tr>)}</tbody></table>{filteredProjects.length === 0 && <div className="empty-state">Nenhum projeto encontrado para “{query}”.</div>}</div></div><div className="panel agenda-panel"><div className="panel-heading"><div><h2>Agenda de campo</h2><p>Próximas atividades</p></div><button className="round-button" aria-label="Adicionar atividade"><Plus size={17} /></button></div><div className="agenda-date"><span>SET</span><strong>21</strong><small>SEG</small></div><div className="agenda-list"><div className="agenda-item"><span className="agenda-time">08:30</span><div><strong>Visita técnica</strong><small>Cooperativa Vale Grãos</small></div><span className="agenda-dot blue" /></div><div className="agenda-item"><span className="agenda-time">13:00</span><div><strong>Reunião de medição</strong><small>Fazenda Santa Helena</small></div><span className="agenda-dot orange" /></div><div className="agenda-item"><span className="agenda-time">16:30</span><div><strong>Inspeção de qualidade</strong><small>Agroindustrial Boa Safra</small></div><span className="agenda-dot green" /></div></div><button className="agenda-link">Abrir agenda completa <span>→</span></button></div></section>
          <section className="bottom-grid"><div className="panel activity-panel"><div className="panel-heading"><div><h2>Atividade recente</h2><p>Últimas atualizações da equipe</p></div><button className="text-button">Ver histórico <span>↗</span></button></div><div className="activity-list">{data.activities.map(({ title, description, time, icon: Icon, tone }) => <div className="activity-item" key={title}><div className={`activity-icon ${tone}`}><Icon size={16} /></div><div><strong>{title}</strong><small>{description}</small></div><time>{time}</time></div>)}</div></div><div className="weather-card"><div className="weather-top"><div><p>CONDIÇÕES EM CAMPO</p><h2>Rio Verde, GO</h2></div><CloudSun size={34} /></div><div className="temperature"><strong>28°</strong><span>Ensolarado<br /><small>Sensação de 30°</small></span></div><div className="weather-footer"><span>Vento 12 km/h</span><span>Umidade 48%</span><span>Visibilidade 10 km</span></div></div></section>
        </div>
      </main>
      {showModal && <div className="modal-backdrop" onClick={() => setShowModal(false)}><div className="modal" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setShowModal(false)} aria-label="Fechar"><X size={18} /></button><p className="eyebrow">NOVO REGISTRO</p><h2>Criar novo projeto</h2><p className="modal-copy">Cadastre a obra para iniciar o acompanhamento operacional.</p><label>Nome do cliente<input placeholder="Ex.: Fazenda Horizonte" /></label><label>Tipo de instalação<select defaultValue=""><option value="" disabled>Selecione uma opção</option><option>Silo + Secador</option><option>Bateria de silos</option><option>Secador contínuo</option></select></label><div className="modal-actions"><button className="secondary-button" onClick={() => setShowModal(false)}>Cancelar</button><button className="primary-button" onClick={() => setShowModal(false)}>Criar projeto</button></div></div></div>}
    </div>
  )
}

export default App
