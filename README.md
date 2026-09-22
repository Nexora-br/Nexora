# Nexora

Sistema de gestao empresarial para instalacao e acompanhamento de silos e secadores de graos.

## Estrutura

- `frontend`: dashboard React + Vite.
- `backend`: API Express + SQLite com autenticação JWT, multi-tenant, auditoria e dados persistentes.
- `images`: assets originais da marca.

## Executar

Terminal 1:

```powershell
npm --prefix F:\Nexora\backend start
```

Terminal 2:

```powershell
npm --prefix F:\Nexora\frontend run dev
```

API: `http://localhost:3333`
Frontend: endereço exibido pelo Vite, normalmente `http://localhost:5173`

A API possui autenticação em `/api/auth`, dashboard e projetos protegidos por JWT, clientes, busca global e auditoria. A Fase 3 adiciona CRUDs protegidos para produtos, categorias, locais, fornecedores, compras, contas a pagar/receber, transações, centros de custo, funcionários, equipamentos, contratos, orçamentos, documentos, agenda, notificações e manutenção.

## Fase 4

Conectado à interface existente:

- Fornecedores: CRUD real, formulário completo, filtros por cidade/categoria, ordenação, paginação, visualização e arquivamento.
- Compras: solicitações reais, itens, cotações, aprovação e criação de ordem; recebimento atualiza estoque em transação.
- Financeiro: contas a pagar/receber, criação, listagem, pagamento/recebimento e transação financeira automática.
- Equipamentos: cadastro real e listagem.
- Agenda: eventos persistidos e criação pela tela atual.
- Documentos: upload local protegido por empresa, metadados, busca/filtro e download autenticado.

Upload local: `backend/storage/<company_id>`. O endpoint nunca expõe o caminho físico e verifica o tenant pela sessão.

Operações de estoque:

- `GET /api/inventory`
- `GET /api/inventory/movements`
- `POST /api/inventory/movements`
- `GET/POST /api/inventory/reservations`
- `POST /api/purchase-orders/:id/receive`

Todos os registros filtram por `company_id`, exigem JWT e as alterações importantes geram `audit_logs`. O banco é criado em `backend/nexora.sqlite` e o seed de demonstração é separado:

```powershell
npm --prefix F:\Nexora\backend run seed
```

Usuário do seed: `demo@nexora.local` / `nexora123`.

Testes:

```powershell
npm --prefix F:\Nexora\backend test
npm --prefix F:\Nexora\frontend run build
npm --prefix F:\Nexora\frontend run lint
```

Suíte atual: 10 testes aprovados, incluindo autenticação, isolamento multi-tenant, fornecedores, compras, recebimento com estoque, pagamento com transação, upload/download, equipamentos, agenda, filtros e paginação.

## Nexora AI — situação atual

- Respostas fixas demonstrativas removidas da interface.
- Não existe integração externa ou endpoint de conversa nesta etapa.
- Contexto disponível para uma futura implementação: `/api/dashboard`, `/api/projects`, `/api/inventory`, `/api/accounts-payable`, `/api/accounts-receivable` e `/api/global-search`.
- A interface informa explicitamente que a IA está pendente, sem apresentar números simulados.

Pendências desta etapa: exportação CSV/Excel/PDF, armazenamento cloud S3, telas de cotação/comparação e manutenção com todos os campos avançados, edição/exclusão visual de equipamentos e eventos, e testes automatizados de componentes frontend.
