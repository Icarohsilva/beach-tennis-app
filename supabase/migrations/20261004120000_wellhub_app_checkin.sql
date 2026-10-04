-- supabase/migrations/20261004120000_wellhub_app_checkin.sql
-- Check-in Wellhub pelo APP, com o print do Wellhub como comprovante.
--
-- Para a arena que ainda não ligou a integração com o Wellhub (org_integrations),
-- o check-in do aluno não chegava ao sistema: ele bipava no app do Wellhub, mas
-- aqui a aula ficava sem presença e a falta virava pendência de check-in. Com a
-- chave ligada (system_settings `wellhub_app_checkin_enabled`), o aluno do plano
-- Wellhub registra o check-in do dia pelo app e anexa o print.
--
-- O registro vai para a MESMA tabela `checkins`, pelo mesmo núcleo do webhook
-- (lib/checkin/ingest.ts → recordResolvedCheckin): marca presença na aula
-- reservada, dá baixa em pendência e conta na meta do mês. `validation = 'app'`
-- diz de onde veio; `receipt_url` guarda o caminho do print.
--
-- Com a integração conectada a chave fica sem efeito: o check-in já chega
-- sozinho, e um segundo caminho só duplicaria o registro do mesmo dia.
alter table checkins
  add column if not exists receipt_url text,
  -- Leitura automática do print por OCR no servidor (lib/checkin/receiptReader.ts,
  -- Tesseract, sem custo) + regras (receiptCheck.ts):
  -- 'validated' passou em todas as regras; 'review' entrou, mas pede o olho do
  -- admin (nome da academia não bate, ou a leitura não estava disponível).
  -- Print reprovado não vira check-in, então não há status de recusa aqui.
  add column if not exists receipt_status text,
  -- Data e hora lidas NO print (não a do envio): é a régua de "não pode ser
  -- anterior ao último comprovante".
  add column if not exists receipt_taken_at timestamptz,
  add column if not exists receipt_note text,
  -- Hash do arquivo: o mesmo print reenviado (por este ou outro aluno) é
  -- recusado na hora, sem depender da leitura.
  add column if not exists receipt_sha256 text;

alter table checkins drop constraint if exists checkins_receipt_status_check;
alter table checkins add constraint checkins_receipt_status_check
  check (receipt_status is null or receipt_status in ('validated', 'review'));

create unique index if not exists checkins_receipt_sha_idx
  on checkins (organization_id, receipt_sha256) where receipt_sha256 is not null;

comment on column checkins.receipt_url is
  'Print do check-in no app do parceiro (bucket privado checkin-receipts). Só no check-in feito pelo aluno no app (validation = app).';

comment on column checkins.validation is
  'Origem: manual (admin), wellhub/totalpass (webhook do parceiro) ou app (aluno pelo app, com print em receipt_url).';

-- Bucket PRIVADO, como payment-receipts: o print mostra o app do aluno. O upload
-- é feito pela server action com service role, então não há policy de insert
-- para `authenticated`; a leitura do admin é por URL assinada.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'checkin-receipts',
  'checkin-receipts',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;
