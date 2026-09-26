# Simulador de assinaturas Nexora

Este módulo é exclusivamente para desenvolvimento e testes. Não se conecta a um gateway nem envia cobranças. A tela pública de checkout pode receber dados fictícios de cartão apenas em memória no navegador; não os envia à API, não os persiste e os descarta ao continuar. Nunca digite dados reais. O servidor registra somente a forma de pagamento escolhida no histórico fictício.

## Ativação

- Local: execute o backend normalmente e use o Vite em modo de desenvolvimento. As rotas da API são habilitadas em `NODE_ENV=test` ou com `NEXORA_ENABLE_SIMULATED_BILLING=true`.
- A apresentação pública possui telas próprias de planos e checkout: “Selecionar planos” mostra Nexora Pro (R$ 500,00/mês); “Selecionar plano” abre a escolha entre cartão, PIX e boleto demonstrativos antes do cadastro. O cadastro leva à etapa de ativação simulada antes do workspace.
- Em build publicado, configure `VITE_ENABLE_SIMULATED_BILLING=true` durante o build para habilitar a etapa de ativação e o bloqueio do workspace. Habilite também `NEXORA_ENABLE_SIMULATED_BILLING=true` no backend.
- A API barra as demais rotas enquanto a simulação estiver ativada. Só o administrador da empresa pode confirmar a simulação; todos os usuários da empresa passam pela verificação de assinatura.
- `NEXORA_ENFORCE_SUBSCRIPTIONS=true` também ativa o bloqueio da API, mesmo sem habilitar as rotas do simulador. Administradores são liberados sem assinatura apenas em `NODE_ENV=test`.
- O bloqueio e o checkout fictício ficam desativados por padrão fora do desenvolvimento/testes. Não habilite o simulador como mecanismo de cobrança de clientes: ele não realiza cobrança real.

## Comportamento

O plano é Nexora Pro, R$ 500,00 por mês. Cada assinatura e evento de pagamento fica associado à empresa da sessão autenticada. O servidor ignora `company_id` enviado pelo cliente e só permite as simulações administrativas a usuários com perfil `ADMINISTRADOR`. Empresas novas não recebem uma assinatura automática. Registros antigos criados automaticamente, sem eventos de pagamento, são tratados como ausência de assinatura.

Rotas: `GET /api/subscription`, `POST /api/subscription/checkout` e `POST /api/subscription/admin-action`. As ações administrativas aceitas são `CRIAR_COBRANCA`, `APROVAR_PAGAMENTO`, `RECUSAR_PAGAMENTO`, `CANCELAR`, `RENOVAR` e `EXPIRAR`.

## Persistência

A tabela `subscriptions` armazena o estado atual por empresa. `subscription_payments` mantém o histórico de simulações, valores, métodos e resultados. As tabelas são preparadas pelo inicializador/migrações do backend tanto para SQLite local quanto para PostgreSQL.
