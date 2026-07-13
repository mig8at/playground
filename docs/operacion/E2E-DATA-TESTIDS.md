# data-testid del e2e — dónde van + cómo aplicarlos localmente

Los specs de `frontend-e2e` prefieren `getByTestId(...)` con fallback a `getByRole/text`. Casi ninguno de
esos testids existe en el frontend (ni en main ni en develop, salvo employment/expedition). Este doc
registra **dónde debe ir cada uno** y cómo **aplicarlos de forma LOCAL** (sin commitear ni pushear) en una
rama que no los tenga (p.ej. main), para poder correr el e2e.

## Mecanismo local (no se commitea)

Los testids viven como un **patch** en `frontend-e2e/patches/e2e-testids.patch` (en playground, no en el
monorepo). Para testear:

```bash
bin/testids on     # git apply del patch sobre frontend-monorepo (agrega los data-testid al working tree)
bin/testids off    # git apply -R (los quita) — deja el monorepo limpio
bin/testids status # ¿están aplicados?
```

Como es un patch sobre el working tree, **nunca se commitea ni pushea**. Si el componente cambió y el patch
no aplica limpio, este doc dice exactamente dónde agregar el atributo a mano (y luego `bin/testids regen`
re-genera el patch desde el working tree).

## Mapa (rama main) — testid → archivo → elemento

Rutas relativas a `frontend-monorepo/`. Los primitivos `Input`/`Button`/`SelectTrigger`/`SelectItem`/
`MoneyInput` hacen spread de `{...props}` → un `data-testid` pasado como prop llega al DOM real.

### Monto — `loan-application-form/src/components/amount-form.tsx`
- `amount-input` → el `<MoneyInput placeholder="Monto a solicitar" …>`.
- `amount-submit` → el `<Button type="submit">` ("Iniciar solicitud").

### Teléfono — `loan-application-form/src/components/phone-number-step-form.tsx`
- `phone-input` → el `<Input type="tel" …>`.
- `phone-submit` → el `<Button type="submit">` ("Continuar").

### OTP — `packages/shared/components/src/components/otp.tsx` (compartido)
- `otp-input` → el `<InputOTP …>`. ⚠ verificar que `InputOTP` (packages/ui) forwardee `data-testid` a un nodo
  focuseable (el e2e hace `.click()` + `keyboard.type`); si no, ponerlo en el contenedor de slots.
- `otp-submit` → el `<Button type="submit">` ("Confirmar").

### Personal info — `loan-application-form/src/components/forms/personal-info-form.tsx`
- `personal-info-form` → el `<div className={`space-y-6 ${className}`}>` externo (ojo: misma cadena existe en
  employment-info-form.tsx — scopear el edit por archivo).
- `docnum-input` → el `<Input pattern="^\d+$" placeholder="1234567890" …>` (número de documento).
- `identification-submit` → el `<Button type="button">` dentro de `PersonalInfoSubmitButton`.

### Selectores de fecha — `packages/ui/src/components/date-selector.tsx` (compartido)
El e2e (`pkg/wizard-steps.ts::fillExpeditionDate`) los usa en el paso de **fecha de expedición** (mismo
primitivo `DateSelector` que la fecha de nacimiento → taggear el primitivo cubre ambos).
- `date-selector-day` → `<SelectTrigger aria-invalid={dayInvalid…}>`; opciones: `date-selector-day-option-${day}`.
- `date-selector-month` → `<SelectTrigger aria-invalid={monthInvalid…}>`; opciones: `date-selector-month-option-${month.value}` (usar `month.value` numérico, NO `title`).
- `date-selector-year` → `<SelectTrigger aria-invalid={yearInvalid…}>`; opciones: `date-selector-year-option-${year}`.

### Empleo — `loan-application-form/src/components/forms/employment-info-form.tsx`
- `employment-info-form` → el `<div className={`space-y-6 ${className}`}>` externo.
- `employment-status-trigger` → el `<SelectTrigger className="w-full" size="xl">`.
- `employment-status-option-${option.value}` → los `<SelectItem>` (valores: `Empleado|Independiente|Pensionado|Desempleado`).
- `monthly-income-input` → el `<MoneyInput placeholder="Ingresos mensuales" …>`.
- `employment-submit` → el `<Button type="submit">`.

### Fecha de expedición — `loan-application-form/src/components/document-expedition-date.tsx`
- `expedition-date-submit` → el `<Button type="submit" loading={isSubmitting}>` ("Continuar"), NO el "No corresponde".

### Lender card — `lenders-marketplace/src/components/lender-card/LenderCard.tsx`
- `lender-toggle-${lenderData.id}` → el `<button type="button" onClick={onToggleExpanded}>` del `CollapsibleLenderCard` (el id es el numérico de la tabla `lenders`).

## Notas
- `otp-input` es el único target con duda (forwarding de `InputOTP`) — verificar el primitivo.
- `date-selector-*` y `otp.tsx` son **componentes compartidos** (packages/*): el `data-testid` es inocuo, pero
  aparece en todas sus instancias.
- En el flujo **asesor** el e2e solo usa amount/phone/otp (el KYC personal/empleo/fecha se INYECTA por DB con
  synthFill, no por UI), + `lender-toggle` en la selección. El resto sirve para el flujo manual completo.
