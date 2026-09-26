import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppNew, AuthScreen, ClientsPage, HistoryPanel, Pagination, ProjectsPage, StockPage, SuppliersPage } from '../AppNew'
import { canAccess } from '../permissions'

const jsonResponse = (body, ok = true, status = ok ? 200 : 500) => ({ ok, status, headers: { get: () => 'application/json' }, json: async () => body })

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('permissões', () => {
  it('permite view e bloqueia edit/create/delete quando ausentes', () => {
    const session = { role: 'CONSULTA', permissions: ['clients.view'] }
    expect(canAccess(session, 'clients', 'view')).toBe(true)
    expect(canAccess(session, 'clients', 'edit')).toBe(false)
    expect(canAccess(session, 'clients', 'create')).toBe(false)
    expect(canAccess(session, 'clients', 'delete')).toBe(false)
  })

  it('aceita administrador e wildcard', () => {
    expect(canAccess({ role: 'ADMINISTRADOR' }, 'finance', 'delete')).toBe(true)
    expect(canAccess({ role: 'GESTOR', permissions: ['*.*'] }, 'finance', 'delete')).toBe(true)
  })
})

describe('paginação', () => {
  it('desabilita anterior na primeira página e próxima na última', () => {
    const onPage = vi.fn()
    const { rerender } = render(<Pagination pagination={{ page: 1, totalPages: 3, total: 55 }} onPage={onPage} />)
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Próxima' })).not.toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }))
    expect(onPage).toHaveBeenCalledWith(2)
    rerender(<Pagination pagination={{ page: 3, totalPages: 3, total: 55 }} onPage={onPage} />)
    expect(screen.getByRole('button', { name: 'Anterior' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'Próxima' })).toBeDisabled()
  })

  it('não renderiza controles para lista vazia ou de uma página', () => {
    const { rerender } = render(<Pagination pagination={{ page: 1, totalPages: 0, total: 0 }} onPage={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Próxima' })).not.toBeInTheDocument()
    rerender(<Pagination pagination={{ page: 1, totalPages: 1, total: 12 }} onPage={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Anterior' })).not.toBeInTheDocument()
  })
})

describe('autenticação', () => {
  it('submete login válido ao callback', async () => {
    const onLogin = vi.fn()
    const user = userEvent.setup()
    render(<AuthScreen view="login" setView={vi.fn()} error="" onLogin={onLogin} onSignup={vi.fn()} />)
    await user.type(screen.getByLabelText('E-mail corporativo'), 'user@empresa.test')
    await user.type(screen.getByLabelText('Senha'), 'senha123')
    await user.click(screen.getByRole('button', { name: /Entrar no Nexora/ }))
    expect(onLogin).toHaveBeenCalledTimes(1)
  })

  it('mostra erro de login inválido', () => {
    render(<AuthScreen view="login" setView={vi.fn()} error="E-mail ou senha inválidos." onLogin={vi.fn()} onSignup={vi.fn()} />)
    expect(screen.getByText('E-mail ou senha inválidos.')).toBeInTheDocument()
  })

  it('exibe erro retornado por login 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'E-mail ou senha inválidos.' }, false, 401)))
    const user = userEvent.setup()
    render(<AppNew />)
    await user.click(screen.getByRole('button', { name: /Área restrita/ }))
    await user.type(screen.getByLabelText('E-mail corporativo'), 'invalido@test')
    await user.type(screen.getByLabelText('Senha'), 'errada')
    await user.click(screen.getByRole('button', { name: /Entrar no Nexora/ }))
    await waitFor(() => expect(screen.getByText('E-mail ou senha inválidos.')).toBeInTheDocument())
  })

  it('exibe página pública sem sessão e não consulta API', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<AppNew />)
    expect(screen.getByRole('button', { name: /Área restrita/ })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('leva da apresentação à página de planos e depois ao cadastro', async () => {
    const user = userEvent.setup()
    render(<AppNew />)
    await user.click(screen.getByRole('button', { name: 'Planos' }))
    expect(screen.getByRole('heading', { name: 'Nexora Pro' })).toBeInTheDocument()
    expect(screen.getByText(/R\$ 500/)).toBeInTheDocument()
    expect(screen.getByText('PIX')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Selecionar plano/ }))
    expect(screen.getByRole('heading', { name: 'Cadastre sua empresa' })).toBeInTheDocument()
  })

  it('faz login real via API e persiste a sessão', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ token: 'token-real', user: { id: 'u1', name: 'João', email: 'joao@test', role: 'ADMINISTRADOR', permissions: ['*.*'], companyId: 'c1' }, company: { name: 'Empresa Real' } }))
      .mockImplementation((url) => Promise.resolve(jsonResponse(url.includes('/dashboard') ? { stats: [] } : [])))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<AppNew />)
    await user.click(screen.getByRole('button', { name: /Área restrita/ }))
    await user.type(screen.getByLabelText('E-mail corporativo'), 'joao@test')
    await user.type(screen.getByLabelText('Senha'), 'senha123')
    await user.click(screen.getByRole('button', { name: /Entrar no Nexora/ }))
    await waitFor(() => expect(localStorage.getItem('nexora-session')).toContain('token-real'))
    expect(fetchMock.mock.calls[0][0]).toContain('/auth/login')
  })

  it('não exibe dados fictícios quando a rota protegida retorna 401', async () => {
    localStorage.setItem('nexora-session', JSON.stringify({ token: 'token-expirado', userName: 'João', companyName: 'Empresa', role: 'CONSULTA', permissions: [] }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Sessão inválida.' }, false, 401)))
    render(<AppNew />)
    await waitFor(() => expect(screen.getByText('Não foi possível carregar os dados.')).toBeInTheDocument())
    expect(screen.queryByText('Cliente de demonstração')).not.toBeInTheDocument()
  })

  it('faz logout e remove a sessão persistida', async () => {
    localStorage.setItem('nexora-session', JSON.stringify({ token: 'token', userId: 'u1', userName: 'João', companyName: 'Empresa', role: 'ADMINISTRADOR', permissions: ['*.*'] }))
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url) => Promise.resolve(jsonResponse(url.includes('/dashboard') ? { stats: [] } : []))))
    const user = userEvent.setup()
    render(<AppNew />)
    await waitFor(() => expect(screen.getByTitle('Sair')).toBeInTheDocument())
    await user.click(screen.getByTitle('Sair'))
    expect(localStorage.getItem('nexora-session')).toBeNull()
    expect(screen.getByRole('button', { name: /Área restrita/ })).toBeInTheDocument()
  })
})

describe('nexora ai', () => {
  it('renderiza o estado inicial do chat e envia uma pergunta', async () => {
    localStorage.setItem('nexora-session', JSON.stringify({
      token: 'token-ai',
      userId: 'u1',
      userName: 'João',
      companyName: 'Empresa Teste',
      role: 'ADMINISTRADOR',
      permissions: ['*.*']
    }))
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ stats: [] }))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ answer: 'Você tem R$ 1.250,00 para receber.' }))
    vi.stubGlobal('fetch', fetchMock)

    const user = userEvent.setup()
    render(<AppNew />)

    await user.click(screen.getByRole('button', { name: 'Nexora AI' }))
    expect(screen.getByText('Nexora AI')).toBeInTheDocument()
    await user.type(screen.getByPlaceholderText('Pergunte sobre seu negócio...'), 'Quanto tenho para receber?')
    await user.click(screen.getByRole('button', { name: 'Enviar' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/ai/chat'),
      expect.objectContaining({ method: 'POST' })
    ))
    await waitFor(() => expect(screen.getByText('Você tem R$ 1.250,00 para receber.')).toBeInTheDocument())
  })
})

describe('dashboard profissional', () => {
  it('renderiza indicadores operacionais e financeiro somente quando autorizado', async () => {
    localStorage.setItem('nexora-session', JSON.stringify({ token: 'token-dashboard', userId: 'u1', userName: 'João', companyName: 'Empresa', role: 'ADMINISTRADOR', permissions: ['*.*'] }))
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url) => Promise.resolve(jsonResponse(url.includes('/dashboard/overview') ? { stats: [{ label: 'Projetos em andamento', value: '2', detail: 'Dados reais', tone: 'blue', icon: 'Factory' }], financial: { payable: 100, receivable: 450, projectedBalance: 350 }, operational: { overdueProjects: 1, pendingTasks: 2, upcomingActivities: [], criticalStock: [], pendingPurchases: [], upcomingMaintenance: [] } } : []))))
    render(<AppNew />)
    await waitFor(() => expect(screen.getByText('Projetos em andamento')).toBeInTheDocument())
    expect(screen.getByText('R$ 100,00')).toBeInTheDocument()
    expect(screen.getByText('R$ 450,00')).toBeInTheDocument()
    expect(screen.getByText('1 projeto(s)')).toBeInTheDocument()
  })
})

describe('histórico real', () => {
  beforeEach(() => localStorage.setItem('nexora-session', JSON.stringify({ token: 'token', companyId: 'company-a' })))

  it('mostra loading, eventos reais e detalhes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([{ id: 'log-1', created_at: '2026-09-21T15:10:00Z', user_name: 'João', action: 'EDITAR', module: 'SUPPLIERS', new_value: '{"city":"Rio Verde"}' }])))
    render(<HistoryPanel recordId="supplier-a" module="SUPPLIERS" />)
    await waitFor(() => expect(screen.getByText('EDITAR · SUPPLIERS')).toBeInTheDocument())
    expect(screen.getByText('João')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/audit-logs/by-entity/supplier-a'), expect.objectContaining({ headers: { Authorization: 'Bearer token' } }))
  })

  it('trata vazio, erro e 403 sem dados fictícios', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse([])).mockResolvedValueOnce(jsonResponse({}, false, 500)).mockResolvedValueOnce(jsonResponse({}, false, 403))
    vi.stubGlobal('fetch', fetchMock)
    const { rerender } = render(<HistoryPanel recordId="a" module="SUPPLIERS" />)
    await waitFor(() => expect(screen.getByText('Não há dados cadastrados.')).toBeInTheDocument())
    rerender(<HistoryPanel recordId="b" module="SUPPLIERS" />)
    await waitFor(() => expect(screen.getByText('Não foi possível carregar o histórico.')).toBeInTheDocument())
    rerender(<HistoryPanel recordId="c" module="SUPPLIERS" />)
    await waitFor(() => expect(screen.getByText('Histórico não disponível para este perfil.')).toBeInTheDocument())
  })
})

describe('filtros, busca e CRUD visual', () => {
  it('consulta projetos no backend ao filtrar e reinicia na página 1', async () => {
    const onLoad = vi.fn()
    const user = userEvent.setup()
    render(<ProjectsPage projects={[]} pagination={{ page: 1, totalPages: 0, total: 0 }} onLoad={onLoad} onNew={vi.fn()} onEdit={vi.fn()} />)
    await user.type(screen.getByPlaceholderText('Buscar projeto'), 'Silo Norte')
    await user.selectOptions(screen.getByDisplayValue('Todos os status'), 'EM_EXECUCAO')
    await user.click(screen.getByRole('button', { name: 'Filtrar' }))
    expect(onLoad).toHaveBeenCalledWith({ search: 'Silo Norte', status: 'EM_EXECUCAO', page: 1 })
  })

  it('consulta clientes por busca e cidade e não filtra apenas o array local', async () => {
    const onLoad = vi.fn()
    const user = userEvent.setup()
    render(<ClientsPage clients={[{ id: 'c1', legal_name: 'Cliente local' }]} pagination={{ page: 1, totalPages: 1, total: 1 }} onLoad={onLoad} onSave={vi.fn()} onArchive={vi.fn()} can={() => false} />)
    await user.type(screen.getByPlaceholderText('Buscar cliente ou documento'), 'Cliente remoto')
    await user.type(screen.getByPlaceholderText('Cidade'), 'Rio Verde')
    await user.click(screen.getByRole('button', { name: 'Filtrar' }))
    expect(onLoad).toHaveBeenCalledWith({ search: 'Cliente remoto', city: 'Rio Verde', page: 1 })
    expect(screen.getByText('Cliente local')).toBeInTheDocument()
  })

  it('consulta estoque por produto e reinicia a página', async () => {
    const onLoad = vi.fn()
    const user = userEvent.setup()
    render(<StockPage supplies={[]} projects={[]} pagination={{ page: 2, totalPages: 4, total: 70 }} onLoad={onLoad} onNew={vi.fn()} notify={vi.fn()} />)
    await user.type(screen.getByPlaceholderText('Buscar por produto ou SKU'), 'Parafuso')
    await user.click(screen.getByRole('button', { name: 'Filtrar' }))
    expect(onLoad).toHaveBeenCalledWith({ search: 'Parafuso', page: 1 })
  })

  it('filtra fornecedores por busca, cidade e categoria', async () => {
    const onLoad = vi.fn()
    const user = userEvent.setup()
    render(<SuppliersPage suppliers={[]} pagination={{ page: 1, totalPages: 1, total: 0 }} onLoad={onLoad} onSave={vi.fn()} onArchive={vi.fn()} notify={vi.fn()} can={() => false} />)
    await user.type(screen.getByPlaceholderText('Buscar fornecedor, CNPJ ou e-mail'), 'Fornecedor A')
    await user.type(screen.getByPlaceholderText('Cidade'), 'Rio Verde')
    await user.type(screen.getByPlaceholderText('Categoria'), 'Metal')
    await user.click(screen.getByRole('button', { name: 'Filtrar' }))
    expect(onLoad).toHaveBeenCalledWith({ search: 'Fornecedor A', city: 'Rio Verde', category: 'Metal', page: 1 })
  })

  it('abre e salva o cadastro de cliente, mas oculta ações sem permissão', async () => {
    const onSave = vi.fn()
    const user = userEvent.setup()
    render(<ClientsPage clients={[]} pagination={{ page: 1, totalPages: 0, total: 0 }} onLoad={vi.fn()} onSave={onSave} onArchive={vi.fn()} can={(module, action) => action === 'create'} />)
    await user.click(screen.getByRole('button', { name: 'Novo cliente' }))
    await user.type(screen.getByPlaceholderText('Razão social'), 'Cliente Novo')
    await user.type(screen.getByPlaceholderText('Nome fantasia'), 'Cliente Novo')
    await user.type(screen.getByLabelText('CPF/CNPJ'), '12345678900')
    await user.type(screen.getByLabelText('E-mail'), 'cliente@teste.local')
    await user.type(screen.getByLabelText('Telefone'), '62999999999')
    await user.type(screen.getByLabelText('Cidade'), 'Rio Verde')
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Arquivar' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Salvar cliente' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ legal_name: 'Cliente Novo' }), undefined)
  })
})
