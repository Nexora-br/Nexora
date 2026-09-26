import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Clock3, RefreshCw, ShieldCheck, XCircle } from 'lucide-react'
import { API_URL } from './apiConfig'

const statusLabels = { ATIVA: 'Ativa', PENDENTE: 'Pendente', CANCELADA: 'Cancelada', EXPIRADA: 'Expirada' }
const methodLabels = { CARTAO: 'Cartão (simulação)', PIX: 'PIX (simulação)', BOLETO: 'Boleto (simulação)' }
const dateLabel = (value) => value ? new Date(value).toLocaleDateString('pt-BR') : '—'
const moneyLabel = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fallbackPlan = { name: 'Nexora Pro', amount: 500 }
const unavailableMessage = 'O servidor de assinaturas da Nexora ainda não está atualizado ou está indisponível. Tente novamente em alguns minutos.'

async function readApiResponse(response) {
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.toLowerCase().includes('application/json')) throw new Error(unavailableMessage)
  let result
  try { result = await response.json() } catch { throw new Error(unavailableMessage) }
  if (!response.ok) throw new Error(result?.error || 'Não foi possível concluir a operação de assinatura.')
  return result
}

export function SubscriptionPage({ session, can, required = false, initialMethod = 'PIX', onActivated }) {
  const [data, setData] = useState(null)
  const [method, setMethod] = useState(initialMethod)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const isAdmin = session.role === 'ADMINISTRADOR'

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/subscription`, { headers: { Authorization: `Bearer ${session.token}` } })
      const result = await readApiResponse(response)
      setData(result)
    } catch (loadError) { setError(loadError.message || 'Não foi possível carregar a assinatura.') } finally { setLoading(false) }
  }, [session.token])

  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  // oxlint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { void load() }, [load])

  async function perform(path, body, success) {
    setSaving(true); setError(''); setMessage('')
    try {
      const response = await fetch(`${API_URL}/subscription/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` }, body: JSON.stringify(body) })
      const result = await readApiResponse(response)
      setData(result); setMessage(success)
      if (result.subscription?.status === 'ATIVA') onActivated?.()
    } catch (actionError) { setError(actionError.message || 'Não foi possível concluir a simulação.') } finally { setSaving(false) }
  }

  const current = data?.subscription
  const canManage = isAdmin && can('subscriptions', 'create')
  return <>
    <div className="section-heading"><div><span className="section-kicker">{required ? 'ATIVAÇÃO DA EMPRESA' : 'GESTÃO DA CONTA'}</span><h1>{required ? 'Ative seu acesso à Nexora' : 'Assinaturas'}</h1><p>{required ? 'Para continuar, a empresa precisa ativar o plano Nexora Pro.' : 'Consulte o plano e acompanhe o estado da assinatura desta empresa.'}</p></div>{!required && <button className="outline-button" onClick={() => { setError(''); setLoading(true); void load() }} disabled={loading}><RefreshCw size={15} /> Atualizar</button>}</div>
    <div className="subscription-banner"><ShieldCheck size={19} /><span>Ambiente de testes: todas as operações são fictícias. Nenhuma cobrança é realizada. Não informe número, validade ou código de segurança do cartão.</span></div>
    {error && <div className="subscription-error" role="alert"><span>{error}</span><button className="outline-button" onClick={() => { setError(''); setLoading(true); void load() }} disabled={loading}>Tentar novamente</button></div>}{message && <div className="subscription-success" role="status"><CheckCircle2 size={16} />{message}</div>}
    {loading ? <div className="panel data-state"><p>Carregando assinatura…</p></div> : <>
      <div className="subscription-grid">
        <section className="panel subscription-plan"><div className="subscription-plan-top"><div><span className="section-kicker">PLANO DISPONÍVEL</span><h2>{data?.plan.name || fallbackPlan.name}</h2></div><span className="subscription-price">{moneyLabel(data?.plan.amount ?? fallbackPlan.amount)}<small>/mês</small></span></div><p>Recursos de gestão Nexora em um plano mensal. Esta tela demonstra somente um fluxo de assinatura para desenvolvimento.</p><div className="subscription-choice"><label htmlFor="subscription-method">Método na simulação</label><select id="subscription-method" value={method} onChange={(event) => setMethod(event.target.value)}><option value="CARTAO">Cartão (sem informar dados)</option><option value="PIX">PIX</option><option value="BOLETO">Boleto</option></select></div><button className="blue-button" disabled={saving || loading || Boolean(error) || !data || !canManage || current?.status === 'ATIVA'} onClick={() => void perform('checkout', { method }, 'Pagamento fictício aprovado. Assinatura ativada.')}>{saving ? 'Processando…' : current?.status === 'ATIVA' ? 'Assinatura ativa' : 'Assinar · simular pagamento'}</button>{!canManage && <small className="subscription-note">Seu perfil pode consultar o plano, mas não iniciar uma assinatura.</small>}</section>
        <section className="panel subscription-status"><div className="panel-heading"><div><h2>Assinatura da empresa</h2><p>Status e próxima cobrança</p></div>{current && <span className={`status ${current.status === 'ATIVA' ? 'green' : current.status === 'PENDENTE' ? 'amber' : 'red'}`}>{statusLabels[current.status] || current.status}</span>}</div>{current ? <div className="subscription-facts"><div><span>Valor</span><strong>{moneyLabel(current.amount)}</strong></div><div><span>Método</span><strong>{methodLabels[current.payment_method] || '—'}</strong></div><div><span>Data da assinatura</span><strong>{dateLabel(current.subscribed_at)}</strong></div><div><span>Próxima cobrança</span><strong>{dateLabel(current.next_charge_at)}</strong></div></div> : <div className="data-state"><p>Nenhuma assinatura registrada para esta empresa.</p></div>}</section>
      </div>
      {canManage && <section className="panel subscription-admin"><div className="panel-heading"><div><h2>Controles de teste</h2><p>Ações administrativas fictícias nesta empresa.</p></div></div><div className="subscription-admin-actions"><button className="outline-button" disabled={saving || Boolean(error)} onClick={() => void perform('admin-action', { action: 'CRIAR_COBRANCA', method }, 'Cobrança fictícia pendente criada.')}><Clock3 size={15} /> Criar pendência</button><button className="outline-button" disabled={saving || Boolean(error)} onClick={() => void perform('admin-action', { action: 'APROVAR_PAGAMENTO' }, 'Pagamento fictício aprovado.')}><CheckCircle2 size={15} /> Aprovar pagamento</button><button className="outline-button" disabled={saving || Boolean(error)} onClick={() => void perform('admin-action', { action: 'RECUSAR_PAGAMENTO', method }, 'Pagamento fictício recusado.')}><XCircle size={15} /> Recusar pagamento</button><button className="outline-button" disabled={saving || !current || Boolean(error)} onClick={() => void perform('admin-action', { action: 'RENOVAR', method }, 'Renovação fictícia registrada.')}><RefreshCw size={15} /> Renovar</button><button className="outline-button" disabled={saving || !current || Boolean(error)} onClick={() => void perform('admin-action', { action: 'CANCELAR' }, 'Assinatura cancelada no simulador.')}><XCircle size={15} /> Cancelar</button><button className="outline-button" disabled={saving || !current || Boolean(error)} onClick={() => void perform('admin-action', { action: 'EXPIRAR' }, 'Assinatura expirada no simulador.')}><Clock3 size={15} /> Expirar</button></div></section>}
      <section className="panel page-panel subscription-history"><div className="panel-heading"><div><h2>Histórico de simulações</h2><p>Registros vinculados à empresa atual</p></div></div>{data?.payments?.length ? <div className="table-scroll"><table><thead><tr><th>DATA</th><th>EVENTO</th><th>MÉTODO</th><th>VALOR</th><th>RESULTADO</th></tr></thead><tbody>{data.payments.map((payment) => <tr key={payment.id}><td>{dateLabel(payment.created_at)}</td><td>{payment.event_type === 'RENOVACAO' ? 'Renovação' : payment.event_type === 'CANCELAR' ? 'Cancelamento' : payment.event_type === 'EXPIRAR' ? 'Expiração' : 'Pagamento'}</td><td>{methodLabels[payment.method] || '—'}</td><td>{moneyLabel(payment.amount)}</td><td><em className={`status ${payment.status === 'APROVADO' ? 'green' : payment.status === 'PENDENTE' ? 'amber' : 'red'}`}>{payment.status}</em></td></tr>)}</tbody></table></div> : <div className="empty">Nenhuma simulação registrada.</div>}</section>
    </>}
  </>
}
