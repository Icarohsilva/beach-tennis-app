-- Remove class_sessions.started_at: a chamada deixa de exigir "Iniciar aula".
--
-- O admin já podia marcar presença/falta aluno a aluno em AttendanceSheet; o
-- botão "Iniciar Aula" só existia para travar essa marcação até alguém clicar,
-- e para calcular quem já tinha check-in no momento do clique. Essa segunda
-- parte é redundante hoje: tanto o webhook de parceiro (recordResolvedCheckin)
-- quanto a confirmação pelo app (applyPresence) já gravam presença em
-- `attendance` no instante em que acontecem, sem depender de o professor abrir
-- a chamada. Então a "presença automática ao iniciar" não fazia mais nada de
-- útil — apenas re-confirmava o que já estava gravado.
--
-- A coluna não tem nenhum outro leitor no código (auditado antes desta
-- migração) — dropar em vez de deixar morta.
alter table class_sessions drop column if exists started_at;

-- O status da aula deixa de virar 'completed' quando o professor confirma a
-- chamada (não existe mais essa etapa) e passa a ser automático por tempo: o
-- cron `complete-past-sessions` fecha toda sessão 'scheduled' cuja data já
-- passou. Nada aqui precisa de migração — é só o comentário registrando a
-- mudança de contrato para quem olhar o schema depois.
comment on column class_sessions.status is
  'scheduled -> completed é automático (cron complete-past-sessions, session_date < hoje), não mais um clique do professor. scheduled -> cancelled continua manual (setSessionCancelled).';
