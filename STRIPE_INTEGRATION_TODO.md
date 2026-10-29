# Integração Stripe Checkout

## Valores a substituir

Estes valores de exemplo devem ser configurados antes de ativar o Checkout. As chaves devem ser guardadas nos segredos do Render; nunca as coloque no frontend, em código-fonte ou em commits.

**Arquivos que contêm placeholders:**
- [backend/.env.example](backend/.env.example)
- [backend/server.js](backend/server.js)

| Campo | Valor atual | O que configurar |
|---|---|---|
| `STRIPE_SECRET_KEY` | `rk_test_...` | Uma chave restrita de teste da Stripe com as permissões necessárias para Checkout Sessions (criar e consultar), Prices (consultar), Customers (criar) e Subscriptions (consultar). Cadastre-a como segredo do serviço `nexora-backend` no Render. Para produção, use a chave restrita do modo ativo somente depois dos testes. |
| `STRIPE_PRICE_ID` / `line_items[0].price` | `price_...` | O ID de um Price recorrente mensal em BRL para o produto Nexora Pro. O preço deve corresponder aos R$ 500,00 exibidos no sistema. Cadastre o valor como variável `STRIPE_PRICE_ID` no Render. |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | O segredo de assinatura do endpoint de webhook da Stripe. Cadastre-o como segredo `STRIPE_WEBHOOK_SECRET` no Render. |

Os endereços de retorno já usam `FRONTEND_ORIGIN` do Render e o caminho publicado `/Nexora/`:

- Sucesso: `${FRONTEND_ORIGIN}/Nexora/?checkout=success&session_id={CHECKOUT_SESSION_ID}`
- Cancelamento: `${FRONTEND_ORIGIN}/Nexora/?checkout=cancelled`

Se o domínio ou o caminho base do GitHub Pages mudar, ajuste a montagem dessas URLs em [backend/subscription-routes.js](backend/subscription-routes.js).

## Parâmetros configurados

**Arquivo com os parâmetros do Checkout:**
- [backend/subscription-routes.js](backend/subscription-routes.js)

| Parâmetro | Valor |
|---|---|
| `ui_mode` | `hosted_page` (SDK Stripe Node `23.0.1`) |
| `mode` | `subscription` (o plano Nexora Pro é mensal) |
| `billing_address_collection` | `auto` |
| `phone_number_collection` | `{ enabled: true }` |
| `automatic_tax` | `{ enabled: false }` |
| `allow_promotion_codes` | `false` |
| `payment_method_collection` | `always` |
| `submit_type` | `auto` |
| `name_collection` | Nome de pessoa física e razão social habilitados e opcionais |
| `integration_identifier` | `hosted_web_0001` |
| `origin_context` | `web` |

O frontend chama o endpoint autenticado `POST /api/subscription/stripe-checkout`. O servidor cria uma assinatura pendente, abre a página hospedada da Stripe e associa a sessão à empresa. Webhooks assinados registram os IDs de cliente, assinatura e Checkout, atualizam o estado da assinatura e gravam os pagamentos sem duplicar eventos.

## Configuração e próximos passos

1. Na Stripe, crie primeiro um ambiente de testes/sandbox, um produto Nexora Pro e um preço recorrente mensal em BRL. Use esse Price ID em `STRIPE_PRICE_ID`.
2. Crie uma chave restrita de teste com as permissões descritas na tabela acima. O endpoint valida se o Price ID está ativo, em BRL, recorrente mensal e no valor de R$ 500,00. Cadastre `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID` e `STRIPE_WEBHOOK_SECRET` nos Environment Variables do serviço backend no Render. Não envie esses segredos por chat ou commit.
3. Crie um destino de webhook no Workbench da Stripe apontando para `https://nexora-backend-w7aa.onrender.com/api/stripe/webhook`. Selecione `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid` e `invoice.payment_failed`. Copie o `whsec_...` específico desse destino para o Render.
4. No repositório GitHub, adicione a variável de Actions `VITE_ENABLE_SUBSCRIPTION_GATE=true` quando estiver pronto para mostrar a tela de assinatura no GitHub Pages. O workflow já lê essa variável. Antes de ativar o bloqueio, confira e reconcilie as assinaturas existentes para evitar bloquear empresas atuais.
5. Teste todo o fluxo no ambiente de teste: iniciar Checkout, concluir e cancelar um pagamento, esperar o webhook, confirmar o estado no Nexora e conferir a renovação/falha de cobrança. Para assinaturas, teste também os eventos de renovação e cancelamento no Dashboard.
6. Só depois dos testes, configure os Price IDs e chaves do modo ativo. Quando as assinaturas existentes e os webhooks estiverem confirmados, avalie definir `NEXORA_ENFORCE_SUBSCRIPTIONS=true` no Render para que a API também aplique a exigência de assinatura.
7. Antes de produção, adicione tratamento operacional para disputas, reembolsos e alertas de fraude (`charge.dispute.created`, `charge.refunded` e `radar.early_fraud_warning.created`). Esses eventos podem afetar uma cobrança depois da ativação inicial.
8. Para autoatendimento de cancelamento, troca de plano ou atualização de método de pagamento, configure o Stripe Customer Portal.

### Teste de cartão e modo de teste

Use somente chaves e Price IDs do ambiente de teste enquanto validar a integração; não use dados de cartão reais em testes. Um cartão Visa de sucesso é `4242 4242 4242 4242`, com qualquer validade futura e qualquer CVC de três dígitos. Consulte os [cartões oficiais de teste da Stripe](https://docs.stripe.com/testing) para cenários de recusa, autenticação e outros meios de pagamento.

### Estrutura adicionada

- [backend/stripe-webhook.js](backend/stripe-webhook.js): valida a assinatura do webhook e sincroniza o ciclo de vida das assinaturas e pagamentos.
- [STRIPE_INTEGRATION_TODO.md](STRIPE_INTEGRATION_TODO.md): valores e etapas que faltam antes da ativação.

O Stripe Tax está desativado nesta configuração (`automatic_tax.enabled=false`). Antes de cobrar clientes em novas jurisdições, confirme obrigações fiscais e habilite/configure o Stripe Tax com os registros fiscais aplicáveis. Consulte [impostos em assinaturas](https://docs.stripe.com/billing/taxes/collect-taxes).

Recursos: [Suporte Stripe](https://support.stripe.com/) · [Stripe Docs MCP](https://docs.stripe.com/mcp).
