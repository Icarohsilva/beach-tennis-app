-- Marca quando o professor iniciou a aula.
--
-- Presença e falta passam a ser editáveis SÓ depois de iniciar a aula: antes
-- disso a chamada é só leitura (quem já tem check-in aparece, mas nada é
-- gravado). Sem esta coluna o "iniciou" vivia apenas no estado do componente e
-- se perdia a cada refresh, então a trava não teria como valer de verdade.
--
-- Ao iniciar, quem já tem check-in do dia (parceiro ou confirmação validada
-- pelo app) recebe presença automaticamente — ver startClass em
-- features/aulas/adminActions.ts.

alter table class_sessions add column if not exists started_at timestamptz;

comment on column class_sessions.started_at is
  'Quando o professor iniciou a aula. Null = ainda não iniciada; a chamada fica só leitura.';
