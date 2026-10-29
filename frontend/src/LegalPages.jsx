import { useState } from 'react'
import './LegalPages.css'

const privacyEmail = 'nexoraatendimentosuporte@gmail.com'
const pages = {
  privacidade: { title: 'Política de Privacidade', intro: 'Como a Nexora trata dados pessoais na plataforma e no site.' },
  termos: { title: 'Termos de Serviço', intro: 'Condições de acesso e uso da plataforma Nexora.' },
  cookies: { title: 'Aviso de Cookies e armazenamento local', intro: 'Tecnologias usadas para manter o serviço funcionando.' },
  reembolso: { title: 'Cancelamento e reembolso', intro: 'Como pedir cancelamento, exercer direitos do consumidor e solicitar análise de cobrança.' },
  lgpd: { title: 'Solicitação sobre dados pessoais', intro: 'Use este canal para exercer seus direitos previstos na LGPD.' },
}

export function legalPageHref(page) {
  return `${import.meta.env.BASE_URL}?legal=${page}`
}

export function LegalLinks({ className = '' }) {
  return <nav className={`legal-links ${className}`} aria-label="Informações legais">
    <a href={legalPageHref('privacidade')}>Privacidade</a>
    <a href={legalPageHref('termos')}>Termos de serviço</a>
    <a href={legalPageHref('cookies')}>Cookies</a>
    <a href={legalPageHref('reembolso')}>Cancelamento e reembolso</a>
    <a href={legalPageHref('lgpd')}>Seus dados / LGPD</a>
  </nav>
}

export default function LegalPages({ page }) {
  const [submitted, setSubmitted] = useState(false)
  const current = pages[page] || pages.privacidade

  function sendRequest(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const subject = `Solicitação LGPD — ${form.get('requestType')}`
    const body = [
      `Nome: ${form.get('name')}`,
      `E-mail para retorno: ${form.get('email')}`,
      `Empresa (opcional): ${form.get('company') || 'Não informado'}`,
      `Solicitação: ${form.get('requestType')}`,
      '',
      `Detalhes: ${form.get('details') || 'Sem detalhes adicionais.'}`,
      '',
      'Não envie senhas, documentos de identidade, dados de cartão ou dados pessoais de terceiros neste formulário.',
    ].join('\n')
    window.location.href = `mailto:${privacyEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    setSubmitted(true)
  }

  return <main className="legal-page-shell">
    <a className="legal-skip-link" href="#conteudo">Pular para o conteúdo</a>
    <header className="legal-page-header"><a href={import.meta.env.BASE_URL} aria-label="Voltar ao início da Nexora">← Nexora</a><LegalLinks /></header>
    <article className="legal-document" id="conteudo">
      <p className="legal-eyebrow">NEXORA · DOCUMENTOS LEGAIS</p>
      <h1>{current.title}</h1>
      <p className="legal-intro">{current.intro}</p>
      <p className="legal-updated">Versão de 29 de outubro de 2026.</p>

      {page === 'privacidade' && <>
        <section><h2>1. Quem trata os dados</h2><p>“Nexora” é a marca e a plataforma descritas neste documento. A identificação da pessoa física ou jurídica que opera o serviço, seu CNPJ/CPF e endereço para notificações precisam ser confirmados pelo responsável do negócio antes da publicação comercial. Para contato sobre privacidade, use <a href={`mailto:${privacyEmail}`}>{privacyEmail}</a>. O atendimento por esse endereço não substitui a identificação legal do controlador.</p><p>Quando uma empresa cliente cadastra seus funcionários, clientes, fornecedores, contatos e documentos, essa empresa normalmente decide por que e como esses dados são usados e atua como controladora. A Nexora trata esses dados para prestar o serviço, conforme as instruções e o contrato com a empresa, e atua como operadora nesse contexto. A Nexora também pode ser controladora dos dados de cadastro da conta, cobrança, suporte, segurança e administração do próprio serviço.</p></section>
        <section><h2>2. Dados tratados e para quê</h2><ul><li><b>Conta e acesso:</b> nome, e-mail, empresa, função e credenciais protegidas por hash, para criar contas, autenticar usuários, administrar permissões e atender solicitações. No cadastro, são registrados a versão dos Termos aceita e o horário do aceite.</li><li><b>Cadastro empresarial:</b> razão social, nome fantasia, CNPJ, endereço, contatos e dados de configuração fornecidos pelo administrador para configurar a empresa. Consultas de CNPJ e CEP à BrasilAPI ficam bloqueadas até o aceite explícito dos Termos de Serviço, da Política de Privacidade, do Aviso de Cookies e da Política de Cancelamento e Reembolso. Após o aceite, a consulta pode ocorrer automaticamente quando o campo de CNPJ ou CEP perde o foco, ou quando o usuário aciona “Buscar dados”. O CNPJ informado e, na consulta de CNPJ, o CEP retornado são enviados diretamente à BrasilAPI; os resultados devem ser conferidos e podem ser preenchidos manualmente.</li><li><b>Operação da empresa:</b> dados que os usuários inserem em projetos, obras, tarefas, agenda, equipe, funcionários, segurança do trabalho, clientes, fornecedores, compras, estoque, documentos e financeiro. O conteúdo pode incluir dados identificáveis e dados pessoais sensíveis (por exemplo, documentos de saúde e segurança enviados pela empresa). A empresa cliente deve informar seus titulares e evitar inserir dados excessivos ou sem base legal.</li><li><b>Arquivos:</b> documentos e imagens que o usuário decide enviar, além de nome, tipo, tamanho, data e usuário responsável pelo envio, para armazenamento e consulta dentro da empresa.</li><li><b>Assinatura:</b> estado do plano, referências da Stripe, identificadores de cliente/assinatura e eventos de cobrança para administrar a assinatura. O pagamento ocorre no Stripe Checkout; a Nexora não deve receber nem armazenar número completo de cartão ou código de segurança.</li><li><b>Auditoria e segurança:</b> eventos de criação, alteração, acesso a arquivos e operações administrativas, ligados à conta, para rastrear alterações, proteger o serviço e investigar incidentes. O provedor de hospedagem também pode registrar dados técnicos de conexão em seus próprios registros.</li><li><b>Assistente de IA, se usado:</b> pergunta digitada e contexto operacional da empresa são enviados ao provedor configurado. No ambiente atualmente configurado para Puter, a consulta usa o serviço Puter e o modelo de IA indicado na integração; consulte também os termos e a política desses fornecedores. Não envie dados sensíveis, senhas, dados de cartão ou dados de terceiros sem autorização e avaliação prévias.</li></ul></section>
        <section><h2>3. Bases e necessidade</h2><p>O tratamento pode ser necessário para executar o contrato ou procedimentos preliminares, cumprir obrigações legais, exercer direitos, proteger o serviço e atender legítimos interesses compatíveis com os direitos dos titulares. Consentimento é pedido quando for a base apropriada; não é usado como justificativa genérica para todos os tratamentos. Campos opcionais não são necessários para usar as funções que não dependem deles. A empresa cliente é responsável por definir e documentar sua própria base legal para os dados inseridos na conta, inclusive de funcionários.</p><p>O cadastro contém campos opcionais e uploads definidos pelo cliente. Por isso, a Nexora não pode garantir que todos os dados inseridos por cada empresa serão mínimos: o administrador e os usuários devem enviar apenas informações pertinentes à finalidade informada.</p></section>
        <section><h2>4. Compartilhamento e transferências</h2><p>Os dados podem ser tratados por provedores necessários à operação: hospedagem e execução da API na Render, PostgreSQL no provedor configurado por quem administra o serviço, Stripe para Checkout e cobrança, BrasilAPI para consultas iniciadas pelo usuário, e Puter/modelo de IA apenas quando o recurso de IA é utilizado. O código também contém suporte opcional a Supabase Storage, ativado somente quando as variáveis SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são configuradas no servidor. A configuração efetiva de produção, localização de servidores, suboperadores e salvaguardas internacionais precisa ser confirmada pelo administrador e divulgada de forma atualizada.</p><p>A Nexora não identifica no aplicativo atual ferramentas de analytics, publicidade, pixels de marketing ou rastreamento comportamental. Isso não abrange registros técnicos mantidos por hospedagem, infraestrutura, navegador ou fornecedores externos. Não são vendidos dados pessoais.</p></section>
        <section><h2>5. Armazenamento e segurança</h2><p>Os registros operacionais são segregados por empresa no banco de dados. Arquivos podem estar em armazenamento local persistente no servidor ou, se configurado, no Supabase. Credenciais de acesso são armazenadas como hash; o token de sessão do usuário fica no armazenamento local do navegador até o logout ou remoção. Não use dispositivos compartilhados sem sair da conta.</p><p>Os dados são mantidos enquanto necessários para fornecer o serviço e pelo tempo exigido para obrigações legais, exercício regular de direitos, segurança e resolução de cobranças. A política operacional atual não estabelece prazos específicos por categoria; os prazos, rotinas de backup e eliminação precisam ser definidos e executados pelo operador e pelos provedores. O encerramento da conta não apaga automaticamente registros cuja conservação seja legalmente necessária.</p></section>
        <section><h2>6. Direitos e solicitações</h2><p>O titular pode pedir confirmação e acesso, correção, informação sobre compartilhamento, anonimização, bloqueio ou eliminação quando cabíveis, portabilidade nos termos da regulamentação, revogação de consentimento e revisão de decisões automatizadas. O atendimento é gratuito, sujeito a validação proporcional de identidade e a retenções exigidas por lei. Se os dados forem inseridos por uma empresa cliente, o pedido sobre esses dados deve ser feito primeiro à empresa controladora; a Nexora auxiliará o cliente conforme seu contrato.</p><p>Use o <a href={legalPageHref('lgpd')}>formulário de solicitação LGPD</a> ou envie e-mail para <a href={`mailto:${privacyEmail}`}>{privacyEmail}</a>. O formulário abre o aplicativo de e-mail do seu dispositivo; o site não guarda nem envia o pedido automaticamente.</p></section>
        <section><h2>7. Incidentes e mudanças</h2><p>Adotamos controles técnicos e administrativos compatíveis com o serviço, mas nenhum ambiente conectado é isento de risco. O operador e os clientes devem manter controles de acesso, senhas fortes, cópias de segurança e procedimentos de resposta a incidentes. Esta política será atualizada quando os tratamentos mudarem; a versão vigente ficará disponível nesta página.</p></section>
      </>}

      {page === 'cookies' && <>
        <section><h2>O que a Nexora usa</h2><p>O aplicativo não usa cookies de publicidade, pixels de marketing nem analytics próprios. Para manter a sessão iniciada, o navegador armazena localmente um token de acesso e, no portal do cliente, um token separado. Esses itens são estritamente funcionais: não são cookies e não servem para publicidade, mas permitem autenticação e acesso à conta. Removê-los ou bloquear armazenamento local pode encerrar a sessão ou impedir o uso.</p><p>Os provedores de hospedagem, pagamento e serviços acionados pelo usuário podem usar tecnologias próprias em seus domínios. Stripe Checkout, BrasilAPI e Puter só são acessados nos fluxos correspondentes. Consulte as informações de cada fornecedor antes de utilizá-los.</p><p>Você pode remover o armazenamento do site pelas configurações do navegador ou sair da conta. A remoção pode exigir novo login. Como não há rastreadores opcionais configurados, esta versão não exibe banner de consentimento para analytics/marketing. Uma ferramenta não essencial somente poderá ser adicionada após análise e escolha de privacidade apropriada.</p></section>
      </>}

      {page === 'termos' && <>
        <section><h2>1. Identificação e aceitação</h2><p>Antes de disponibilizar estes termos para contratação, o operador deve preencher a razão social/nome, CNPJ/CPF e endereço completo do fornecedor. Esses dados não constam no repositório analisado e não podem ser inventados. O uso da plataforma requer leitura destes termos e da <a href={legalPageHref('privacidade')}>Política de Privacidade</a>. Para contratos empresariais, o administrador declara possuir poderes para cadastrar a empresa e seus usuários.</p></section>
        <section><h2>2. Serviço e contas</h2><p>A Nexora oferece ferramentas de gestão de operações empresariais, conforme recursos disponíveis no plano contratado. O cliente é responsável pelos dados que insere, pelos acessos que concede, pela licitude da coleta e uso desses dados e por orientar seus usuários e titulares. O cliente deve manter informações corretas, proteger suas credenciais e comunicar acessos indevidos.</p><p>É proibido usar a plataforma para fins ilícitos, violar direitos de terceiros, tentar contornar controles de segurança ou enviar código malicioso. A empresa cliente deve limitar os dados pessoais ao necessário, não inserir dados sensíveis sem necessidade e base legal apropriada e não enviar dados de cartão para campos comuns ou ao assistente.</p></section>
        <section><h2>3. Plano, pagamento e cancelamento</h2><p>O preço vigente exibido no site é R$ 749,99 por empresa ao mês, sujeito às condições apresentadas antes da confirmação da contratação. A cobrança real só ocorre quando o Checkout Stripe e as credenciais de produção estiverem efetivamente habilitados. A Stripe processa os dados de pagamento em ambiente próprio; aplicam-se também os termos da Stripe. Não confunda telas de demonstração com uma cobrança real.</p><p>A assinatura é recorrente e pode ser cancelada pelo responsável da conta na forma indicada no painel ou pelo canal de suporte. O cancelamento impede renovações futuras, observados o ciclo já pago e os direitos legais aplicáveis. Atraso pode suspender gravações, sem impedir visualização de dados existentes, conforme a regra atualmente adotada pelo serviço. Consulte a <a href={legalPageHref('reembolso')}>política de cancelamento e reembolso</a>.</p></section>
        <section><h2>4. Disponibilidade, dados e encerramento</h2><p>O serviço depende de conectividade e provedores de terceiros; podem ocorrer interrupções, manutenção ou indisponibilidade externa. A empresa deve manter cópias de registros importantes. Após o encerramento, o acesso e a retenção seguem o contrato, a legislação e a Política de Privacidade. Não há promessa de disponibilidade contínua ou recuperação de arquivo sem uma configuração de backup contratada.</p></section>
        <section><h2>5. Propriedade intelectual e contato</h2><p>A marca, o software e o conteúdo original da Nexora permanecem com seus respectivos titulares. O cliente conserva os direitos sobre o conteúdo enviado e autoriza seu processamento apenas para prestar o serviço. Não copie ou reutilize imagens, marcas, documentos ou materiais de terceiros sem licença. Dúvidas: <a href={`mailto:${privacyEmail}`}>{privacyEmail}</a>.</p></section>
      </>}

      {page === 'reembolso' && <>
        <section><h2>Cancelamento</h2><p>O administrador da conta pode solicitar o cancelamento a qualquer momento pelo painel de assinatura, se disponível, ou pelo e-mail <a href={`mailto:${privacyEmail}?subject=Cancelamento%20da%20assinatura`}>{privacyEmail}</a>. Informe o e-mail da conta e a empresa. A solicitação por e-mail será confirmada pelo mesmo canal. O cancelamento evita cobranças futuras após o processamento, mas não implica, por si só, estorno automático de períodos já iniciados.</p></section>
        <section><h2>Direito de arrependimento e reembolso</h2><p>Quando a contratação estiver sujeita ao Código de Defesa do Consumidor, será respeitado o direito de arrependimento aplicável às contratações fora do estabelecimento, inclusive o prazo legal geral de sete dias, quando cabível, e os demais direitos obrigatórios. Para exercer o direito ou relatar cobrança indevida, contate <a href={`mailto:${privacyEmail}?subject=Pedido%20de%20reembolso`}>{privacyEmail}</a>, identificando a contratação. A análise considerará a legislação aplicável, a natureza empresarial ou de consumo da relação, a data da contratação e o estado da cobrança; nenhuma cláusula desta política limita direitos legais.</p><p>Se o pagamento foi processado pela Stripe, após a aprovação do estorno a Stripe e/ou a instituição emissora poderá levar prazo operacional próprio para refletir o crédito. O atendimento informará a decisão e o status disponíveis.</p></section>
        <section><h2>Atendimento</h2><p>O canal eletrônico para cancelamento, dúvidas ou reclamações é <a href={`mailto:${privacyEmail}`}>{privacyEmail}</a>. O fornecedor deve identificar-se com razão social/nome, CPF/CNPJ e endereço nos documentos e na oferta de contratação. Essas informações ainda precisam ser fornecidas pelo responsável da Nexora para que esta página possa ser publicada como política final.</p></section>
      </>}

      {page === 'lgpd' && <>
        <section><h2>Envie uma solicitação</h2><p>Este formulário prepara uma mensagem no seu aplicativo de e-mail; o Nexora não armazena os campos nem transmite o pedido ao servidor. Para segurança, poderemos pedir confirmação de identidade, evitando solicitar cópias de documentos quando não forem necessárias.</p>
          <form className="lgpd-request-form" onSubmit={sendRequest}>
            <label>Seu nome<input name="name" autoComplete="name" maxLength="120" required /></label>
            <label>E-mail para retorno<input name="email" type="email" autoComplete="email" maxLength="254" required /></label>
            <label>Empresa (opcional)<input name="company" autoComplete="organization" maxLength="160" /></label>
            <label>O que deseja solicitar?<select name="requestType" required defaultValue=""><option value="" disabled>Selecione</option><option>Acesso ou confirmação do tratamento</option><option>Correção de dados</option><option>Informações sobre compartilhamento</option><option>Anonimização, bloqueio ou eliminação</option><option>Portabilidade</option><option>Revogação de consentimento</option><option>Revisão de decisão automatizada</option><option>Outra solicitação de privacidade</option></select></label>
            <label>Detalhes necessários (opcional)<textarea name="details" maxLength="1200" rows="5" placeholder="Descreva o pedido sem incluir senhas, documentos ou dados de outras pessoas." /></label>
            <p className="lgpd-form-note">Não informe senha, número de cartão, código de segurança ou dados sensíveis neste formulário. Se os dados forem geridos por uma empresa cliente, ela poderá ser a controladora responsável pelo pedido.</p>
            <button type="submit">Preparar e-mail para a Nexora</button>
            {submitted && <p role="status">Se o aplicativo de e-mail não abriu, envie sua solicitação para {privacyEmail}.</p>}
          </form>
        </section>
      </>}

      <aside className="legal-contact-note"><strong>Informação necessária para publicação final</strong><p>A identidade legal do controlador/fornecedor (razão social ou nome, CNPJ/CPF e endereço), a localização efetiva do banco e dos arquivos, os prazos de retenção e a cadeia de suboperadores precisam ser confirmados pelo responsável da Nexora. Este rascunho não substitui validação jurídica nem confirma conformidade legal ou técnica.</p></aside>
      <footer className="legal-document-footer"><LegalLinks /><a href={import.meta.env.BASE_URL}>Voltar ao site</a></footer>
    </article>
  </main>
}
