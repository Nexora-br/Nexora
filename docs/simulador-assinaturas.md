# Simulador de assinaturas Nexora

Este módulo é exclusivamente para desenvolvimento e testes. Não se conecta a um gateway, não envia cobranças e não solicita nem armazena número, validade ou CVV de cartão. Escolher “Cartão” apenas registra essa forma no histórico fictício.

## Ativação

- Local: execute o backend normalmente e use o Vite em modo de desenvolvimento. As rotas da API são habilitadas em `NODE_ENV=test` ou com `NEXORA_ENABLE_SIMULATED_BILLING=true`.
- Para mostrar a aba em um build de frontend, configure `VITE_ENABLE_SIMULATED_BILLING=true` durante o build.
- Deixe ambas as variáveis desligadas nos ambientes publicados ao Nexora. A interface e a API ficam desativadas por padrão fora do desenvolvimento/testes.

## Comportamento

O plano é Nexora Pro, R$ 500,00 por mês. Cada assinatura e evento de pagamento fica associado à empresa da sessão autenticada. O servidor ignora `company_id` enviado pelo cliente e só permite as simulações administrativas a usuários com perfil `ADMINISTRADOR`. Empresas novas não recebem uma assinatura automática. Registros antigos criados automaticamente, sem eventos de pagamento, são tratados como ausência de assinatura.

Rotas: `GET /api/subscription`, `POST /api/subscription/checkout` e `POST /api/subscription/admin-action`. As ações administrativas aceitas são `CRIAR_COBRANCA`, `APROVAR_PAGAMENTO`, `RECUSAR_PAGAMENTO`, `CANCELAR`, `RENOVAR` e `EXPIRAR`.

## Persistência

A tabela `subscriptions` armazena o estado atual por empresa. `subscription_payments` mantém o histórico de simulações, valores, métodos e resultados. As tabelas são preparadas pelo inicializador/migrações do backend tanto para SQLite local quanto para PostgreSQL.
