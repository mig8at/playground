# Contacto con Shopify desde cero — 2026-11-13

## Mensaje para Partner Support (chat o caso desde el Partner Dashboard), en inglés

Sale desde la cuenta de Juan (juan@creditop.com, dueño de la cuenta Partner), con Miguel como contacto técnico.

> Hi, this is Creditop (Partner organization CREDITOP, Partner ID 4296643), writing from Juan Rodriguez's account
> (juan@creditop.com). Please also include Miguel Ochoa (miguel@creditop.com), our technical lead for this app, in all
> communications about this request. We are a Colombian credit
> (BNPL) provider building an offsite payments app ("Creditop"). In 2025 our team was approved as a Payments Partner and
> we signed the revenue share agreement in January 2026, but the contact we had at Payments Partnerships is no longer
> available and our last thread went unanswered.
>
> Our app now has a single offsite payments extension (payments.offsite.render) deployed and tested end to end on our
> development store, and its payments app status shows "Development". We'd like to:
> 1. Confirm our Payments Partner status and that the revenue share agreement is on file.
> 2. Know the current way to submit the payments app for review (we don't see a submit option under Distribution).
> 3. Get a direct contact at the Payments Partnerships team for questions about Colombia/COP, settlement and refunds
>    for a BNPL provider.
>
> Thank you!

---

# Correo a Shopify Payments Partnerships — borrador del 2026-11-13 (versión anterior, retomando el hilo)

Retoma el hilo «Creditop-Shopify Payment Partner Application» (último correo de Shopify: 2026-04-01).
Miguel no está en el hilo original: se manda REENVIANDO el correo de Manuela (2026-10-28), así va el historial citado.

- **Para:** paymentspartners@shopify.com
- **Cc:** maria@creditop.com, manuela@creditop.com, oscar@creditop.com
- **Asunto:** Re: Creditop-Shopify Payment Partner Application

Actualiza el borrador del 2026-11-03 (documento «Shopify: pendientes y mensajes»): ya no «vamos a desplegar», ahora
la versión con una sola extensión está desplegada y la app corre en nuestra infraestructura de producción con mTLS.

---

Hi Shopify Payments Partnerships team,

I'm Miguel Ochoa, engineer at Creditop. I'm picking up this thread from Maria Fernanda (in copy) and will be your
technical contact going forward.

Following up on your April 1st message: the app now has a single offsite payments extension
(payments.offsite.render), and we deployed a new app version with only that extension. The app is hosted on our own
infrastructure with mTLS verification on the payment and refund session endpoints, and we have completed end-to-end
test payments on our development store: payment session → redirect to Creditop → resolve, reject, and refund.

We would like to submit the app for review next. Before that, could you help us confirm a few things?

1. **Colombia and COP:** our merchants are in Colombia and sell in Colombian pesos (COP). Are there any restrictions
   for offsite payments apps in Colombia once the app is approved?
2. **Account status:** does our Payments Partner account (Partner ID 4296643) show the revenue share agreement as
   signed (January 21st, 2026)? Is anything else pending on our side before we submit the app for review?
3. **Credit (BNPL) provider:** each purchase is a loan from Creditop or a partner lender, so settlement depends on the
   lender's disbursement and may take longer than 5 days. Is that acceptable? For refunds, is it enough to accept the
   refund session and cancel or adjust the loan on our side?
4. **Review:** is the Partner Dashboard submission the right way to request the review, or should we notify you here
   as well?

Thank you,

Miguel Ochoa
Creditop
