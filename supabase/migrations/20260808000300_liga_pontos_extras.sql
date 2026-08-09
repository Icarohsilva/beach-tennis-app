-- Liga: pontuações extras por comportamento que ajuda a academia.
--
-- Até aqui a Liga só premiava aparecer, competir e ser elogiado. Estas seis fontes
-- premiam o que a academia precisa que o aluno faça e que hoje ela pede na base do
-- pedido: confirmar presença sozinho, cancelar a tempo (que é o que libera a vaga),
-- pegar vaga da fila, agendar com antecedência, completar o cadastro e usar o day use.
--
-- Cada uma nasce com peso configurável e pode ser zerada em Configurações — peso zero
-- desliga a fonte sem precisar de flag própria.

alter table liga_points drop constraint if exists liga_points_reason_check;

alter table liga_points add constraint liga_points_reason_check check (reason in (
  'attendance', 'streak', 'tournament_entry', 'tournament_result',
  'manual', 'kudos_given', 'kudos_received',
  -- Fontes novas:
  'self_checkin',      -- confirmou a própria presença pelo app
  'cancel_in_time',    -- cancelou dentro da janela e liberou a vaga
  'waitlist_accept',   -- pegou vaga que abriu na fila de espera
  'early_booking',     -- agendou com antecedência
  'profile_complete',  -- completou perfil e ficha médica (uma vez)
  'dayuse'             -- reservou quadra avulsa
));

comment on constraint liga_points_reason_check on liga_points is
  'Fontes de ponto da Liga. Peso de cada uma em system_settings (liga_points_*).';
