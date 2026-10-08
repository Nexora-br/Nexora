const PDFDocument = require('pdfkit')

const admissionDocuments = [
  ['termo_aditivo', '1 Termo aditivo'], ['ficha_epi', '2 Ficha de controle de EPI'], ['termo_lgpd', '2 Termo LGPD'],
  ['atualizacao_endereco', '3 Termo de atualização de endereço'], ['ordem_servico', '4 Ordem de serviço'],
  ['responsabilidade_epi', '6 Termo de responsabilidade de EPI'], ['ciencia_codigo_etica', '7 Ciência e concordância do código de ética'],
  ['itens_pessoais', '8 Termo de itens pessoais'], ['termo_folga', '9 Termo de folga'], ['desconto_folga', '10 Termo de folga e anuência de desconto'],
  ['conta_salario', '11 Termo de conta salário'], ['reembolso', '12 Termo de reembolso'], ['ciencia_alojamento', '13 Ciência e concordância sobre alojamento'],
].map(([key, label]) => ({ key, label }))
const admissionDocumentKeys = new Set(admissionDocuments.map(({ key }) => key))

const fullDate = (value) => new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
const companyLocation = (company) => [company.address, company.address_number, company.complement, company.district, company.city, company.state].filter(Boolean).join(', ')
const employeeLocation = (employee) => [employee.home_address, employee.home_address_number, employee.home_complement, employee.home_district, employee.home_city, employee.home_state].filter(Boolean).join(', ')
const money = (value) => Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const textFor = (key, employee, company, date) => {
  const companyName = company.trade_name || company.legal_name
  const companyAddress = companyLocation(company) || 'Endereço da empresa não cadastrado'
  const homeAddress = employeeLocation(employee) || 'Endereço residencial não cadastrado'
  const name = employee.name
  const cpf = employee.document || 'CPF não informado'
  const job = employee.job_title || 'Função não informada'
  const employeeDate = employee.admission_date ? fullDate(employee.admission_date) : date
  switch (key) {
    case 'ficha_epi': return [
      'FICHA DE CONTROLE INDIVIDUAL DE EPI', `Nome: ${name}     Função: ${job}     Setor: ${employee.department || 'CANTEIRO DE MONTAGEM'}     Registro: ${employee.registration_number}`,
      `Declaro ter recebido os equipamentos abaixo discriminados e ter sido orientado no seu uso correto e adequado. Declaro ainda ter conhecimento de que o seu uso é indispensável e obrigatório ao exercício das minhas atividades e me comprometo a usá-los sempre que necessário e providenciar a sua substituição quando estiverem inadequados para o uso. Comprometo-me a zelar pelo seu estado de conservação e devolvê-los caso ocorra meu desligamento. Autorizo a ${companyName} a descontar de meus salários o seu valor de custo em caso de perda, dano ou extravio, ressalvando o desgaste natural.`,
      `${company.city || 'Cidade não informada'}${company.state ? ` - ${company.state}` : ''} — ${employeeDate}`, 'Assinatura do colaborador: __________________________    Rubrica (visto): __________________________',
    ]
    case 'termo_aditivo': return [
      'TERMO ADITIVO AO CONTRATO DE TRABALHO',
      `Que entre si celebraram, de um lado a empresa ${companyName}, neste ato denominado EMPREGADOR, e de outro, ${name}, neste ato denominado EMPREGADO, mediante as seguintes condições:`,
      'Cláusula Primeira:', 'O EMPREGADO, neste ato, declara que tem a sua disposição Vale Transporte a ser fornecido pela empresa, suficiente para o deslocamento de sua residência ao trabalho e vice-versa, tão logo assim opte no setor de Recursos Humanos.',
      'Parágrafo Único. O empregado declara que tem ciência de que é vedado o deslocamento ao trabalho, ida e volta, através de veículo para o qual não esteja habilitado nos órgãos de trânsito correspondente, assumindo todos os riscos caso opte por não observar o presente dispositivo.',
      'Cláusula Terceira:', 'Ficam ratificadas as demais cláusulas do contrato em questão, desde que não contrariem o que ficou convencionado no presente Termo Aditivo.',
      'E, por estarem assim, justos e acordados, firmam o presente Termo Aditivo ao Contrato de Trabalho, em 02 (duas) vias de igual teor, para que produzam seus jurídicos e legais efeitos, na presença de 02 (duas) testemunhas igualmente subscritas.',
      `${company.city || 'Cidade não informada'}${company.state ? `, ${company.state}` : ''}, ${date}`, 'EMPREGADOR: _________________________________________________', `EMPREGADO: __________________________________________________\nCPF ${cpf}`, 'Testemunhas: 1) __________________________________  2) __________________________________',
    ]
    case 'termo_lgpd': return [
      'TERMO DE CONSENTIMENTO PARA TRATAMENTO E RETENÇÃO DE CÓPIAS DE DOCUMENTOS PESSOAIS',
      `Pelo presente instrumento particular, eu ${name}, portador(a) do CPF: ${cpf}, residente e domiciliado(a) a ${homeAddress}, consinto de forma livre, informada e inequívoca, nos termos da Lei nº 13.709/2018 (Lei Geral de Proteção de Dados – LGPD), com o tratamento e a retenção de cópias dos meus documentos pessoais fornecidos à ${companyName}, inscrita no CNPJ sob o nº ${company.cnpj || 'CNPJ não informado'}, com sede em ${companyAddress}.`,
      '1. Finalidade da Coleta e Retenção\nO tratamento de dados pessoais se destina exclusivamente às seguintes finalidades: cumprimento de obrigações legais e regulatórias; registro em sistemas administrativos e de folha de pagamento; cumprimento de obrigações trabalhistas, previdenciárias e fiscais; exercício regular de direitos em processo judicial, administrativo ou arbitral.',
      '2. Dados Tratados\nOs documentos cujas cópias poderão ser coletadas e armazenadas incluem, mas não se limitam a: documento de identidade (RG); CPF; título de eleitor; comprovante de residência; certidão de nascimento ou casamento; carteira de trabalho (CTPS); cartão PIS/PASEP; certificados de escolaridade e qualificação profissional; dados bancários para fins de pagamento de salário.',
      '3. Compartilhamento\nOs dados poderão ser compartilhados com órgãos governamentais e autoridades públicas; empresas de contabilidade terceirizadas; instituições financeiras para processamento de folha de pagamento; planos de saúde e benefícios, quando aplicável.',
      '4. Segurança e Confidencialidade\nA empresa adota medidas técnicas e administrativas para proteger os dados pessoais contra acessos não autorizados, vazamentos, perdas, alterações ou qualquer forma de tratamento inadequado ou ilícito.',
      '5. Direitos do Titular\nNos termos da LGPD, o titular dos dados poderá, a qualquer tempo, solicitar acesso aos dados; correção de dados incompletos, inexatos ou desatualizados; anonimização, bloqueio ou eliminação de dados desnecessários, excessivos ou tratados em desconformidade; revogação deste consentimento, ressalvadas as hipóteses legais que autorizem o tratamento.',
      '6. Prazo de Retenção\nAs cópias dos documentos serão mantidas pelo prazo necessário ao cumprimento das finalidades legais e contratuais, podendo ser armazenadas após o término do vínculo empregatício, conforme exigências legais.',
      'Declaro ter lido, compreendido e concordado com os termos aqui dispostos.', `${companyAddress}, ${date}`, 'Assinatura do(a) Colaborador(a): ______________________________\nNome completo: ______________________________________________', 'Assinatura do Representante da Empresa: _____________________\nNome completo e cargo: ______________________________________',
    ]
    case 'atualizacao_endereco': return [
      'TERMO DE CIÊNCIA, RESPONSABILIDADE E ATUALIZAÇÃO CADASTRAL',
      `A empresa ${companyName}, inscrita no CNPJ nº ${company.cnpj || 'CNPJ não informado'}, estabelece o presente termo para fins de organização logística, concessão de passagens e deslocamentos relacionados às atividades laborais do colaborador.`,
      `Eu, ${name}, portador(a) do CPF nº ${cpf}, ocupante da função de ${job}, declaro estar ciente e de acordo com as condições abaixo:`,
      '1. ENDEREÇO CADASTRADO PARA FINS DE DESLOCAMENTO\nDeclaro que o endereço residencial informado e mantido em meu cadastro funcional será considerado pela empresa como endereço oficial para fins de aquisição de passagens, programação de folgas, férias, desligamento contratual e demais deslocamentos vinculados ao contrato de trabalho.',
      '2. OBRIGAÇÃO DE COMUNICAÇÃO E ATUALIZAÇÃO CADASTRAL\nComprometo-me a comunicar formalmente ao setor responsável da empresa qualquer alteração de endereço residencial, município de destino ou local de embarque/desembarque, com antecedência mínima de 30 (trinta) dias da data prevista para folgas, férias, rescisão contratual ou quaisquer deslocamentos custeados pela empresa.',
      '3. RESPONSABILIDADES E CONDIÇÕES PARA FORNECIMENTO DE PASSAGENS\nFica estabelecido que a empresa não se responsabilizará por custos adicionais, remarcações, cancelamentos, diferenças tarifárias ou quaisquer despesas decorrentes da ausência de comunicação prévia acerca da alteração de endereço ou destino. Na hipótese de solicitação de passagem para local diverso daquele constante no cadastro funcional, sem observância do prazo estipulado neste termo, a empresa poderá limitar o fornecimento da passagem ao endereço anteriormente registrado.',
      '4. DISPOSIÇÕES GERAIS\nO presente termo possui a finalidade de assegurar a adequada organização logística e operacional da empresa, garantindo maior controle administrativo sobre os deslocamentos realizados em razão do vínculo empregatício.',
      `${companyAddress}, ${date}`, `${name}   CPF: ${cpf}\nAssinatura do empregado: _____________________________\nAssinatura do empregador: ____________________________`,
    ]
    case 'ordem_servico': return [
      'ORDEM DE SERVIÇO — SEGURANÇA E SAÚDE NO TRABALHO', 'Cargo: Auxiliar de Montagem I', `Admissão: ${employeeDate}`, `Nome: ${name}`, `Matrícula: ${employee.registration_number}`,
      'Descrição das Atividades Exercidas:\nAuxiliar na montagem e desmontagem de estruturas metálicas, equipamentos e componentes, realizando a preparação, separação e organização de materiais, ferramentas e peças. Apoiar na movimentação e posicionamento de cargas e estruturas, executar atividades básicas de montagem, fixação, ajuste e acabamento de peças conforme orientações técnicas. Manter a limpeza e organização da área de trabalho, cumprir normas de segurança, procedimentos internos e utilizar corretamente os EPIs. Zelar pela conservação de ferramentas e equipamentos, comunicar situações de risco, incidentes ou irregularidades e apoiar em atividades operacionais conforme necessidade. Realizar atividades em altura e em espaço confinado, seguindo rigorosamente os procedimentos de segurança aplicáveis. Auxilia eventualmente em atividades de trabalho a quente em área aberta com frequência média de até 1 hora semanal.',
      'Agentes Associados às Atividades:\n(01.14.001) Manganês e seus compostos, fumos; (01.17.001) Petróleo e seus derivados; (02.01.001) Ruído contínuo ou intermitente (legislação previdenciária); (02.01.014) Temperaturas anormais (calor) (legislação previdenciária); Postura Inadequada; Levantamento e transporte manual de cargas ou volumes; Radiação não ionizante; Queda de nível superior a 2m; Ambientes com risco de soterramento; Objetos cortantes e/ou perfurocortantes; Excesso de Exigência cognitiva; Insegurança no emprego; Possíveis situações de estresse organizacional; Estresse ocupacional, frustração, desgaste emocional e impacto psicossocial.',
      'EPI’s de Uso Obrigatório:\nBota de segurança com biqueira, Óculos de segurança com lente escura, Touca Árabe, Protetor auditivo NRssf 13dB, Capacete com fita jugular, Cinto de segurança tipo paraquedista, Luva anticorte, Luva Anti Corte, Avental de raspa de couro, Mangote de raspa, Máscara de Solda, LUVA PARA PROTEÇÃO CONTRA AGENTES TÉRMICOS E MECÂNICOS, Máscara PFF2, Luva Anticorte impermeável.',
      'Recomendações Gerais e Treinamentos:\nNR 01 - Integração; NR 06 - Equipamentos de Proteção Individual; NR 07 - Noções Básicas de Primeiros Socorros; NR 12 - Máquinas e Equipamentos; NR 17 - Ergonomia; NR 23 - Proteção e Combate a Incêndio; NR 33 - Espaço Confinado; NR 34 - Serviço a Quente; NR 35 - Trabalho em Altura.',
      'Procedimentos em Casos de Acidentes:\nComunicar imediatamente a supervisão quando da ocorrência de acidente do trabalho, de trajeto ou surgir qualquer tipo de doença profissional; prestar informações verdadeiras para o preenchimento da ficha de investigação de acidente. Todo acidente de trabalho deverá ser comunicado ao superior imediato ou ao departamento responsável para providências legais.',
      'Punições pelo Não Cumprimento desta O.S.:\nA recusa ao fiel cumprimento desta Ordem de Serviço, no todo ou em parte, constitui ato faltoso e sujeita o funcionário às penalidades previstas na lei e normas aplicáveis.',
      'Observações e Normas Internas:\nManter a limpeza e organização do ambiente; usar corretamente os EPIs; respeitar sinalizações, procedimentos, horários e normas de segurança; zelar pelas ferramentas e equipamentos; comunicar riscos à supervisão; participar dos treinamentos de segurança. Declaro que recebi cópia desta OS e estou ciente dos itens nela constantes.',
      `${companyAddress} — ${date}`, 'Empregador: ____________________________________', 'Assinatura do funcionário: ______________________________',
    ]
    case 'responsabilidade_epi': return [
      'TERMO DE RESPONSABILIDADE EPI', `Recebi da empresa ${companyName} para meu uso obrigatório os EPIs (Equipamentos de Proteção Individual) constantes nesta ficha, os quais obrigo-me a utilizar corretamente durante o tempo que permanecerem ao meu dispor, observando as medidas gerais de disciplina e uso que integram a NR-06 e a Portaria nº 3.214 de 08 de junho de 1978.`,
      '1 – Usar o EPI indicado apenas para as finalidades a que se destina.\n2 – Somente iniciar o serviço se estiver usando os EPIs indicados para a tarefa.\nResponsabilizar-se pela guarda e conservação dos EPIs.\nComunicar qualquer dano ou extravio no EPI para aquisição de outro.\nResponder perante a empresa pelo custo integral ao preço de mercado do dia nos casos previstos em lei, inclusive perda, extravio, alteração do padrão ou inutilização por procedimento inadequado.',
      'Declaro haver recebido treinamento sobre o uso dos EPIs e estar de pleno acordo com as normas dos equipamentos de proteção individual acima estipuladas.', `${date}`, `${name}    Assinatura: ____________________________________`, 'Assinatura do responsável: ______________________________',
    ]
    case 'ciencia_codigo_etica': return [
      'TERMO DE CIÊNCIA E CONCORDÂNCIA', 'Declaro que recebi uma cópia, li, recebi treinamento de capacitação, esclareci minhas dúvidas, compreendi e concordei com os termos do presente programa do Código de Ética e Conduta. Afirmo ter conhecimento das obrigações, responsabilidades e consequências inerentes ao presente Código e que me submeterei a todos os treinamentos relativos a normas e condutas fomentados pela empresa.', `${companyAddress}, ${date}`, `Nome do colaborador: ${name}\nAssinatura: __________________________________________`, 'Nome e assinatura do diretor: ___________________________', 'Nome e assinatura do instrutor: _________________________',
    ]
    case 'itens_pessoais': return [
      'TERMO DE RESPONSABILIDADE', `Declaro ter recebido um travesseiro, um lençol com elástico, um de cima, um cadeado e um copo para meu uso pessoal. Comprometo-me ainda a zelar pelo seu estado de conservação e devolvê-lo caso ocorra meu desligamento. Autorizo a ${companyName} a descontar de meus salários o seu valor de custo em caso de perda, dano, extravio, ressalvando o desgaste natural.`, `${name}\nCPF: ${cpf}\nFunção: AUXILIAR DE MONTAGEM I`, `Ciente em: ${date}`, 'Assinatura: __________________________________________',
    ]
    case 'termo_folga': return [
      'TERMO DE FOLGA', `Eu, ${name}, inscrito no CPF: ${cpf}, declaro ter recebido as informações da empresa ${companyName}: ${company.cnpj || 'CNPJ não informado'} situada na ${companyAddress}, referentes a folgas por tempo de trabalho pelo período de 60 e 90 dias. Sendo que, 60 dias consecutivos na obra tem direito a (05) dias de folgas - 90 dias consecutivos (10) dias de folgas, essas folgas serão contabilizadas a partir do momento da saída da obra para a minha cidade. Terei direito de tirar as folgas (5 ou 10 dias consecutivos) se não houver faltas sem justificativas no período trabalhado. Em caso de faltas sem justificativas, as folgas poderão ser reduzidas, ou seja, se o colaborador ficou 1, 2 ou 3 dias no período de 60 a 90 dias na obra sem comparecer ao trabalho e não apresentar justificativa (atestado médico etc.), essas faltas serão contabilizadas em seus dias de folgas. As folgas durante o período de contratação até um ano de empresa, o colaborador terá direito a 4 folgas a cada 90 dias; após um ano de empresa, o colaborador terá direito a 3 folgas e férias anual.`, `${companyAddress}, ${date}`, `_________________________________________________\n${companyName}`, `_________________________________________________\n${name} — CPF: ${cpf}`,
    ]
    case 'desconto_folga': return [
      'TERMO DE FOLGA E ANUÊNCIA DE DESCONTO', `Eu, ${name}, tenho ciência de que a empresa contratante concede, por mera liberalidade, o direito a 05 (cinco) dias de folgas consecutivas a cada 60 (sessenta) dias de trabalho e 10 (dez) dias de folgas consecutivas a cada 90 (noventa) dias de trabalho, sem prejuízo dos DSRs devidos.`, 'Estou ciente de que essas folgas serão contabilizadas a partir do momento da saída da obra para minha cidade. Manifesto anuência referente à perda do direito às folgas concedidas por mera liberalidade pela empresa a partir de 03 (três) faltas injustificadas no período de 60 dias e 05 (cinco) faltas injustificadas no período de 90 dias.', 'Firmo o presente por ser expressão de verdade e para que produza os efeitos legais necessários.', `${companyAddress}, ${date}`, `${name}\nCPF: ${cpf}\nAssinatura: __________________________________________`,
    ]
    case 'conta_salario': return [
      'TERMO DE CIÊNCIA E CONCORDÂNCIA', `Eu ${name}, CPF ${cpf}, declaro que concordo com os termos quanto à conta destinada a pagamento de salário, abrangendo que em caso de utilização inadequada será de minha total responsabilidade e que não poderá ser feita a troca da conta que recebo meus pagamentos. A conta salário foi aberta no ${company.salary_bank_name} logo após a minha admissão. Portanto, concordo com os termos da empresa ${companyName}, pessoa jurídica inscrita no CNPJ ${company.cnpj || 'CNPJ não informado'}, em manter a conta salário para tal finalidade.`, `${companyAddress}, ${date}`, `${name}\nAssinatura: __________________________________________`,
    ]
    case 'reembolso': return [
      'TERMO DE CIÊNCIA E CONCORDÂNCIA', `Eu, ${name}, inscrito no CPF ${cpf}, função ${job}, declaro ter recebido da empresa ${companyName}, inscrita no CNPJ ${company.cnpj || 'CNPJ não informado'}, situada na ${companyAddress}, a informação de que quaisquer reembolsos de despesas devidas pela empresa ao empregado, referentes a ajudas de custo, terão como valores R$ ${money(company.reimbursement_dinner)} para janta, R$ ${money(company.reimbursement_lunch)} para almoço e R$ ${money(company.reimbursement_breakfast)} para café da manhã. Reembolsos de passagens somente serão efetivados após a comprovação documental da despesa correspondente, notadamente a apresentação de Nota Fiscal ou recibos emitidos constando o CNPJ e o nome da empresa ${companyName}.`, `${companyAddress}, ${date}`, `${name}\nAssinatura: __________________________________________`,
    ]
    case 'ciencia_alojamento': return [
      'TERMO DE CIÊNCIA E CONCORDÂNCIA', `Eu, ${name}, inscrito no CPF ${cpf}, função ${job}, declaro ter recebido orientação da empresa ${companyName}, inscrita no CNPJ ${company.cnpj || 'CNPJ não informado'}, situada na ${companyAddress}, sobre danos causados no interior do alojamento, tais como mesa, cadeira, ventilador, chuveiro elétrico, extintor de incêndio, cama, porta, janelas, armário, torneira, geladeira, televisão e tanquinho.`, 'Desse modo, autorizo o desconto dos respectivos valores diretamente de meu salário, para fins de pagamento dos danos de minha responsabilidade. Firmo o presente por ser expressão de verdade e para que produza os efeitos legais necessários.', `${companyAddress}, ${date}`, `${name}\nCPF: ${cpf}\nAssinatura: __________________________________________`,
    ]
    default: return []
  }
}

function makePdf(key, employee, company, issueDate, { preview = false } = {}) {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'A4', margin: 54, bufferPages: true })
    const chunks = []
    pdf.on('data', (chunk) => chunks.push(chunk))
    pdf.on('error', reject)
    pdf.on('end', () => resolve(Buffer.concat(chunks)))
    const template = admissionDocuments.find((item) => item.key === key)
    const logoMatch = String(company.admission_logo_data_url || '').match(/^data:image\/(png|jpeg);base64,(.+)$/)
    let titleY = 54
    if (logoMatch) {
      try { pdf.image(Buffer.from(logoMatch[2], 'base64'), 54, 35, { fit: [70, 45] }); titleY = 92 } catch (_error) { /* Ignore a damaged optional logo and still generate the document. */ }
    }
    if (preview) pdf.font('Helvetica-Bold').fontSize(8).fillColor('#6d8793').text('PRÉVIA DE MODELO — DADOS FICTÍCIOS', 54, 22, { align: 'center', width: 487 })
    const lines = textFor(key, employee, company, fullDate(issueDate))
    const title = lines.shift() || template.label
    pdf.font('Helvetica-Bold').fontSize(16).fillColor('#183d5b').text(title, 54, titleY, { align: 'center', width: 487 })
    pdf.moveDown(1.3)
    for (const line of lines) {
      const heading = /^(Cláusula|Parágrafo|\d+\.|[A-ZÁÉÍÓÚÃÕÇ0-9\s–-]{10,}:)/.test(line)
      pdf.font(heading ? 'Helvetica-Bold' : 'Helvetica').fontSize(10.5).fillColor('#1c2730').text(line, { align: 'justify', lineGap: 3, paragraphGap: 7 })
      pdf.moveDown(0.3)
    }
    if (key === 'ficha_epi') {
      pdf.addPage()
      pdf.font('Helvetica-Bold').fontSize(12).fillColor('#183d5b').text('FICHA DE CONTROLE INDIVIDUAL DE EPI', { align: 'center' })
      pdf.moveDown()
      pdf.font('Helvetica').fontSize(9).fillColor('#1c2730')
      pdf.text(`Nome: ${employee.name}     Função: ${employee.job_title || ''}     Setor: ${employee.department || 'CANTEIRO DE MONTAGEM'}     Registro: ${employee.registration_number}`)
      pdf.moveDown()
      const rows = [['Descrição do material', 'C.A.', 'Quant.', 'Entrega'], ['BOTA DE SEGURANÇA COM BIQUEIRA', '48413', '01'], ['CINTO DE SEGURANÇA TIPO PARAQUEDISTA, TRAVA QUEDAS E TALABARTE', '37977', '01'], ['LUVA PARA PROTEÇÃO CONTRA AGENTES TÉRMICOS E MECÂNICOS', '49283', '01'], ['LUVA ANTI CORTE IMPERMEÁVEL', '49945', '01'], ['CAPACETE COM FITA JUGULAR', '31469', '01'], ['ÓCULOS DE SEGURANÇA COM LENTE ESCURA', '51293', '01'], ['TOUCA ÁRABE', '30219', '01'], ['PROTETOR AUDITIVO NRSSF 13dB', '35981', '01'], ['AVENTAL DE RASPA DE COURO', '48075', '01'], ['MANGOTE DE RASPA', '49079', '01'], ['MÁSCARA PFF2', '45021', '01'], ['MÁSCARA DE SOLDA', '47303', '01'], ['CALÇA', 'N/A', '02'], ['CAMISA', 'N/A', '02']]
      const col = [230, 45, 45, 100]
      for (const row of rows) {
        const y = pdf.y
        const isHeader = row[0] === 'Descrição do material'
        const descHeight = pdf.heightOfString(row[0], { width: col[0] - 8, fontSize: isHeader ? 9 : 8.2, lineGap: 1 })
        const height = Math.max(25, descHeight + 9)
        pdf.rect(54, y, col.reduce((a, b) => a + b, 0), height).lineWidth(0.4).strokeColor('#8b9ba5').stroke()
        let x = 54
        for (let i = 0; i < col.length; i += 1) {
          if (i > 0) pdf.moveTo(x, y).lineTo(x, y + height).stroke()
          const cellText = i === 3 && !isHeader && row[1] ? fullDate(issueDate) : row[i] || ''
          pdf.font(isHeader || !row[1] ? 'Helvetica-Bold' : 'Helvetica').fontSize(isHeader ? 9 : 8.2).fillColor('#1c2730').text(cellText, x + 4, y + 5, { width: col[i] - 8, height: height - 8, ellipsis: true, align: i ? 'center' : 'left' })
          x += col[i]
        }
        pdf.y = y + height
      }
    }
    pdf.end()
  })
}

module.exports = { admissionDocuments, admissionDocumentKeys, makePdf, companyLocation, employeeLocation }
