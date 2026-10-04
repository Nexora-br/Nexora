import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { API_URL } from './apiConfig'

const nrOptions = [
  ['NR-01', 'Disposições Gerais e GRO'], ['NR-05', 'CIPA e prevenção ao assédio'], ['NR-06', 'Equipamentos de Proteção Individual'],
  ['NR-10', 'Instalações e serviços em eletricidade'], ['NR-11', 'Movimentação e armazenagem de materiais'], ['NR-12', 'Máquinas e equipamentos'],
  ['NR-18', 'Indústria da construção'], ['NR-20', 'Inflamáveis e combustíveis'], ['NR-33', 'Espaços confinados'], ['NR-35', 'Trabalho em altura'],
]
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10)

export function SafetyPage({ session, can, notify }) {
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedEmployee, setSelectedEmployee] = useState('')
  const [selectedNrs, setSelectedNrs] = useState([])
  const [hours, setHours] = useState({})
  const [issueDate, setIssueDate] = useState(today())
  const [expiresAt, setExpiresAt] = useState('')
  const [instructor, setInstructor] = useState(session.userName || '')
  const [registration, setRegistration] = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const headers = { Authorization: `Bearer ${session.token}` }

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const employeeResponse = await fetch(`${API_URL}/safety/employees`, { headers })
      const employeeRows = await employeeResponse.json()
      if (!employeeResponse.ok) throw new Error(employeeRows.error || 'Não foi possível carregar os funcionários.')
      setEmployees(employeeRows)
      setSelectedEmployee((current) => current && employeeRows.some((item) => item.id === current) ? current : employeeRows[0]?.id || '')
    } catch (loadError) { setError(loadError.message || 'Não foi possível carregar os dados.') }
    setLoading(false)
  }, [session.token])

  useEffect(() => { load() }, [load])

  async function issueCertificates(event) {
    event.preventDefault()
    if (!selectedNrs.length) return notify('Selecione pelo menos uma NR para emitir.')
    setSaving(true)
    try {
      const response = await fetch(`${API_URL}/safety/certificates`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: selectedEmployee, issue_date: issueDate, expires_at: expiresAt || null, instructor_name: instructor, instructor_registration: registration, certificates: selectedNrs.map((nr_code) => ({ nr_code, workload_hours: Number(hours[nr_code]), content })) }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Não foi possível emitir os certificados.')
      setSelectedNrs([]); setContent(''); await load(); notify(`${result.length} certificado(s) emitido(s).`)
    } catch (saveError) { notify(saveError.message || 'Não foi possível emitir os certificados.') }
    setSaving(false)
  }



  const employee = employees.find((item) => item.id === selectedEmployee)
  return <>
    <div className="section-heading"><div><span className="section-kicker">SAÚDE E SEGURANÇA DO TRABALHO</span><h1>Segurança do Trabalho</h1><p>Emita certificados de treinamento por NR para os funcionários cadastrados.</p></div><button className="outline-button" onClick={load}><RefreshCw size={15} /> Atualizar</button></div>
    {error && <div className="data-state" role="alert">{error}<button className="blue-button" onClick={load}>Tentar novamente</button></div>}
    {can('safety_certificates', 'create') && <form className="panel safety-form" onSubmit={issueCertificates}>
      <div className="safety-panel-heading"><div><h2>Emitir certificados</h2><p>As informações pessoais são carregadas diretamente do cadastro de funcionários.</p></div></div>
      <div className="safety-form-grid">
        <label className="field"><span>Funcionário</span><select value={selectedEmployee} onChange={(event) => setSelectedEmployee(event.target.value)} required><option value="">Selecione um funcionário</option>{employees.map((item) => <option key={item.id} value={item.id}>{item.name}{item.status !== 'ATIVO' ? ` · ${item.status}` : ''}</option>)}</select></label>
        <label className="field"><span>CPF</span><input value={employee?.document || 'Não informado no cadastro'} readOnly /></label>
        <label className="field"><span>Cargo</span><input value={employee?.job_title || 'Não informado no cadastro'} readOnly /></label>
        <label className="field"><span>Setor</span><input value={employee?.department || 'Não informado no cadastro'} readOnly /></label>
        <label className="field"><span>Data de emissão</span><input type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} required /></label>
        <label className="field"><span>Validade (opcional)</span><input type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label>
        <label className="field"><span>Responsável pelo treinamento</span><input value={instructor} onChange={(event) => setInstructor(event.target.value)} required /></label>
        <label className="field"><span>Registro profissional (opcional)</span><input value={registration} onChange={(event) => setRegistration(event.target.value)} placeholder="Ex.: registro profissional" /></label>
      </div>
      <div className="safety-nr-heading"><strong>Normas regulamentadoras</strong><span>Marque todas as NRs deste treinamento.</span></div>
      <div className="safety-nr-list">{nrOptions.map(([code, label]) => <label className={`safety-nr-option ${selectedNrs.includes(code) ? 'selected' : ''}`} key={code}><input type="checkbox" checked={selectedNrs.includes(code)} onChange={(event) => setSelectedNrs((current) => event.target.checked ? [...current, code] : current.filter((item) => item !== code))} /><span><b>{code}</b><small>{label}</small></span>{selectedNrs.includes(code) && <input aria-label={`Carga horária ${code}`} className="safety-hours" type="number" min="0.5" max="1000" step="0.5" required placeholder="Horas" value={hours[code] || ''} onChange={(event) => setHours((current) => ({ ...current, [code]: event.target.value }))} />}</label>)}</div>
      <label className="field safety-content"><span>Conteúdo programático</span><textarea value={content} onChange={(event) => setContent(event.target.value)} rows="3" placeholder="Assuntos abordados no treinamento" /></label>
      <div className="modal-actions"><span /> <button className="blue-button" disabled={saving || loading || !employees.length}>{saving ? 'Emitindo...' : `Emitir ${selectedNrs.length || ''} certificado(s)`}</button></div>
    </form>}
  </>
}
