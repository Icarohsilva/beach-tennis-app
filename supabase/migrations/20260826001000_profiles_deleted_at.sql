-- supabase/migrations/20260826001000_profiles_deleted_at.sql
-- Exclusão PERMANENTE de aluno — marcador global, não por-academia.
--
-- `memberships.archived_at` já existe para "saiu desta academia" (aluno
-- multi-vínculo continua existindo nas outras). `profiles.deleted_at` é uma
-- coisa diferente: a IDENTIDADE (nome, telefone, gênero, e-mail/login) deixa
-- de existir em todo lugar, porque profiles é a tabela compartilhada entre
-- academias. Por isso mora aqui e não em memberships — e por isso a ação
-- (permanentlyDeleteStudent) exige archived_at já setado na academia que
-- pediu a exclusão antes de aceitar: duas academias diferentes não podem
-- decidir sozinhas apagar a identidade de alguém que ainda está ativo na
-- outra.
--
-- Nada é DELETE físico: attendance, credit_transactions, liga_points,
-- payments e tournament_entries apontam para profiles.id, e apagar a linha
-- quebraria (ou cascatearia sobre) esse histórico financeiro/operacional. O
-- que "exclusão permanente" faz de fato: profiles.full_name/phone/gender/
-- avatar_url/city viram anônimos, medical_profiles é apagada (dado sensível
-- sem razão de continuar existindo), e o usuário de auth (login) é removido
-- via admin.auth.admin.deleteUser — a pessoa só volta a acessar criando um
-- cadastro novo (id novo, sem religar ao histórico antigo), que é
-- exatamente o "só via um novo cadastro por link" pedido.
alter table profiles add column if not exists deleted_at timestamptz;

comment on column profiles.deleted_at is
  'Exclusão permanente (global, todas as academias): identidade anonimizada e login removido. Ver features/aulas/studentIdentityActions.ts.';
