import './CheckoutSuccessPage.css'
import { LegalLinks } from './LegalPages.jsx'

export function CheckoutSuccessPage() {
  function returnToNexora() {
    window.history.replaceState(null, '', window.location.pathname)
    window.location.reload()
  }

  return (
    <main className="checkout-success-page" id="main-content" tabIndex="-1">
      <section className="checkout-success-card" aria-labelledby="checkout-success-title">
        <span className="checkout-success-check" aria-hidden="true">✓</span>
        <p className="checkout-success-kicker">NEXORA PRO</p>
        <h1 id="checkout-success-title">Obrigado pela sua assinatura!</h1>
        <p>
          Agradecemos por escolher a Nexora. Estamos confirmando seu pagamento e sua assinatura
          será ativada em instantes. Se tiver dúvidas, fale com nossa equipe pelo e-mail{' '}
          <a href="mailto:nexoraatendimentosuporte@gmail.com">nexoraatendimentosuporte@gmail.com</a>.
        </p>
        <button type="button" className="checkout-success-button" onClick={returnToNexora}>
          Voltar ao Nexora
        </button>
      </section>
      <LegalLinks className="checkout-success-legal-links" />
    </main>
  )
}
