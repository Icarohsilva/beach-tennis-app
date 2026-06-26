-- Dependentes são pessoas SEM login próprio (geridas pelo responsável/admin). A tabela
-- profiles guarda a identidade de qualquer pessoa — com ou sem auth user. A FK herdada
-- do modelo single-tenant (profiles.id -> auth.users, on delete cascade) exigia uma linha
-- em auth.users para todo perfil, então criar o perfil de um dependente (UUID novo, sem
-- usuário de autenticação) falhava com 23503 ("violates foreign key constraint
-- profiles_id_fkey"). Isso quebrava "Criar dependente" tanto pelo aluno (/perfil) quanto
-- pelo admin (ficha do aluno).
--
-- Soltar a FK permite perfis geridos sem auth user. profiles.id continua PK (uuid único).
-- memberships.user_id/parent_id referenciam profiles(id), não auth.users — logo, com o
-- perfil criado, o vínculo grava normalmente.
--
-- Trade-off: o cascade de deleção (auth.users -> profiles) deixa de existir. Aceitável:
-- deleção de auth user é rara; a limpeza de perfis órfãos pode ser feita à parte se preciso.

alter table profiles drop constraint if exists profiles_id_fkey;
