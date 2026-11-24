-- Deshace qa-149-documentos-de-firma.sql: la 149 vuelve a firmar por el camino viejo.
DELETE FROM lender_signing_documents WHERE lender_id = 149;
UPDATE lenders SET pdf_mapper_project_slug = NULL WHERE id = 149;
