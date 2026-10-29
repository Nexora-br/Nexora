# Revisão inicial de privacidade, LGPD, acessibilidade e ativos

**Data da revisão:** 29/10/2026  
**Escopo:** código versionado em `frontend/` e `backend/`. Esta revisão não inspecionou os painéis da Render, GitHub, Stripe, Puter, BrasilAPI, provedor PostgreSQL ou armazenamento de produção.

## O que foi alterado

- Criadas páginas navegáveis de Política de Privacidade, Termos de Serviço, Cookies/armazenamento local, Cancelamento e Reembolso, e um formulário para pedidos LGPD.
- O formulário LGPD prepara uma mensagem no e-mail local para `nexoraatendimentosuporte@gmail.com`; os campos não são enviados ao servidor nem gravados pelo site. Se o usuário não tiver aplicativo de e-mail configurado, deve enviar a mensagem manualmente.
- O cadastro exige aceitação dos Termos; o servidor grava no registro do usuário ou pedido de acesso o horário e a versão do texto aceita. Isso não equivale a consentimento para todos os tratamentos de dados.
- Adicionados links legais à página pública, às páginas de planos e à barra lateral da área autenticada.
- Removido o carregamento de Google Fonts, que fazia conexão externa em visita à página.
- Consultas automáticas de CNPJ/CEP foram restauradas ao sair dos campos, bloqueadas até aceite explícito dos Termos, Política de Privacidade, Aviso de Cookies e Política de Cancelamento/Reembolso. O aceite em contas existentes é registrado no backend com versão e horário; cadastro e pedido de acesso já gravam os mesmos metadados.
- Removidos do cadastro inicial os campos opcionais de logo, configurações de documentos admissionais e política de reembolso/refeição. Permanecem nas configurações empresariais, onde são pertinentes.
- O Nexora AI deixou de consultar automaticamente o estado de login do Puter ao abrir a tela. Pergunta e contexto só são encaminhados após autorização explícita na interface. A autorização é por uso e não é persistida.
- Adicionados link para pular ao conteúdo, foco visível para controles e preferência por movimento reduzido. As imagens encontradas na interface têm texto alternativo, inclusive imagens decorativas com `alt=""`.
- Removidos `hero.png`, `react.svg` e `vite.svg` não utilizados do diretório de assets.

## Inventário de dados observado no código

| Fluxo | Dados observados | Destino/uso observado |
| --- | --- | --- |
| Cadastro de empresa e primeiro administrador | razão social, nome fantasia, CNPJ, endereço comercial, nome, e-mail e senha; contatos e site opcionais; versão/horário do aceite dos Termos | API Nexora e banco configurado; a senha é transformada em hash |
| Pedido de acesso de usuário | CNPJ da empresa, nome, e-mail, senha, telefone/cargo/setor opcionais e aceite dos Termos | API Nexora e banco configurado |
| Operação da empresa | clientes, fornecedores, pessoas, agenda, financeiro, funcionários, segurança do trabalho, documentos e outros registros empresariais | API Nexora e banco; uploads em disco ou Supabase quando configurado |
| Pagamento | identificadores de Stripe Customer, Subscription, Checkout e estado/valor da cobrança | Backend Nexora e Stripe Checkout; o fluxo atual usa Checkout hospedado. Nunca inserir cartão em campos comuns |
| Consulta empresarial | CNPJ/CEP no desfoque do campo ou por ação explícita, apenas após aceite dos documentos legais | BrasilAPI, chamada pelo navegador |
| Nexora AI | pergunta e dados de contexto selecionados por intenção (resumos/linhas limitadas) | API Nexora; no modo Puter, o contexto e a pergunta seguem ao Puter/modelo externo após autorização |
| Sessão | JWT da conta e JWT separado do portal | `localStorage` do navegador até logout/remoção |
| Formulário LGPD | nome, e-mail, empresa opcional, categoria do pedido e detalhes opcionais | Aplicativo de e-mail do próprio titular; não é guardado pelo site |

Não foram encontrados Google Analytics, Meta Pixel, tag de publicidade ou analytics próprios nas telas examinadas. O Google Fonts foi removido. Isso não significa que os provedores de infraestrutura, hospedagem, e-mail, pagamento ou navegador não mantenham registros técnicos próprios.

## Pendências que impedem afirmar conformidade ou publicar os textos como versão final

1. **Identidade do fornecedor/controlador:** o repositório não informa razão social/nome civil, CNPJ/CPF, endereço completo e canal específico do encarregado. As páginas legais sinalizam essa lacuna; esses dados precisam ser fornecidos e publicados antes da oferta/contratação. Não foram inventados.
2. **Configuração real de produção:** não foi possível verificar os valores ativos no Render. `render.yaml` declara variáveis para Stripe, Supabase e IA. O código mantém integração opcional de uploads com Supabase, e `DATABASE_URL` pode ser PostgreSQL hospedado em qualquer fornecedor. Confirmar provedor/localização, armazenamento ativo, subprocessadores, retenção e transferências internacionais nos painéis.
3. **Relação controlador-operador:** preparar contrato de tratamento/DPA com empresas clientes, instruções, categorias, suboperadores, segurança, atendimento a titulares, eliminação/retorno dos dados e incidentes. A política distingue as funções de forma geral, mas não substitui esse contrato.
4. **Retenção e exclusão:** o sistema não documenta prazos por categoria nem um fluxo self-service comprovado para exportar e eliminar dados e anexos. Definir prazos, rotinas de backup e eliminação e executar pedidos válidos, preservando somente retenções legalmente necessárias.
5. **Formulário de direitos:** hoje o formulário abre `mailto:` e não cria protocolo nem garante entrega/monitoramento. Confirmar que o endereço é monitorado, definir SLA e processo de verificação de identidade, triagem e registro. O e-mail Gmail é uma dependência externa.
6. **Dados de trabalhadores:** uploads e módulos empresariais podem incluir documentos trabalhistas e dados pessoais sensíveis de saúde/segurança. Clientes precisam de base legal e transparência próprias, controles de perfil e retenção estrita; avaliar minimização de campos e acesso por função.
7. **Consentimento para IA:** a interface solicita autorização por uso, mas não guarda recibo. Confirmar termos de retenção e treinamento dos provedores Puter/modelo e localização internacional; não usar IA para dados sensíveis ou de terceiros sem instrução, base legal, salvaguardas e autorização apropriadas. Para evitar esse tratamento, mudar `AI_PROVIDER` para `local` e não habilitar Puter.
8. **Acessibilidade:** as mudanças adicionam suporte básico de teclado, mas não são uma certificação WCAG. É necessário testar todos os fluxos, modais, calendário, portal e leitores de tela, incluindo foco contido/devolvido nos modais, ordem, zoom/reflow, contraste e mensagens de erro. Há botões que dependem de inspeção visual manual.
9. **Imagens e direitos autorais:** não foram encontrados endereços de imagens remotas em uso na interface examinada; marcas e imagens vistas são arquivos locais. A presença local e o histórico Git não comprovam autoria ou licença. O titular precisa guardar as licenças/autorizações da logo e dos templates de certificado (`backend/assets/`) e comprovação de direitos de marca. Assets React/Vite não utilizados foram retirados.
10. **Segurança:** revisar política CSP/headers, proteção contra XSS, ciclo de JWT em `localStorage`, limites de acesso/tenant e perfis, rate limiting e MFA administrativo, backups criptografados, processo de incidente e gestão de segredos. A integração e os registros de cada provedor precisam ser avaliados em conjunto.
11. **Contratação e consumo:** informar identidade do fornecedor, preço, recorrência, cancelamento, canal de atendimento e condições antes do Checkout. Validar com advogado a incidência do CDC em cada contratação B2B, regras do direito de arrependimento, emissão fiscal, tributação e condições de estorno. A política não pode afastar direitos cogentes.

## Fontes oficiais consultadas

- [ANPD — Guia orientativo de Cookies e Proteção de Dados Pessoais](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia-orientativo-cookies-e-protecao-de-dados-pessoais.pdf)
- [ANPD — Direitos dos titulares](https://www.gov.br/anpd/pt-br/assuntos/titular-de-dados/direito-dos-titulares)
- [ANPD — Canal de denúncia e petição de titular](https://www.gov.br/anpd/pt-br/canais_atendimento/cidadao-titular-de-dados/denuncia-peticao-de-titular-referente-lgpd)
- [Planalto — Decreto 7.962/2013 (comércio eletrônico)](https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2013/decreto/d7962.htm)
- [Planalto — Código de Defesa do Consumidor](https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm)
- [Stripe — Integration security guide](https://docs.stripe.com/security/guide)

O portal do Planalto bloqueou a leitura automatizada do texto da LGPD nesta revisão; validar a redação atual da lei e normas complementares na revisão jurídica final.

## Conclusão

Esta é uma revisão técnica inicial e um conjunto de rascunhos publicáveis apenas depois de completar os dados do fornecedor/controlador e confirmar as configurações externas. Não constitui parecer jurídico, auditoria independente de segurança, certificação de acessibilidade nem garantia de conformidade com a LGPD ou de imunidade contra litígio.
