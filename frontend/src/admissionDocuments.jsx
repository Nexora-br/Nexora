import { useEffect, useRef, useState } from 'react'
import { Eye, X } from 'lucide-react'
import { API_URL } from './apiConfig'

export const admissionDocuments = [
  ['termo_aditivo', '1 Termo aditivo'], ['ficha_epi', '2 Ficha de controle de EPI'], ['termo_lgpd', '2 Termo LGPD'],
  ['atualizacao_endereco', '3 Termo de atualização de endereço'], ['ordem_servico', '4 Ordem de serviço'],
  ['responsabilidade_epi', '6 Termo de responsabilidade de EPI'], ['ciencia_codigo_etica', '7 Ciência e concordância do código de ética'],
  ['itens_pessoais', '8 Termo de itens pessoais'], ['termo_folga', '9 Termo de folga'], ['desconto_folga', '10 Termo de folga e anuência de desconto'],
  ['conta_salario', '11 Termo de conta salário'], ['reembolso', '12 Termo de reembolso'], ['ciencia_alojamento', '13 Ciência e concordância sobre alojamento'],
]

export function AdmissionDocumentChoices({ selected = [], name, disabled = false, availableKeys = null }) {
  const choices = availableKeys ? admissionDocuments.filter(([key]) => availableKeys.includes(key)) : admissionDocuments
  const [preview, setPreview] = useState(null)
  const previewUrl = useRef(null)
  useEffect(() => () => { if (previewUrl.current) URL.revokeObjectURL(previewUrl.current) }, [])

  async function openPreview(key, label) {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current)
    previewUrl.current = null
    setPreview({ key, label, loading: true, error: '', url: '' })
    try {
      const response = await fetch(`${API_URL}/admission-documents/${encodeURIComponent(key)}/preview`)
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.error || 'Não foi possível carregar a prévia.')
      }
      const url = URL.createObjectURL(await response.blob())
      previewUrl.current = url
      setPreview({ key, label, loading: false, error: '', url })
    } catch (error) {
      setPreview({ key, label, loading: false, error: error.message || 'Não foi possível carregar a prévia.', url: '' })
    }
  }

  function closePreview() {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current)
    previewUrl.current = null
    setPreview(null)
  }

  return <>
    <div className="admission-document-options">{choices.map(([key, label]) => <div key={key} className="admission-document-choice"><label className="check-label"><input type="checkbox" name={name} value={key} defaultChecked={selected.includes(key)} disabled={disabled} /><span>{label}</span></label><button type="button" className="admission-preview-button" onClick={() => void openPreview(key, label)} disabled={Boolean(preview?.loading)}><Eye size={14} /> Visualizar</button></div>)}</div>
    {preview && <div className="modal-layer admission-preview-layer" onClick={closePreview}><section className="modal-card admission-preview-modal" role="dialog" aria-modal="true" aria-labelledby="admission-preview-title" onClick={(event) => event.stopPropagation()}><button type="button" className="modal-x" aria-label="Fechar prévia" onClick={closePreview}><X size={18} /></button><span className="section-kicker">PRÉVIA DO DOCUMENTO</span><h2 id="admission-preview-title">{preview.label}</h2><p>Exemplo preenchido com dados fictícios; os dados reais são aplicados na admissão.</p>{preview.loading ? <div className="admission-preview-state">Carregando prévia...</div> : preview.error ? <div className="form-error" role="alert">{preview.error}</div> : <iframe title={`Prévia: ${preview.label}`} src={preview.url} />}</section></div>}
  </>
}

export function fileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Não foi possível ler a logo.'))
    reader.readAsDataURL(file)
  })
}
