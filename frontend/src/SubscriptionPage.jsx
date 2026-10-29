import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, ShieldCheck } from 'lucide-react'
import { API_URL } from './apiConfig'

const statusLabels = { ATIVA: 'Ativa', PENDENTE: 'Pendente', CANCELADA: 'Cancelada', EXPIRADA: 'Expirada' }
const methodLabels = { CARTAO: 'Cartão (simulação)', PIX: 'PIX (simulação)', BOLETO: 'Boleto (simulação)', STRIPE: 'Stripe Checkout' }
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

export function SubscriptionPage({ session, can, required = false }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
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

  async function startCheckout() {
    setSaving(true); setError('')
    try {
      const response = await fetch(`${API_URL}/subscription/stripe-checkout`, { method: 'POST', headers: { Authorization: `Bearer ${session.token}` } })
      const result = await readApiResponse(response)
      if (!result.url) throw new Error('A Stripe não retornou o endereço do Checkout.')
      window.location.assign(result.url)
    } catch (actionError) { setError(actionError.message || 'Não foi possível iniciar o Checkout.') } finally { setSaving(false) }
  }

  const current = data?.subscription
  const canManage = isAdmin && can('subscriptions', 'create')
  return <>
    <div className="section-heading"><div><span className="section-kicker">{required ? 'ATIVAÇÃO DA EMPRESA' : 'GESTÃO DA CONTA'}</span><h1>{required ? 'Ative seu acesso à Nexora' : 'Assinaturas'}</h1><p>{required ? 'Para continuar, a empresa precisa ativar o plano Nexora Pro.' : 'Consulte o plano e acompanhe o estado da assinatura desta empresa.'}</p></div>{!required && <button className="outline-button" onClick={() => { setError(''); setLoading(true); void load() }} disabled={loading}><RefreshCw size={15} /> Atualizar</button>}</div>
    <div className="subscription-banner"><ShieldCheck size={19} /><span>O pagamento acontece na página segura da Stripe. O acesso é liberado após a confirmação do pagamento.</span></div>
    {error && <div className="subscription-error" role="alert"><span>{error}</span><button className="outline-button" onClick={() => { setError(''); setLoading(true); void load() }} disabled={loading}>Tentar novamente</button></div>}
    {loading ? <div className="panel data-state"><p>Carregando assinatura…</p></div> : <>
      <div className="subscription-grid">
        <section className="panel subscription-plan"><div className="subscription-plan-top"><div><span className="section-kicker">PLANO DISPONÍVEL</span><h2>{data?.plan.name || fallbackPlan.name}</h2></div><span className="subscription-price">{moneyLabel(data?.plan.amount ?? fallbackPlan.amount)}<small>/mês</small></span></div><p>Recursos de gestão Nexora em um plano mensal, com cobrança processada pela Stripe.</p><button className="blue-button" disabled={saving || loading || Boolean(error) || !data || !canManage || current?.status === 'ATIVA'} onClick={() => void startCheckout()}>{saving ? 'Abrindo Checkout…' : current?.status === 'ATIVA' ? 'Assinatura ativa' : 'Assinar com Stripe'}</button>{!canManage && <small className="subscription-note">Seu perfil pode consultar o plano, mas não iniciar uma assinatura.</small>}</section>
        <section className="panel subscription-status"><div className="panel-heading"><div><h2>Assinatura da empresa</h2><p>Status e próxima cobrança</p></div>{current && <span className={`status ${current.status === 'ATIVA' ? 'green' : current.status === 'PENDENTE' ? 'amber' : 'red'}`}>{statusLabels[current.status] || current.status}</span>}</div>{current ? <div className="subscription-facts"><div><span>Valor</span><strong>{moneyLabel(current.amount)}</strong></div><div><span>Método</span><strong>{methodLabels[current.payment_method] || '—'}</strong></div><div><span>Data da assinatura</span><strong>{dateLabel(current.subscribed_at)}</strong></div><div><span>Próxima cobrança</span><strong>{dateLabel(current.next_charge_at)}</strong></div></div> : <div className="data-state"><p>Nenhuma assinatura registrada para esta empresa.</p></div>}</section>
      </div>
      <section className="panel page-panel subscription-history"><div className="panel-heading"><div><h2>Histórico de pagamentos</h2><p>Registros vinculados à empresa atual</p></div></div>{data?.payments?.length ? <div className="table-scroll"><table><thead><tr><th>DATA</th><th>EVENTO</th><th>MÉTODO</th><th>VALOR</th><th>RESULTADO</th></tr></thead><tbody>{data.payments.map((payment) => <tr key={payment.id}><td>{dateLabel(payment.created_at)}</td><td>{payment.event_type === 'RENOVACAO' ? 'Renovação' : payment.event_type === 'CANCELAR' ? 'Cancelamento' : payment.event_type === 'EXPIRAR' ? 'Expiração' : payment.event_type === 'PAGAMENTO_FALHOU' ? 'Pagamento não aprovado' : 'Pagamento'}</td><td>{methodLabels[payment.method] || '—'}</td><td>{moneyLabel(payment.amount)}</td><td><em className={`status ${payment.status === 'APROVADO' ? 'green' : payment.status === 'PENDENTE' ? 'amber' : 'red'}`}>{payment.status}</em></td></tr>)}</tbody></table></div> : <div className="empty">Nenhum pagamento registrado.</div>}</section>
    </>}
  </>
}
