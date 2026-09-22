import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminPage } from '../AdminPage'

const response = (body, ok = true, status = ok ? 200 : 500) => ({ ok, status, json: async () => body })
const admin = { token: 'admin-token', role: 'ADMINISTRADOR' }
const roles = [{ id: 'role-admin', name: 'ADMINISTRADOR' }, { id: 'role-consulta', name: 'CONSULTA' }]
const permissions = [
  { id: 'permission-projects-view', module: 'projects', action: 'view' },
  { id: 'permission-projects-export', module: 'projects', action: 'export' },
  { id: 'permission-finance-view', module: 'finance', action: 'view' },
]
const users = [{ id: 'user-1', name: 'Ana Silva', email: 'ana@empresa.test', role_id: 'role-consulta', role_name: 'CONSULTA', status: 'ATIVO', created_at: '2026-09-21T10:00:00Z' }]
const audit = [{ id: 'audit-1', actor_name: 'Administrador', action: 'EDITAR_PERMISSOES', module: 'PERFIS', record_id: 'role-consulta', created_at: '2026-09-21T10:00:00Z', new_value: '{"permission_ids":["permission-projects-view"]}' }]

function mockAdminApi({ userRows = users, roleRows = roles, permissionRows = permissions, auditRows = audit, rolePermissionRows = [permissions[0]], fail = false, failReset = false } = {}) {
  const fetchMock = vi.fn().mockImplementation((url) => {
    if (fail) return Promise.resolve(response({ error: 'Acesso negado.' }, false, 403))
    if (failReset && url.includes('/reset-password')) return Promise.resolve(response({ error: 'Senha inválida.' }, false, 400))
    if (url.includes('/users')) return Promise.resolve(response(userRows))
    if (url.includes('/roles/') && url.includes('/permissions')) return Promise.resolve(response({ role: roleRows[1], permissions: rolePermissionRows }))
    if (url.endsWith('/roles')) return Promise.resolve(response(roleRows))
    if (url.endsWith('/permissions')) return Promise.resolve(response(permissionRows))
    if (url.includes('/access-audit')) return Promise.resolve(response(auditRows))
    return Promise.resolve(response({ ok: true }))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => { vi.restoreAllMocks() })

describe('AdminPage', () => {
  it('mostra loading e depois lista usuários reais', async () => {
    let resolveUsers
    const pending = new Promise((resolve) => { resolveUsers = resolve })
    const fetchMock = vi.fn().mockImplementation((url) => url.includes('/users') ? pending : Promise.resolve(response(url.includes('/roles/') ? { permissions: [] } : url.endsWith('/roles') ? roles : url.endsWith('/permissions') ? permissions : audit)))
    vi.stubGlobal('fetch', fetchMock)
    render(<AdminPage session={admin} notify={vi.fn()} />)
    expect(screen.getByText('CARREGANDO ADMINISTRAÇÃO...')).toBeInTheDocument()
    resolveUsers(response(users))
    await waitFor(() => expect(screen.getByText('Ana Silva')).toBeInTheDocument())
  })

  it('mostra estado vazio e erro de API', async () => {
    mockAdminApi({ userRows: [] })
    const { unmount } = render(<AdminPage session={admin} notify={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Nenhum usuário encontrado.')).toBeInTheDocument())
    unmount()
    vi.unstubAllGlobals()
    mockAdminApi({ fail: true })
    render(<AdminPage session={admin} notify={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Acesso negado.')).toBeInTheDocument())
  })

  it('pesquisa, cria, edita e alterna status do usuário', async () => {
    const fetchMock = mockAdminApi()
    const user = userEvent.setup()
    render(<AdminPage session={admin} notify={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Ana Silva')).toBeInTheDocument())
    await user.type(screen.getByPlaceholderText('Buscar usuário por nome ou e-mail'), 'Bruno')
    await user.click(screen.getByRole('button', { name: 'Buscar' }))
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/users?search=Bruno'), expect.anything())
    await user.click(screen.getByRole('button', { name: 'Novo usuário' }))
    expect(screen.getByRole('heading', { name: 'Novo usuário' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    await user.click(screen.getByRole('button', { name: 'Editar' }))
    expect(screen.getByRole('heading', { name: 'Editar usuário' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    await user.click(screen.getByRole('button', { name: 'Desativar' }))
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/users/user-1/status'), expect.objectContaining({ method: 'PATCH' }))
    vi.stubGlobal('prompt', vi.fn(() => 'novaSenha123'))
    vi.stubGlobal('confirm', vi.fn(() => true))
    await user.click(screen.getByRole('button', { name: 'Redefinir senha' }))
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/users/user-1/reset-password'), expect.objectContaining({ method: 'POST' }))
  })

  it('carrega perfis, matriz, seleção e persiste alteração de permissão', async () => {
    const fetchMock = mockAdminApi()
    const user = userEvent.setup()
    render(<AdminPage session={admin} notify={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Ana Silva')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /Perfis e matriz/ }))
    expect(screen.getByText('CONSULTA')).toBeInTheDocument()
    expect(screen.getByText('projects')).toBeInTheDocument()
    expect(screen.getByText('Visualizar')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'projects export' }))
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/roles/role-admin/permissions'), expect.objectContaining({ method: 'PUT' }))
  })

  it('trata erro da redefinição de senha', async () => {
    const fetchMock = mockAdminApi({ failReset: true })
    vi.stubGlobal('prompt', vi.fn(() => 'novaSenha123'))
    vi.stubGlobal('confirm', vi.fn(() => true))
    const alertMock = vi.fn()
    vi.stubGlobal('alert', alertMock)
    const user = userEvent.setup()
    render(<AdminPage session={admin} notify={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Ana Silva')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Redefinir senha' }))
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/users/user-1/reset-password'), expect.objectContaining({ method: 'POST' }))
    expect(alertMock).toHaveBeenCalledWith('Senha inválida.')
  })

  it('carrega auditoria, vazio e impede ações para usuário sem autorização', async () => {
    const user = userEvent.setup()
    mockAdminApi()
    render(<AdminPage session={{ token: 'token', role: 'CONSULTA' }} notify={vi.fn()} />)
    expect(screen.getByText('Sem permissão administrativa.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Novo usuário' })).not.toBeInTheDocument()
    vi.unstubAllGlobals()
    const { unmount } = render(<AdminPage session={admin} notify={vi.fn()} />)
    unmount()
    vi.unstubAllGlobals()
    mockAdminApi({ auditRows: [] })
    render(<AdminPage session={admin} notify={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Ana Silva')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Auditoria de acesso' }))
    expect(screen.getByText('Nenhuma alteração de acesso registrada.')).toBeInTheDocument()
  })
})
