import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, BriefcaseBusiness, CalendarDays, ChevronRight, Download, FileText, Folder, FolderPlus, Pencil, Plus, Search, ShieldCheck, Trash2, UserRound, UsersRound, X } from 'lucide-react'
import { API_URL } from './apiConfig'
import { AdmissionDocumentChoices } from './admissionDocuments.jsx'

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
  const [rehiring, setRehiring] = useState(null)
  const [admissionDocs, setAdmissionDocs] = useState([])
  const [admissionDocsLoading, setAdmissionDocsLoading] = useState(true)
  const [admissionDocsError, setAdmissionDocsError] = useState('')
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
  useEffect(() => { fetch(`${API_URL}/employees/admission-documents`, { headers }).then(async (response) => { const result = await response.json(); if (!response.ok) throw new Error(result.error); return result }).then(setAdmissionDocs).catch((problem) => { setAdmissionDocs([]); setAdmissionDocsError(problem.message || 'Não foi possível carregar os modelos de admissão.') }).finally(() => setAdmissionDocsLoading(false)) }, [session.token])

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
      const saved = await request(modal.id ? `/employees/${modal.id}` : '/employees', { method: modal.id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
      const generatedCount = saved.generated_documents?.length || 0
      notify(modal.id ? 'Cadastro atualizado.' : generatedCount ? `Funcionário admitido. ${generatedCount} documento(s) gerado(s) e anexado(s) ao cadastro.` : 'Funcionário admitido com sucesso.')
      setModal(null); await load()
      if (!modal.id && generatedCount && can('employees', 'view')) await openEmployee(saved)
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
  async function rehireEmployee(event) {
    event.preventDefault()
    const form = Object.fromEntries(new FormData(event.currentTarget))
    try {
      await request(`/employees/${rehiring.id}/rehire`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      notify('Funcionário readmitido. Os documentos e o histórico dos vínculos anteriores foram preservados.')
      setRehiring(null); await load()
    } catch (problem) { notify(problem.message || 'Não foi possível readmitir o funcionário.') }
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
      const downloadUrl = document.safety_certificate_id ? `/safety/certificates/${document.safety_certificate_id}/download` : `/employees/documents/${document.id}/download`; const response = await fetch(`${API_URL}${downloadUrl}`, { headers })
      if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.error || 'Não foi possível baixar o documento.') }
      const url = URL.createObjectURL(await response.blob()); const anchor = window.document.createElement('a'); anchor.href = url; anchor.download = document.name; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (problem) { notify(problem.message || 'Não foi possível baixar o documento.') }
  }
  const [folderPrompt, setFolderPrompt] = useState(null)
  const [confirmState, setConfirmState] = useState(null)
  async function deleteDocument(document) {
    setConfirmState({ message: `Excluir o documento “${document.name}”?`, action: async () => {
      try { await request(`/employees/documents/${document.id}`, { method: 'DELETE' }); notify('Documento excluído.'); await openEmployee(detail); await load() }
      catch (problem) { notify(problem.message || 'Não foi possível excluir o documento.') }
    } })
  }
  function createFolder(parentId) { setFolderPrompt({ parentId, folder: null }) }
  function renameFolder(folder) { setFolderPrompt({ parentId: folder.parent_id, folder }) }
  async function submitFolderName(name) {
    const trimmed = name.trim()
    if (!trimmed) return
    const { parentId, folder } = folderPrompt
    try {
      if (folder) {
        if (trimmed !== folder.name) { await request(`/employees/folders/${folder.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: trimmed }) }); notify('Pasta renomeada.') }
      } else {
        await request(`/employees/${detail.id}/folders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: trimmed, parent_id: parentId }) })
        notify('Pasta criada.')
      }
      setFolderPrompt(null); await openEmployee(detail)
    } catch (problem) { notify(problem.message || 'Não foi possível salvar a pasta.') }
  }
  function deleteFolder(folder) {
    setConfirmState({ message: `Excluir a pasta “${folder.name}”?`, action: async () => {
      try { await request(`/employees/folders/${folder.id}`, { method: 'DELETE' }); notify('Pasta excluída.'); await openEmployee(detail) }
      catch (problem) { notify(problem.message || 'Não foi possível excluir a pasta.') }
    } })
  }
  async function moveDocument(document, folderId) {
    try { await request(`/employees/documents/${document.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder_id: folderId }) }); notify('Documento movido.'); await openEmployee(detail) }
    catch (problem) { notify(problem.message || 'Não foi possível mover o documento.') }
  }

  if (!can('employees', 'view')) return <><header className="section-heading"><div><span className="section-kicker">EQUIPE</span><h1>Funcionários</h1><p>Seu perfil não tem permissão para consultar os cadastros da equipe.</p></div></header><div className="panel employee-empty">A solicitação de acesso deve ser feita ao administrador da empresa.</div></>
  return <>
    <header className="section-heading"><div><span className="section-kicker">GESTÃO DE PESSOAS</span><h1>Funcionários</h1><p>Admissões, documentos e histórico da equipe em um só lugar.</p></div>{can('employees', 'create') && <button className="blue-button" onClick={() => setModal({})}><Plus size={17} /> Admitir funcionário</button>}</header>
    <div className="employee-privacy-note"><ShieldCheck size={16} /><span>ASOs e documentos pessoais são exibidos somente para perfis autorizados pela administração.</span></div>
    <div className="employee-toolbar panel"><label className="search-box"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar nome, CPF, cargo ou matrícula" /></label><div className="employee-filter-tabs"><button className={status === 'ATIVO' ? 'active' : ''} onClick={() => setStatus('ATIVO')}>Ativos</button><button className={status === 'DEMITIDO' ? 'active' : ''} onClick={() => setStatus('DEMITIDO')}>Demitidos</button><button className={status === 'TODOS' ? 'active' : ''} onClick={() => setStatus('TODOS')}>Todos</button></div></div>
    <section className="page-panel panel employee-panel"><div className="panel-heading"><div><h2>{status === 'DEMITIDO' ? 'Funcionários demitidos' : status === 'ATIVO' ? 'Funcionários ativos' : 'Todos os funcionários'}</h2><p>{employees.length} cadastro(s) · registros mantidos após o desligamento</p></div><button className="quiet-button" onClick={load}>Atualizar</button></div>
      {loading ? <div className="employee-empty">Carregando funcionários…</div> : error ? <div className="employee-empty employee-error">{error}<button className="outline-button" onClick={load}>Tentar novamente</button></div> : !employees.length ? <div className="employee-empty">{status === 'DEMITIDO' ? 'Nenhum funcionário demitido encontrado.' : 'Nenhum funcionário encontrado.'}</div> : <div className="table-scroll"><table><thead><tr><th>FUNCIONÁRIO</th><th>CARGO / SETOR</th><th>ADMISSÃO</th><th>DOCUMENTOS</th><th>VALIDADE</th><th>STATUS</th><th /></tr></thead><tbody>{employees.map((person) => { const expiryTone = Number(person.expired_document_count) > 0 ? 'red' : Number(person.expiring_document_count) > 0 ? 'amber' : 'green'; const expiryLabel = expiryTone === 'red' ? `${person.expired_document_count} documento(s) vencido(s)` : expiryTone === 'amber' ? `${person.expiring_document_count} documento(s) vencendo em até 30 dias` : 'Documentos e certificados em dia'; return <tr key={person.id}><td><div className="project-name"><span className="project-icon blue"><UserRound size={15} /></span><span><b>{person.name}</b><small>Matrícula {person.registration_number || '—'} · {person.document ? `CPF ${person.document}` : person.email || 'CPF não informado'}</small></span></div></td><td><b>{person.job_title || 'Cargo não informado'}</b><small>{person.department || 'Sem setor'}</small></td><td>{dateText(person.admission_date)}</td><td><span className="employee-doc-count"><FileText size={14} /> {person.document_count || 0}</span></td><td><span className={`employee-expiry-dot ${expiryTone}`} role="img" aria-label={expiryLabel} title={expiryLabel} /></td><td><em className={`status ${person.status === 'DEMITIDO' ? 'red' : 'green'}`}>{person.status === 'DEMITIDO' ? 'Demitido' : 'Ativo'}</em></td><td><div className="row-actions"><button className="table-action" onClick={() => openEmployee(person)}>Ver cadastro</button>{can('employees', 'edit') && <button className="table-action" onClick={() => setModal(person)}><Pencil size={13} /> Editar</button>}{person.status === 'DEMITIDO' && can('employees', 'create') && <button className="table-action" onClick={() => setRehiring(person)}>Readmitir</button>}{person.status !== 'DEMITIDO' && can('employees', 'edit') && <button className="table-action danger" onClick={() => setTerminating(person)}>Desligar</button>}</div></td></tr>})}</tbody></table></div>}
    </section>
    {modal && <EmployeeForm employee={modal.id ? modal : null} can={can} admissionDocs={admissionDocs} admissionDocsLoading={admissionDocsLoading} admissionDocsError={admissionDocsError} onClose={() => setModal(null)} onSave={saveEmployee} />}
    {detail && <EmployeeDetail employee={detail} can={can} onClose={() => setDetail(null)} onEdit={() => { setModal(detail); setDetail(null) }} onUpload={uploadDocument} onDownload={downloadDocument} onDelete={deleteDocument} onTerminate={() => setTerminating(detail)} onRehire={() => { setRehiring(detail); setDetail(null) }} onCreateFolder={createFolder} onRenameFolder={renameFolder} onDeleteFolder={deleteFolder} onMoveDocument={moveDocument} />}
    {rehiring && <RehireForm employee={rehiring} onClose={() => setRehiring(null)} onSubmit={rehireEmployee} />}
    {terminating && <div className="modal-layer" onClick={() => setTerminating(null)}><form className="modal-card employee-terminate" onClick={(event) => event.stopPropagation()} onSubmit={terminateEmployee}><button type="button" className="modal-x" onClick={() => setTerminating(null)}><X size={18} /></button><span className="section-kicker">DESLIGAMENTO</span><h2>Registrar demissão</h2><p>O cadastro e os documentos serão preservados no filtro “Demitidos”.</p><label className="field"><span>Data do desligamento</span><input name="termination_date" type="date" defaultValue={today()} required /></label><div className="modal-actions"><button type="button" className="outline-button" onClick={() => setTerminating(null)}>Cancelar</button><button className="blue-button"><AlertTriangle size={15} /> Confirmar desligamento</button></div></form></div>}
    {folderPrompt && <FolderNameModal title={folderPrompt.folder ? 'Renomear pasta' : 'Nova pasta'} initial={folderPrompt.folder?.name || ''} onClose={() => setFolderPrompt(null)} onSubmit={submitFolderName} />}
    {confirmState && <ConfirmModal message={confirmState.message} onClose={() => setConfirmState(null)} onConfirm={() => { const { action } = confirmState; setConfirmState(null); action() }} />}
  </>
}

function EmployeeForm({ employee, admissionDocs, admissionDocsLoading, admissionDocsError, can, onClose, onSave }) {
  return <div className="modal-layer" onClick={onClose}><form className="modal-card employee-form" onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); onSave({ ...Object.fromEntries(form.entries()), generate_documents: form.getAll('generate_documents') }) }}><button type="button" className="modal-x" onClick={onClose}><X size={18} /></button><span className="section-kicker">{employee ? 'DADOS DO FUNCIONÁRIO' : 'ADMISSÃO'}</span><h2>{employee ? 'Editar cadastro' : 'Admitir funcionário'}</h2><div className="form-grid"><label className="field"><span>Nome completo</span><input name="name" defaultValue={employee?.name || ''} autoComplete="name" required /></label><label className="field"><span>CPF</span><input name="document" defaultValue={employee?.document || ''} maxLength={20} /></label><label className="field"><span>Matrícula do funcionário</span><input name="registration_number" defaultValue={employee?.registration_number || ''} required={!employee} /></label><label className="field"><span>Cargo / função</span><input name="job_title" defaultValue={employee?.job_title || ''} /></label><label className="field"><span>Setor</span><input name="department" defaultValue={employee?.department || ''} /></label><label className="field"><span>E-mail</span><input name="email" type="email" defaultValue={employee?.email || ''} /></label><label className="field"><span>Telefone</span><input name="phone" type="tel" defaultValue={employee?.phone || ''} /></label><label className="field"><span>Data de admissão</span><input name="admission_date" type="date" defaultValue={employee?.admission_date?.slice(0, 10) || today()} required /></label></div>{(!employee || can('employees', 'download')) && <><h3>Endereço residencial</h3><div className="form-grid"><label className="field"><span>Rua / avenida</span><input name="home_address" defaultValue={employee?.home_address || ''} /></label><label className="field"><span>Número</span><input name="home_address_number" defaultValue={employee?.home_address_number || ''} /></label><label className="field"><span>Complemento</span><input name="home_complement" defaultValue={employee?.home_complement || ''} /></label><label className="field"><span>Bairro</span><input name="home_district" defaultValue={employee?.home_district || ''} /></label><label className="field"><span>Município</span><input name="home_city" defaultValue={employee?.home_city || ''} /></label><label className="field"><span>UF</span><input name="home_state" maxLength={2} defaultValue={employee?.home_state || ''} /></label></div></>}{!employee && admissionDocsLoading && <p>Carregando modelos admissionais...</p>}{!employee && admissionDocsError && <p className="form-error" role="alert">{admissionDocsError}</p>}{!employee && !admissionDocsLoading && !admissionDocsError && admissionDocs.length > 0 && <><h3>Documentos para gerar nesta admissão</h3><p>Somente os modelos habilitados nas configurações da empresa estão disponíveis.</p><AdmissionDocumentChoices name="generate_documents" availableKeys={admissionDocs.map(({ key }) => key)} /></>}<label className="field"><span>Observações</span><textarea name="notes" rows="3" defaultValue={employee?.notes || ''} /></label><div className="modal-actions"><button type="button" className="outline-button" onClick={onClose}>Cancelar</button><button className="blue-button" disabled={!employee && (admissionDocsLoading || Boolean(admissionDocsError))}>{employee ? 'Salvar alterações' : 'Concluir admissão'}</button></div></form></div>
}
function EmployeeDetail({ employee, can, onClose, onEdit, onUpload, onDownload, onDelete, onTerminate, onRehire, onCreateFolder, onRenameFolder, onDeleteFolder, onMoveDocument }) {
  const [currentFolderId, setCurrentFolderId] = useState(null)
  const employmentHistory = employee.employment_history?.length ? employee.employment_history : employee.status === 'DEMITIDO' && employee.admission_date && employee.termination_date ? [{ id: 'previous-period', start_date: employee.admission_date, end_date: employee.termination_date, job_title: employee.job_title, department: employee.department }] : []
  const folders = employee.folders || []
  const foldersById = new Map(folders.map((entry) => [entry.id, entry]))
  const childrenByParent = new Map()
  for (const entry of folders) { const key = entry.parent_id || 'root'; if (!childrenByParent.has(key)) childrenByParent.set(key, []); childrenByParent.get(key).push(entry) }
  const documentsByFolder = new Map()
  for (const document of employee.documents || []) { const key = document.folder_id || 'root'; if (!documentsByFolder.has(key)) documentsByFolder.set(key, []); documentsByFolder.get(key).push(document) }
  const breadcrumb = []
  for (let cursor = currentFolderId; cursor;) { const entry = foldersById.get(cursor); if (!entry) break; breadcrumb.unshift(entry); cursor = entry.parent_id }
  const subfolders = childrenByParent.get(currentFolderId || 'root') || []
  const documents = documentsByFolder.get(currentFolderId || 'root') || []
  const flatFolders = []
  const flatten = (parentId, depth) => { for (const entry of childrenByParent.get(parentId || 'root') || []) { flatFolders.push({ ...entry, depth }); flatten(entry.id, depth + 1) } }
  flatten(null, 0)
  return <div className="modal-layer" onClick={onClose}><div className="modal-card employee-detail" onClick={(event) => event.stopPropagation()}><button className="modal-x" onClick={onClose}><X size={18} /></button><span className="section-kicker">CADASTRO FUNCIONAL</span><div className="employee-detail-title"><div><h2>{employee.name}</h2><p>{employee.job_title || 'Cargo não informado'}{employee.department ? ` · ${employee.department}` : ''}</p></div><em className={`status ${employee.status === 'DEMITIDO' ? 'red' : 'green'}`}>{employee.status === 'DEMITIDO' ? 'Demitido' : 'Ativo'}</em></div>
    <div className="employee-info-grid"><EmployeeInfo icon={UserRound} label="Matrícula" value={employee.registration_number} /><EmployeeInfo icon={UserRound} label="CPF" value={employee.document} /><EmployeeInfo icon={BriefcaseBusiness} label="E-mail / telefone" value={[employee.email, employee.phone].filter(Boolean).join(' · ')} /><EmployeeInfo icon={CalendarDays} label={employee.status === 'DEMITIDO' ? 'Última admissão' : 'Admissão atual'} value={dateText(employee.admission_date)} />{can('employees', 'download') && <EmployeeInfo icon={BriefcaseBusiness} label="Endereço residencial" value={[employee.home_address, employee.home_address_number, employee.home_complement, employee.home_district, employee.home_city, employee.home_state].filter(Boolean).join(', ')} />}{employee.status === 'DEMITIDO' && <EmployeeInfo icon={CalendarDays} label="Desligamento" value={dateText(employee.termination_date)} />}</div>{employee.notes && <p className="employee-notes">{employee.notes}</p>}
    {employmentHistory.length > 0 && <section className="employee-employment-history"><h3>Histórico de vínculos</h3>{employmentHistory.map((period) => <div key={period.id}><span><BriefcaseBusiness size={13} />{period.job_title || 'Cargo não informado'}{period.department ? ` · ${period.department}` : ''}</span><small>{dateText(period.start_date)} – {dateText(period.end_date)}</small></div>)}</section>}
    <div className="employee-doc-heading"><div><h3>Documentos do funcionário</h3><p>Arquivos protegidos, disponíveis para download.</p></div><span>{employee.documents?.length || 0}</span></div>
    <div className="employee-breadcrumb"><button type="button" onClick={() => setCurrentFolderId(null)} className={!currentFolderId ? 'active' : ''}>Raiz</button>{breadcrumb.map((entry) => <span key={entry.id}><ChevronRight size={12} /><button type="button" onClick={() => setCurrentFolderId(entry.id)} className={entry.id === currentFolderId ? 'active' : ''}>{entry.name}</button></span>)}{can('employees', 'upload') && <button type="button" className="quiet-button employee-new-folder" onClick={() => onCreateFolder(currentFolderId)}><FolderPlus size={14} /> Nova pasta</button>}</div>
    {subfolders.length > 0 && <div className="employee-folder-grid">{subfolders.map((entry) => <article className="employee-folder-card" key={entry.id}><button type="button" className="employee-folder-open" onClick={() => setCurrentFolderId(entry.id)}><Folder size={18} /><span>{entry.name}</span><small>{(documentsByFolder.get(entry.id)?.length || 0)} documento(s) · {(childrenByParent.get(entry.id)?.length || 0)} subpasta(s)</small></button>{can('employees', 'edit') && <button type="button" className="table-action" aria-label="Renomear pasta" onClick={() => onRenameFolder(entry)}><Pencil size={13} /></button>}{can('employees', 'delete') && <button type="button" className="table-action danger" aria-label="Excluir pasta" onClick={() => onDeleteFolder(entry)}><Trash2 size={13} /></button>}</article>)}</div>}
    {can('employees', 'upload') && <form className="employee-upload-form" onSubmit={onUpload}><div className="form-grid"><label className="field"><span>Tipo de documento</span><select name="category" required defaultValue=""><option value="" disabled>Selecione uma categoria</option>{categories.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label className="field"><span>Arquivo (PDF ou imagem, até 20 MB)</span><input name="file" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" required /></label><label className="field"><span>Data de emissão (opcional)</span><input name="issue_date" type="date" /></label><label className="field"><span>Validade (opcional)</span><input name="expires_at" type="date" /></label></div><input type="hidden" name="folder_id" value={currentFolderId || ''} readOnly /><div className="employee-upload-submit"><input name="notes" placeholder="Observação sobre o documento (opcional)" maxLength="1000" /><button className="blue-button"><Plus size={15} /> Anexar documento</button></div></form>}
    <div className="employee-document-list">{documents.map((document) => <article className="employee-document-row" key={document.id}><span className="employee-document-icon"><FileText size={17} /></span><div><b>{categories.find(([key]) => key === document.category)?.[1] || 'Documento'}</b><small>{document.safety_certificate_id ? `${document.name} · Emitido em ${dateText(document.issue_date)}` : `${document.name} · ${byteText(document.file_size)}`}{document.expires_at ? ` · Validade ${dateText(document.expires_at)}` : ''}</small></div>{!document.safety_certificate_id && can('employees', 'upload') && flatFolders.length > 0 && <select className="employee-move-select" value={document.folder_id || ''} onChange={(event) => onMoveDocument(document, event.target.value || null)} aria-label="Mover documento"><option value="">Sem pasta</option>{flatFolders.map((entry) => <option value={entry.id} key={entry.id}>{'—'.repeat(entry.depth)} {entry.name}</option>)}</select>}<button className="table-action" onClick={() => onDownload(document)}><Download size={14} /> Baixar</button>{!document.safety_certificate_id && can('employees', 'delete') && <button className="table-action danger" aria-label="Excluir documento" onClick={() => onDelete(document)}><Trash2 size={14} /></button>}</article>)}{!documents.length && <p className="employee-no-documents">{currentFolderId ? 'Nenhum documento nesta pasta.' : 'Nenhum documento anexado.'}</p>}</div>
    <div className="modal-actions"><span />{can('employees', 'edit') && <button className="outline-button" onClick={onEdit}><Pencil size={14} /> Editar cadastro</button>}{employee.status === 'DEMITIDO' && can('employees', 'create') && <button className="blue-button" onClick={onRehire}>Readmitir funcionário</button>}{employee.status !== 'DEMITIDO' && can('employees', 'edit') && <button className="table-action danger" onClick={onTerminate}>Registrar desligamento</button>}</div>
  </div></div>
}
function RehireForm({ employee, onClose, onSubmit }) { return <div className="modal-layer" onClick={onClose}><form className="modal-card employee-form" onClick={(event) => event.stopPropagation()} onSubmit={onSubmit}><button type="button" className="modal-x" onClick={onClose}><X size={18} /></button><span className="section-kicker">READMISSÃO</span><h2>Readmitir funcionário</h2><p>O cadastro e os documentos existentes serão mantidos. Um novo vínculo será iniciado.</p><label className="field"><span>Nova data de admissão</span><input name="admission_date" type="date" defaultValue={today()} required /></label><div className="form-grid"><label className="field"><span>Cargo / função</span><input name="job_title" defaultValue={employee.job_title || ''} /></label><label className="field"><span>Setor</span><input name="department" defaultValue={employee.department || ''} /></label></div><div className="modal-actions"><button type="button" className="outline-button" onClick={onClose}>Cancelar</button><button className="blue-button">Confirmar readmissão</button></div></form></div> }
function EmployeeInfo({ icon: Icon, label, value }) { return <div className="employee-info"><span><Icon size={14} /> {label}</span><b>{value || 'Não informado'}</b></div> }
function FolderNameModal({ title, initial, onClose, onSubmit }) {
  return <div className="modal-layer" onClick={onClose}><form className="modal-card employee-small-modal" onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); onSubmit(new FormData(event.currentTarget).get('name') || '') }}><button type="button" className="modal-x" onClick={onClose}><X size={18} /></button><span className="section-kicker">PASTA</span><h2>{title}</h2><label className="field"><span>Nome da pasta</span><input name="name" defaultValue={initial} maxLength={120} autoFocus required /></label><div className="modal-actions"><button type="button" className="outline-button" onClick={onClose}>Cancelar</button><button className="blue-button">Salvar</button></div></form></div>
}
function ConfirmModal({ message, onClose, onConfirm }) {
  return <div className="modal-layer" onClick={onClose}><div className="modal-card employee-small-modal" onClick={(event) => event.stopPropagation()}><button className="modal-x" onClick={onClose}><X size={18} /></button><span className="section-kicker">CONFIRMAÇÃO</span><p className="employee-confirm-text">{message}</p><div className="modal-actions"><button type="button" className="outline-button" onClick={onClose}>Cancelar</button><button className="table-action danger" onClick={onConfirm}><Trash2 size={14} /> Confirmar exclusão</button></div></div></div>
}
