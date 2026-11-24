-- Los documentos de firma de Finandina (149) en la base LOCAL (2026-11-24): el formulario de vinculación y los T&C
-- salen del pdf-mapper, proyecto `finandina` (las plantillas del PDF Mapper Studio, en el pdf-mapper-service de la
-- máquina, :8080). El pagaré sigue por su camino de siempre.
--
-- El backend local apunta al mock del pdf-mapper (:8100), que reenvía al servicio real lo que éste tenga (proyecto
-- `finandina`), así que el resto de las entidades sigue con sus PDF de demo.
-- ⚠ `template` TIENE que estar, aunque el pdf-mapper no la use (genera por el tipo de documento): la vista previa y la
-- firma sólo usan el generador del catálogo si la fila tiene plantilla; sin ella van al servicio viejo, que no conoce
-- «vinculacion» y no devuelve nada (PromissoryNoteController::buildCatalogPreview). Pasó el 2026-11-24.
-- Se puede correr de nuevo: borra lo suyo antes.
UPDATE lenders SET pdf_mapper_project_slug = 'finandina' WHERE id = 149;
DELETE FROM lender_signing_documents WHERE lender_id = 149;
INSERT INTO lender_signing_documents (lender_id, requires_cosigner, signer_role, document_type, signed_by_applicant, signed_by_cosigner, title, template, generator, signature_type, sort, is_required, status, created_at, updated_at) VALUES
  (149, 0, 'applicant', 'vinculacion', 1, 0, 'Formulario de vinculación', 'finandina.vinculacion', 'microservice', 'otp', 1, 1, 1, NOW(), NOW()),
  (149, 0, 'applicant', 'terminos-y-condiciones', 1, 0, 'Términos y condiciones', 'finandina.terminos-y-condiciones', 'microservice', 'otp', 2, 1, 1, NOW(), NOW()),
  (149, 0, 'applicant', 'promissory_note', 1, 0, 'Pagaré y carta de instrucciones', NULL, NULL, 'otp', 3, 1, 1, NOW(), NOW());
