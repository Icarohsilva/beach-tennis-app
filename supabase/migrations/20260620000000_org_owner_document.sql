-- 20260620000000_org_owner_document.sql
-- Documento (CPF/CNPJ) do dono da academia + unicidade (1 documento = 1 academia).
-- Guarda só dígitos. Índice único parcial: academias antigas (NULL) não conflitam.

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS owner_document text;

CREATE UNIQUE INDEX IF NOT EXISTS organizations_owner_document_key
  ON organizations (owner_document)
  WHERE owner_document IS NOT NULL;
