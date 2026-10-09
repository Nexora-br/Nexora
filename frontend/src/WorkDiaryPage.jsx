import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookOpen, Download, Eye, FileCheck2, FileUp, ImagePlus, Pencil, Plus, RefreshCw, Trash2, Upload, X } from 'lucide-react'
import { API_URL } from './apiConfig'
import './AppNew.css'

const today = () => { const date = new Date(); return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10) }
const dateLabel = (value) => value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '—'
const rowsFrom = (payload) => Array.isArray(payload) ? payload : payload?.data || []
const messageOf = (error, fallback) => error instanceof TypeError ? fallback : error?.message || fallback

function WorkDiaryPage({ session, can, canEquipment, notify }) {
  const [projects, setProjects] = useState([])
  const [equipments, setEquipments] = useState([])
  const [projectId, setProjectId] = useState('')
  const [entries, setEntries] = useState([])
  const [state, setState] = useState({ loading: true, error: '' })
  const [modal, setModal] = useState(null)
  const [detail, setDetail] = useState(null)
  const headers = useMemo(() => ({ Authorization: `Bearer ${session.token}` }), [session.token])

  const loadProjects = useCallback(async () => {
    const response = await fetch(`${API_URL}/work-diaries/projects`, { headers })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.error || 'Não foi possível carregar as obras.')
    const items = rowsFrom(payload)
    setProjects(items)
    if (canEquipment) fetch(API_URL + '/equipment?page=1&pageSize=100', { headers }).then((result) => result.json()).then((result) => setEquipments(rowsFrom(result))).catch(() => setEquipments([]))
    setProjectId((current) => current || items[0]?.id || '')
  }, [canEquipment, headers])

  const loadEntries = useCallback(async () => {
    if (!projectId) { setEntries([]); setState({ loading: false, error: '' }); return }
    setState({ loading: true, error: '' })
    try {
      const response = await fetch(`${API_URL}/work-diaries?project_id=${encodeURIComponent(projectId)}`, { headers })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Não foi possível carregar os diários desta obra.')
      setEntries(rowsFrom(payload))
      setState({ loading: false, error: '' })
    } catch (error) { setState({ loading: false, error: error.message || 'Não foi possível carregar os diários desta obra.' }) }
  }, [headers, projectId])

  useEffect(() => { loadProjects().catch((error) => setState({ loading: false, error: error.message })) }, [loadProjects])
  useEffect(() => { loadEntries() }, [loadEntries])

  async function saveDiary(formData) {
    const isEditing = Boolean(modal?.entry?.id)
    const url = isEditing ? `${API_URL}/work-diaries/${modal.entry.id}` : `${API_URL}/work-diaries/${projectId}`
    try {
      const response = await fetch(url, { method: isEditing ? 'PUT' : 'POST', headers, body: formData })
      const payload = response.status === 204 ? {} : await response.json()
      if (!response.ok) throw new Error(payload.error || 'Não foi possível salvar o registro.')
      notify(isEditing ? 'Registro atualizado.' : 'Diário de obra salvo com sucesso.')
      setModal(null)
      await loadEntries()
    } catch (error) { notify(error.message || 'Não foi possível salvar o registro.') }
  }

  async function openDetail(entry) {
    setDetail({ loading: true, error: '', entry: null })
    try {
      const response = await fetch(`${API_URL}/work-diaries/${entry.id}`, { headers })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Não foi possível abrir o registro.')
      setDetail({ loading: false, error: '', entry: payload })
    } catch (error) { setDetail({ loading: false, error: error.message, entry: null }) }
  }

  async function removeEntry(entry) {
    if (!window.confirm(`Excluir o diário de ${dateLabel(entry.entry_date)}? Os arquivos anexados também serão removidos.`)) return
    try {
      const response = await fetch(`${API_URL}/work-diaries/${entry.id}`, { method: 'DELETE', headers })
      if (!response.ok) { const payload = await response.json(); throw new Error(payload.error || 'Não foi possível excluir o registro.') }
      notify('Registro excluído.')
      setDetail(null)
      await loadEntries()
    } catch (error) { notify(error.message || 'Não foi possível excluir o registro.') }
  }

  async function togglePortalVisibility(entry) {
    const visible = !entry.portal_visible
    try {
      const response = await fetch(`${API_URL}/work-diaries/${entry.id}/portal-visibility`, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ visible }) })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Não foi possível alterar a liberação.')
      notify(visible ? 'Diário liberado no portal do cliente.' : 'Diário removido do portal.')
      await loadEntries()
    } catch (error) { notify(error.message || 'Não foi possível alterar a liberação.') }
  }

  async function openFile(entry, kind, photoId) {
    try {
      const query = new URLSearchParams({ kind, inline: '0' })
      if (photoId) query.set('photo_id', photoId)
      const response = await fetch(`${API_URL}/work-diaries/${entry.id}/file?${query}`, { headers })
      if (!response.ok) { const payload = await response.json(); throw new Error(payload.error || 'Não foi possível abrir o arquivo.') }
      const url = URL.createObjectURL(await response.blob())
      const link = window.document.createElement('a'); link.href = url; link.download = kind === 'photo' ? 'foto-diario' : entry.pdf_name || 'diario-de-obra.pdf'; link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (error) { notify(error.message || 'Não foi possível abrir o arquivo.') }
  }

  if (!can('work_diary', 'view')) return <><SectionHeading title="Diário de Obra" description="Acompanhe os registros diários das obras." /><EmptyState>Seu perfil não tem permissão para consultar os diários desta obra.</EmptyState></>

  return <>
    <SectionHeading title="Diário de Obra" description="Registre o avanço diário e mantenha o histórico de cada obra." action={can('work_diary', 'create') && <button className="blue-button" disabled={!projectId} onClick={() => setModal({})}><Plus size={17} /> Novo registro</button>} />
    <div className="work-diary-toolbar panel">
      <div className="work-diary-project-icon"><BookOpen size={18} /></div>
      <label className="work-diary-project-select"><span>OBRA VINCULADA</span><select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">Selecione uma obra</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name} · {project.code}</option>)}</select></label>
      <span className="work-diary-count">{entries.length} {entries.length === 1 ? 'registro' : 'registros'}</span>
      <button className="outline-button" aria-label="Atualizar diários" onClick={loadEntries}><RefreshCw size={14} /> Atualizar</button>
    </div>
    <div className="page-panel panel work-diary-panel">
      <PanelHeading title="Registros da obra" subtitle="Ordenados da data mais recente para a mais antiga." />
      {state.loading ? <DataState message="CARREGANDO DIÁRIO DE OBRA..." /> : state.error ? <DataState message={state.error} action={<button className="blue-button" onClick={() => projects.length ? loadEntries() : loadProjects().catch((error) => setState({ loading: false, error: error.message }))}><RefreshCw size={15} /> Tentar novamente</button>} /> : !projectId || !projects.length ? <EmptyState>Nenhuma obra disponível para registrar o diário.</EmptyState> : !entries.length ? <EmptyState>Nenhum registro de diário encontrado.</EmptyState> : <div className="work-diary-list">{entries.map((entry) => <article className="work-diary-row" key={entry.id}>
        <span className={`work-diary-type-icon ${entry.entry_type === 'PDF' ? 'pdf' : 'structured'}`}>{entry.entry_type === 'PDF' ? <FileCheck2 size={18} /> : <BookOpen size={18} />}</span>
        <div className="work-diary-row-main"><div className="work-diary-row-title"><strong>{dateLabel(entry.entry_date)}</strong><span className={`work-diary-badge ${entry.entry_type === 'PDF' ? 'pdf' : 'structured'}`}>{entry.entry_type === 'PDF' ? 'PDF anexado' : 'Criado no sistema'}</span></div><p>{entry.entry_type === 'PDF' ? entry.pdf_name || entry.observations || 'Diário em PDF anexado.' : shortText(entry.activities) || 'Diário criado no sistema.'}</p><small>{entry.author_name || 'Usuário'}{entry.weather ? ` · ${weatherLabel(entry.weather)}` : ''}</small></div>
        <div className="work-diary-row-actions">{['ADMINISTRADOR', 'DIRETOR', 'GERENTE', 'GESTOR', 'SUPERVISOR'].includes(session.role) && <button className="table-action" onClick={() => togglePortalVisibility(entry)}>{entry.portal_visible ? 'Remover do portal' : 'Liberar no portal'}</button>}{entry.portal_visible ? <span className="work-diary-badge structured">Visível ao cliente</span> : null}<button className="table-action" onClick={() => openDetail(entry)}><Eye size={14} /> Visualizar</button>{can('work_diary', 'edit') && <button className="table-action" onClick={() => setModal({ entry })}><Pencil size={14} /> Editar</button>}{can('work_diary', 'delete') && <button className="table-action danger" onClick={() => removeEntry(entry)}><Trash2 size={14} /> Excluir</button>}</div>
      </article>)}</div>}
    </div>
    {modal && <DiaryModal key={modal.entry?.id || 'new'} entry={modal.entry} project={projects.find((item) => item.id === projectId)} equipments={equipments} headers={headers} onClose={() => setModal(null)} onSave={saveDiary} notify={notify} />}
    {detail && <DiaryDetail detail={detail} can={can} onClose={() => setDetail(null)} onEdit={(entry) => { setDetail(null); setModal({ entry }) }} onDelete={removeEntry} onFile={openFile} />}
  </>
}

function shortText(text) { const value = String(text || '').trim().replace(/\s+/g, ' '); return value.length > 105 ? `${value.slice(0, 102)}…` : value }
function weatherLabel(value) { return ({ BOM: 'Bom tempo', CHUVA: 'Chuva', IMPRATICAVEL: 'Impraticável' })[value] || value }
function SectionHeading({ title, description, action }) { return <section className="section-heading"><div><span className="section-kicker">ACOMPANHAMENTO DE OBRA</span><h1>{title}</h1><p>{description}</p></div>{action}</section> }
function PanelHeading({ title, subtitle }) { return <div className="panel-heading"><div><h2>{title}</h2><p>{subtitle}</p></div></div> }
function EmptyState({ children }) { return <div className="empty work-diary-empty">{children}</div> }
function DataState({ message, action }) { return <div className="data-state"><p>{message}</p>{action}</div> }

function DiaryModal({ entry, project, equipments, headers, onClose, onSave, notify }) {
  const [type, setType] = useState(entry?.entry_type || '')
  const [saving, setSaving] = useState(false)
  const equipmentOptions = [...equipments]
  for (const item of entry?.equipment_used || []) if (!equipmentOptions.some((equipment) => equipment.id === item.id)) equipmentOptions.push({ id: item.id, code: '', name: item.name })
  function submit(event) {
    event.preventDefault()
    const form = event.currentTarget
    const source = new FormData(form)
    const photos = source.getAll('photos').filter((file) => file instanceof File && file.size > 0)
    const pdf = source.get('pdf')
    if (type === 'PDF' && !entry?.has_pdf && (!(pdf instanceof File) || !pdf.size)) return notify('Selecione o arquivo PDF do diário.')
    if (type === 'PDF' && pdf instanceof File && pdf.size > 20 * 1024 * 1024) return notify('O PDF deve ter no máximo 20 MB.')
    if (photos.length > 8 || photos.some((file) => file.size > 5 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) return notify('Anexe até 8 imagens JPG, PNG ou WebP, com no máximo 5 MB cada.')
    const data = { entry_type: type, entry_date: source.get('entry_date'), weather: source.get('weather') || '', worker_count: source.get('worker_count') || 0, worker_details: source.get('worker_details') || '', equipment_used: equipments.length ? source.getAll('equipment_used') : entry?.equipment_used?.map((item) => item.id) || [], equipment_notes: source.get('equipment_notes') || '', activities: source.get('activities') || '', occurrences: source.get('occurrences') || '', materials_received: source.get('materials_received') || '', observations: source.get('observations') || '' }
    const body = new FormData()
    body.append('data', JSON.stringify(data))
    if (type === 'PDF' && pdf instanceof File && pdf.size) body.append('pdf', pdf)
    if (type === 'ESTRUTURADO') photos.forEach((photo) => body.append('photos', photo))
    setSaving(true)
    Promise.resolve(onSave(body)).finally(() => setSaving(false))
  }
  return <div className="modal-layer" onClick={onClose}><div className="modal-card work-diary-modal" onClick={(event) => event.stopPropagation()}>
    <button className="modal-x" type="button" onClick={onClose} aria-label="Fechar"><X size={18} /></button><span className="section-kicker">DIÁRIO DE OBRA</span><h2>{entry ? 'Editar registro' : 'Novo registro'}</h2><p>{project?.name || 'Selecione como deseja registrar o andamento da obra.'}</p>
    {!type ? <div className="work-diary-choice"><button type="button" className="work-diary-choice-card" onClick={() => setType('ESTRUTURADO')}><span className="work-diary-choice-icon"><BookOpen size={22} /></span><strong>Criar diário no sistema</strong><small>Preencha as atividades, equipe, condições e ocorrências do dia.</small><span>Preencher diário <span aria-hidden="true">→</span></span></button><button type="button" className="work-diary-choice-card" onClick={() => setType('PDF')}><span className="work-diary-choice-icon pdf"><FileUp size={22} /></span><strong>Anexar diário em PDF</strong><small>Envie um relatório que já foi preparado em PDF.</small><span>Enviar arquivo <span aria-hidden="true">→</span></span></button></div> : <form onSubmit={submit}>
      {entry && <div className="work-diary-edit-type">{type === 'PDF' ? <FileCheck2 size={16} /> : <BookOpen size={16} />}{type === 'PDF' ? 'Registro com PDF' : 'Diário criado no sistema'}</div>}
      <label className="field"><span>Data do registro *</span><input type="date" name="entry_date" defaultValue={entry?.entry_date?.slice(0, 10) || today()} required /></label>
      {type === 'PDF' ? <><label className="work-diary-upload-zone"><Upload size={22} /><strong>{entry?.pdf_name ? `PDF atual: ${entry.pdf_name}` : 'Selecione o diário em PDF'}</strong><span>{entry?.pdf_name ? 'Você pode manter o arquivo atual ou substituí-lo.' : 'Apenas PDF · até 20 MB'}</span><input type="file" name="pdf" accept="application/pdf,.pdf" onChange={(event) => { const file = event.target.files?.[0]; if (file && (file.type !== 'application/pdf' || file.size > 20 * 1024 * 1024)) { notify('Selecione um PDF válido de até 20 MB.'); event.target.value = '' } }} /></label>{entry?.has_pdf && <p className="work-diary-help">O PDF atual será mantido se nenhum novo arquivo for escolhido.</p>}<label className="field"><span>Observação ou legenda</span><textarea name="observations" defaultValue={entry?.observations || ''} maxLength="500" placeholder="Uma breve descrição do documento" /></label></> : <>
        <div className="form-grid"><label className="field"><span>Condições climáticas</span><select name="weather" defaultValue={entry?.weather || ''}><option value="">Não informado</option><option value="BOM">Bom</option><option value="CHUVA">Chuva</option><option value="IMPRATICAVEL">Impraticável</option></select></label><label className="field"><span>Trabalhadores presentes</span><input name="worker_count" type="number" min="0" max="10000" defaultValue={entry?.worker_count || 0} /></label></div>
        <label className="field"><span>Nomes e funções da equipe <small>(opcional)</small></span><textarea name="worker_details" defaultValue={entry?.worker_details || ''} placeholder="Ex.: João Silva — montador; Ana Souza — eletricista" /></label>
        {equipmentOptions.length > 0 && <label className="field"><span>Equipamentos em uso</span><select name="equipment_used" multiple size="4" defaultValue={entry?.equipment_used?.map((item) => item.id) || []}>{equipmentOptions.map((equipment) => <option key={equipment.id} value={equipment.id}>{equipment.code ? `${equipment.code} · ` : ''}{equipment.name}</option>)}</select><small className="work-diary-help">Use Ctrl (ou Command no Mac) para selecionar mais de um.</small></label>}
        <label className="field"><span>Equipamentos usados</span><input name="equipment_notes" defaultValue={entry?.equipment_notes || ''} placeholder="Ex.: guindaste, soldadora, plataforma elevatória" /></label>
        <label className="field"><span>Atividades realizadas *</span><textarea name="activities" defaultValue={entry?.activities || ''} placeholder="Descreva os serviços executados nesta jornada" /></label>
        <label className="field"><span>Ocorrências e intercorrências <small>(opcional)</small></span><textarea name="occurrences" defaultValue={entry?.occurrences || ''} placeholder="Atrasos, acidentes ou problemas técnicos" /></label>
        <label className="field"><span>Materiais recebidos <small>(opcional)</small></span><textarea name="materials_received" defaultValue={entry?.materials_received || ''} placeholder="Materiais entregues na obra" /></label>
        <label className="field"><span>Observações gerais <small>(opcional)</small></span><textarea name="observations" defaultValue={entry?.observations || ''} /></label>
        {entry?.photos?.length > 0 && <p className="work-diary-help">Este registro já tem {entry.photos.length} {entry.photos.length === 1 ? 'foto. Ela será mantida' : 'fotos. Elas serão mantidas'} ao salvar as alterações.</p>}
        <label className="work-diary-upload-zone compact"><ImagePlus size={20} /><strong>Adicionar fotos do dia</strong><span>JPG, PNG ou WebP · até 8 fotos · 5 MB cada</span><input type="file" name="photos" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" multiple onChange={(event) => { const files = [...(event.target.files || [])]; if (files.length > 8 || files.some((file) => file.size > 5 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) { notify('Anexe até 8 imagens válidas, com no máximo 5 MB cada.'); event.target.value = '' } }} /></label>
      </>}
      <div className="modal-actions"><button className="outline-button" type="button" onClick={onClose}>Cancelar</button><button className="blue-button" disabled={saving}>{saving ? 'Salvando…' : entry ? 'Salvar alterações' : type === 'PDF' ? 'Salvar anexo' : 'Salvar registro'}</button></div>
    </form>}
  </div></div>
}

function DiaryDetail({ detail, can, onClose, onEdit, onDelete, onFile }) {
  if (detail.loading || detail.error) return <div className="modal-layer" onClick={onClose}><div className="modal-card" onClick={(event) => event.stopPropagation()}><button className="modal-x" onClick={onClose}><X size={18} /></button><p>{detail.loading ? 'Carregando registro…' : detail.error}</p></div></div>
  const entry = detail.entry
  return <div className="modal-layer" onClick={onClose}><article className="modal-card work-diary-detail" onClick={(event) => event.stopPropagation()}><button className="modal-x" onClick={onClose} aria-label="Fechar"><X size={18} /></button><span className="section-kicker">{entry.entry_type === 'PDF' ? 'DIÁRIO ANEXADO' : 'DIÁRIO REGISTRADO NO SISTEMA'}</span><h2>{dateLabel(entry.entry_date)}</h2><p className="work-diary-detail-byline">{entry.project_name || 'Obra'} · Registrado por {entry.author_name || 'Usuário'}</p>
    {entry.entry_type === 'PDF' ? <><DetailField label="Observação" value={entry.observations} /><button className="blue-button" onClick={() => onFile(entry, 'pdf')}><Download size={16} /> Abrir ou baixar PDF · {entry.pdf_name}</button></> : <>
      <div className="work-diary-detail-grid"><DetailField label="Data" value={dateLabel(entry.entry_date)} /><DetailField label="Condições climáticas" value={weatherLabel(entry.weather)} /><DetailField label="Trabalhadores presentes" value={entry.worker_count ?? 0} /><DetailField label="Equipe" value={entry.worker_details} /><DetailField label="Equipamentos" value={[...(entry.equipment_used || []).map((item) => item.name), entry.equipment_notes].filter(Boolean).join(', ')} /></div>
      <DetailField label="Atividades realizadas" value={entry.activities} /><DetailField label="Ocorrências e intercorrências" value={entry.occurrences} /><DetailField label="Materiais recebidos" value={entry.materials_received} /><DetailField label="Observações gerais" value={entry.observations} />
      {!!entry.photos?.length && <section className="work-diary-detail-section"><h3>Fotos do dia</h3><div className="work-diary-photo-list">{entry.photos.map((photo) => <button key={photo.id} className="outline-button" onClick={() => onFile(entry, 'photo', photo.id)}><ImagePlus size={14} /> {photo.name}</button>)}</div></section>}
    </>}
    <div className="modal-actions">{can('work_diary', 'delete') && <button className="table-action danger" onClick={() => onDelete(entry)}><Trash2 size={14} /> Excluir</button>}<span />{can('work_diary', 'edit') && <button className="blue-button" onClick={() => onEdit(entry)}><Pencil size={14} /> Editar</button>}</div>
  </article></div>
}
function DetailField({ label, value }) { return <div className="work-diary-detail-field"><span>{label}</span><p>{value || '—'}</p></div> }

export { WorkDiaryPage }
