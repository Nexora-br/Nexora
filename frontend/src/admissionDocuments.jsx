export const admissionDocuments = [
  ['termo_aditivo', '1 Termo aditivo'], ['ficha_epi', '2 Ficha de controle de EPI'], ['termo_lgpd', '2 Termo LGPD'],
  ['atualizacao_endereco', '3 Termo de atualização de endereço'], ['ordem_servico', '4 Ordem de serviço'],
  ['responsabilidade_epi', '6 Termo de responsabilidade de EPI'], ['ciencia_codigo_etica', '7 Ciência e concordância do código de ética'],
  ['itens_pessoais', '8 Termo de itens pessoais'], ['termo_folga', '9 Termo de folga'], ['desconto_folga', '10 Termo de folga e anuência de desconto'],
  ['conta_salario', '11 Termo de conta salário'], ['reembolso', '12 Termo de reembolso'], ['ciencia_alojamento', '13 Ciência e concordância sobre alojamento'],
]

export function AdmissionDocumentChoices({ selected = [], name, disabled = false, availableKeys = null }) {
  const choices = availableKeys ? admissionDocuments.filter(([key]) => availableKeys.includes(key)) : admissionDocuments
  return <div className="admission-document-options">{choices.map(([key, label]) => <label key={key} className="check-label"><input type="checkbox" name={name} value={key} defaultChecked={selected.includes(key)} disabled={disabled} />{label}</label>)}</div>
}

export function fileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Não foi possível ler a logo.'))
    reader.readAsDataURL(file)
  })
}
