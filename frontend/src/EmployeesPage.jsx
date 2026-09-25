import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, BriefcaseBusiness, CalendarDays, Download, FileText, Pencil, Plus, Search, ShieldCheck, Trash2, UserRound, UsersRound, X } from 'lucide-react'
import { API_URL } from './apiConfig'

const categories = [
  ['CERTIFICADO', 'Certificado'], ['ASO', 'ASO'], ['FICHA_ADMISSAO', 'Ficha de admissão'],
  ['CARTEIRA_TRABALHO', 'Carteira de trabalho'], ['TERMO_RESPONSABILIDADE', 'Termo de responsabilidade'],
  ['ADVERTENCIA', 'Advertência'], ['OUTRO', 'Outro documento'],
]
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
const dateText = (value) => value ? new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '—'
const byteText = (value) => value < 1024 * 1024 ? `${Math.ceil(value / 1024)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`

export function EmployeesPage({ session, can, notify }) {
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('ATIVO')
  const [modal, setModal] = useState(null)
  const [detail, setDetail] = useState(null)
  const [terminating, setTerminating] = useState(null)
  const headers = { Authorization: `Bearer ${session.token}` }

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const params = new URLSearchParams({ status, search })
      const response = await fetch(`${API_URL}/employees?${params}`, { headers })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Não foi possível carregar os funcionários.')
      setEmployees(payload)
    } catch (problem) { setError(problem instanceof TypeError ? 'Não foi possível conectar ao sistema.' : problem.message || 'Não foi possível carregar os funcionários.') }
    finally { setLoading(false) }
  }, [session.token, status, search])
  useEffect(() => { const timer = window.setTimeout(() => { void load() }, 220); return () => window.clearTimeout(timer) }, [load])

  async function request(url, options = {}) {
    const response = await fetch(`${API_URL}${url}`, { ...options, headers: { ...headers, ...(options.headers || {}) } })
    const payload = response.status === 204 ? null : await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload?.error || 'Não foi possível concluir a operação.')
    return payload
  }
  async function openEmployee(employee) {
    try { setDetail(await request(`/employees/${employee.id}`)) }
    catch (problem) { notify(problem.message || 'Não foi possível abrir o cadastro.') }
  }
  async function saveEmployee(data) {
    try {
      await request(modal.id ? `/employees/${modal.id}` : '/employees', { method: modal.id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
      notify(modal.id ? 'Cadastro atualizado.' : 'Funcionário admitido com sucesso.')
      setModal(null); await load()
    } catch (problem) { notify(problem.message || 'Não foi possível salvar o cadastro.') }
  }
  async function terminateEmployee(event) {
    event.preventDefault()
    const terminationDate = new FormData(event.currentTarget).get('termination_date')
    try {
      await request(`/employees/${terminating.id}/terminate`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ termination_date: terminationDate }) })
      notify('Desligamento registrado. O cadastro e os documentos foram mantidos no histórico.')
      setTerminating(null); setDetail(null); await load()
    } catch (problem) { notify(problem.message || 'Não foi possível registrar o desligamento.') }
  }
  async function uploadDocument(event) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const file = form.get('file')
    if (!file?.size) return notify('Selecione um arquivo para anexar.')
    if (file.size > 20 * 1024 * 1024) return notify('O arquivo deve ter até 20 MB.')
    if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return notify('Envie um PDF ou uma imagem JPG, PNG ou WebP.')
    try {
      await request(`/employees/${detail.id}/documents`, { method: 'POST', body: form })
      notify('Documento anexado ao cadastro do funcionário.')
      formElement.reset(); await openEmployee(detail)
      await load()
    } catch (problem) { notify(problem.message || 'Não foi possível anexar o documento.') }
  }
  async function downloadDocument(document) {
    try {
      const response = await fetch(`${API_URL}/employees/documents/${document.id}/download`, { headers })
      if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.error || 'Não foi possível baixar o documento.') }
      const url = URL.createObjectURL(await response.blob()); const anchor = window.document.createElement('a'); anchor.href = url; anchor.download = document.name; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (problem) { notify(problem.message || 'Não foi possível baixar o documento.') }
  }
  async function deleteDocument(document) {
    if (!window.confirm(`Excluir o documento “${document.name}”?`)) return
    try { await request(`/employees/documents/${document.id}`, { method: 'DELETE' }); notify('Documento excluído.'); await openEmployee(detail); await load() }
    catch (problem) { notify(problem.message || 'Não foi possível excluir o documento.') }
  }

  if (!can('employees', 'view')) return <><header className="section-heading"><div><span className="section-kicker">EQUIPE</span><h1>Funcionários</h1><p>Seu perfil não tem permissão para consultar os cadastros da equipe.</p></div></header><div className="panel employee-empty">A solicitação de acesso deve ser feita ao administrador da empresa.</div></>
  return <>
    <header className="section-heading"><div><span className="section-kicker">GESTÃO DE PESSOAS</span><h1>Funcionários</h1><p>Admissões, documentos e histórico da equipe em um só lugar.</p></div>{can('employees', 'create') && <button className="blue-button" onClick={() => setModal({})}><Plus size={17} /> Admitir funcionário</button>}</header>
    <div className="employee-privacy-note"><ShieldCheck size={16} /><span>ASOs e documentos pessoais são exibidos somente para perfis autorizados pela administração.</span></div>
    <div className="employee-toolbar panel"><label className="search-box"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar nome, CPF ou cargo" /></label><div className="employee-filter-tabs"><button className={status === 'ATIVO' ? 'active' : ''} onClick={() => setStatus('ATIVO')}>Ativos</button><button className={status === 'DEMITIDO' ? 'active' : ''} onClick={() => setStatus('DEMITIDO')}>Demitidos</button><button className={status === 'TODOS' ? 'active' : ''} onClick={() => setStatus('TODOS')}>Todos</button></div></div>
    <section className="page-panel panel employee-panel"><div className="panel-heading"><div><h2>{status === 'DEMITIDO' ? 'Funcionários demitidos' : status === 'ATIVO' ? 'Funcionários ativos' : 'Todos os funcionários'}</h2><p>{employees.length} cadastro(s) · registros mantidos após o desligamento</p></div><button className="quiet-button" onClick={load}>Atualizar</button></div>
      {loading ? <div className="employee-empty">Carregando funcionários…</div> : error ? <div className="employee-empty employee-error">{error}<button className="outline-button" onClick={load}>Tentar novamente</button></div> : !employees.length ? <div className="employee-empty">{status === 'DEMITIDO' ? 'Nenhum funcionário demitido encontrado.' : 'Nenhum funcionário encontrado.'}</div> : <div className="table-scroll"><table><thead><tr><th>FUNCIONÁRIO</th><th>CARGO / SETOR</th><th>ADMISSÃO</th><th>DOCUMENTOS</th><th>STATUS</th><th /></tr></thead><tbody>{employees.map((person) => <tr key={person.id}><td><div className="project-name"><span className="project-icon blue"><UserRound size={15} /></span><span><b>{person.name}</b><small>{person.document ? `CPF ${person.document}` : person.email || 'CPF não informado'}</small></span></div></td><td><b>{person.job_title || 'Cargo não informado'}</b><small>{person.department || 'Sem setor'}</small></td><td>{dateText(person.admission_date)}</td><td><span className="employee-doc-count"><FileText size={14} /> {person.document_count || 0}</span></td><td><em className={`status ${person.status === 'DEMITIDO' ? 'red' : 'green'}`}>{person.status === 'DEMITIDO' ? 'Demitido' : 'Ativo'}</em></td><td><div className="row-actions"><button className="table-action" onClick={() => openEmployee(person)}>Ver cadastro</button>{can('employees', 'edit') && <button className="table-action" onClick={() => setModal(person)}><Pencil size={13} /> Editar</button>}{person.status !== 'DEMITIDO' && can('employees', 'edit') && <button className="table-action danger" onClick={() => setTerminating(person)}>Desligar</button>}</div></td></tr>)}</tbody></table></div>}
    </section>
    {modal && <EmployeeForm employee={modal.id ? modal : null} onClose={() => setModal(null)} onSave={saveEmployee} />}
    {detail && <EmployeeDetail employee={detail} can={can} onClose={() => setDetail(null)} onEdit={() => { setModal(detail); setDetail(null) }} onUpload={uploadDocument} onDownload={downloadDocument} onDelete={deleteDocument} onTerminate={() => setTerminating(detail)} />}
    {terminating && <div className="modal-layer" onClick={() => setTerminating(null)}><form className="modal-card employee-terminate" onClick={(event) => event.stopPropagation()} onSubmit={terminateEmployee}><button type="button" className="modal-x" onClick={() => setTerminating(null)}><X size={18} /></button><span className="section-kicker">DESLIGAMENTO</span><h2>Registrar demissão</h2><p>O cadastro e os documentos serão preservados no filtro “Demitidos”.</p><label className="field"><span>Data do desligamento</span><input name="termination_date" type="date" defaultValue={today()} required /></label><div className="modal-actions"><button type="button" className="outline-button" onClick={() => setTerminating(null)}>Cancelar</button><button className="blue-button"><AlertTriangle size={15} /> Confirmar desligamento</button></div></form></div>}
  </>
}

function EmployeeForm({ employee, onClose, onSave }) {
  return <div className="modal-layer" onClick={onClose}><form className="modal-card employee-form" onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); onSave(Object.fromEntries(new FormData(event.currentTarget))) }}><button type="button" className="modal-x" onClick={onClose}><X size={18} /></button><span className="section-kicker">{employee ? 'DADOS DO FUNCIONÁRIO' : 'ADMISSÃO'}</span><h2>{employee ? 'Editar cadastro' : 'Admitir funcionário'}</h2><div className="form-grid"><label className="field"><span>Nome completo</span><input name="name" defaultValue={employee?.name || ''} autoComplete="name" required /></label><label className="field"><span>CPF</span><input name="document" defaultValue={employee?.document || ''} maxLength={20} /></label><label className="field"><span>Cargo / função</span><input name="job_title" defaultValue={employee?.job_title || ''} /></label><label className="field"><span>Setor</span><input name="department" defaultValue={employee?.department || ''} /></label><label className="field"><span>E-mail</span><input name="email" type="email" defaultValue={employee?.email || ''} /></label><label className="field"><span>Telefone</span><input name="phone" type="tel" defaultValue={employee?.phone || ''} /></label><label className="field"><span>Data de admissão</span><input name="admission_date" type="date" defaultValue={employee?.admission_date?.slice(0, 10) || today()} /></label></div><label className="field"><span>Observações</span><textarea name="notes" rows="3" defaultValue={employee?.notes || ''} /></label><div className="modal-actions"><button type="button" className="outline-button" onClick={onClose}>Cancelar</button><button className="blue-button">{employee ? 'Salvar alterações' : 'Concluir admissão'}</button></div></form></div>
}

function EmployeeDetail({ employee, can, onClose, onEdit, onUpload, onDownload, onDelete, onTerminate }) {
  return <div className="modal-layer" onClick={onClose}><div className="modal-card employee-detail" onClick={(event) => event.stopPropagation()}><button className="modal-x" onClick={onClose}><X size={18} /></button><span className="section-kicker">CADASTRO FUNCIONAL</span><div className="employee-detail-title"><div><h2>{employee.name}</h2><p>{employee.job_title || 'Cargo não informado'}{employee.department ? ` · ${employee.department}` : ''}</p></div><em className={`status ${employee.status === 'DEMITIDO' ? 'red' : 'green'}`}>{employee.status === 'DEMITIDO' ? 'Demitido' : 'Ativo'}</em></div>
    <div className="employee-info-grid"><EmployeeInfo icon={UserRound} label="CPF" value={employee.document} /><EmployeeInfo icon={BriefcaseBusiness} label="E-mail / telefone" value={[employee.email, employee.phone].filter(Boolean).join(' · ')} /><EmployeeInfo icon={CalendarDays} label="Admissão" value={dateText(employee.admission_date)} />{employee.status === 'DEMITIDO' && <EmployeeInfo icon={CalendarDays} label="Desligamento" value={dateText(employee.termination_date)} />}</div>{employee.notes && <p className="employee-notes">{employee.notes}</p>}
    <div className="employee-doc-heading"><div><h3>Documentos do funcionário</h3><p>Arquivos protegidos, disponíveis para download.</p></div><span>{employee.documents?.length || 0}</span></div>
    {can('employees', 'upload') && <form className="employee-upload-form" onSubmit={onUpload}><div className="form-grid"><label className="field"><span>Tipo de documento</span><select name="category" required defaultValue=""><option value="" disabled>Selecione uma categoria</option>{categories.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label className="field"><span>Arquivo (PDF ou imagem, até 20 MB)</span><input name="file" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" required /></label><label className="field"><span>Data de emissão (opcional)</span><input name="issue_date" type="date" /></label><label className="field"><span>Validade (opcional)</span><input name="expires_at" type="date" /></label></div><div className="employee-upload-submit"><input name="notes" placeholder="Observação sobre o documento (opcional)" maxLength="1000" /><button className="blue-button"><Plus size={15} /> Anexar documento</button></div></form>}
    <div className="employee-document-list">{employee.documents?.map((document) => <article className="employee-document-row" key={document.id}><span className="employee-document-icon"><FileText size={17} /></span><div><b>{categories.find(([key]) => key === document.category)?.[1] || 'Documento'}</b><small>{document.name} · {byteText(document.file_size)}{document.expires_at ? ` · Validade ${dateText(document.expires_at)}` : ''}</small></div><button className="table-action" onClick={() => onDownload(document)}><Download size={14} /> Baixar</button>{can('employees', 'delete') && <button className="table-action danger" aria-label="Excluir documento" onClick={() => onDelete(document)}><Trash2 size={14} /></button>}</article>)}{!employee.documents?.length && <p className="employee-no-documents">Nenhum documento anexado.</p>}</div>
    <div className="modal-actions"><span />{can('employees', 'edit') && <button className="outline-button" onClick={onEdit}><Pencil size={14} /> Editar cadastro</button>}{employee.status !== 'DEMITIDO' && can('employees', 'edit') && <button className="table-action danger" onClick={onTerminate}>Registrar desligamento</button>}</div>
  </div></div>
}
function EmployeeInfo({ icon: Icon, label, value }) { return <div className="employee-info"><span><Icon size={14} /> {label}</span><b>{value || 'Não informado'}</b></div> }
