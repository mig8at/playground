-- Los documentos de firma de Finandina (149) en QA (base compartida dev/qa/staging), 2026-11-24. Igual que en local
-- (finandina-local-documentos.sql): vinculación y T&C por pdf-mapper (proyecto `finandina`, plantillas subidas al
-- pdf-mapper-service del cluster de desarrollo) y el pagaré por su camino de siempre.
-- Antes: pdf_mapper_project_slug NULL y ninguna fila; la 149 firmaba por el camino viejo (autorización, pagaré, plan de
-- pagos y garantía). Para volver a eso: qa-149-documentos-de-firma-undo.sql.
UPDATE lenders SET pdf_mapper_project_slug = 'finandina' WHERE id = 149;
INSERT INTO lender_signing_documents (lender_id, requires_cosigner, signer_role, document_type, signed_by_applicant, signed_by_cosigner, title, template, generator, signature_type, sort, is_required, status, created_at, updated_at) VALUES
  (149, 0, 'applicant', 'vinculacion', 1, 0, 'Formulario de vinculación', 'finandina.vinculacion', 'microservice', 'otp', 1, 1, 1, NOW(), NOW()),
  (149, 0, 'applicant', 'terminos-y-condiciones', 1, 0, 'Términos y condiciones', 'finandina.terminos-y-condiciones', 'microservice', 'otp', 2, 1, 1, NOW(), NOW()),
  (149, 0, 'applicant', 'promissory_note', 1, 0, 'Pagaré y carta de instrucciones', NULL, NULL, 'otp', 3, 1, 1, NOW(), NOW());
