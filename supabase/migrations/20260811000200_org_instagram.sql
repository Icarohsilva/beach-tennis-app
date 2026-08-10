-- Instagram da arena na página pública.
--
-- A página /arenas/[slug] é o link que a academia põe na bio do Instagram; sem o
-- caminho de volta, quem chega pelo compartilhamento de um aluno não encontra o
-- perfil onde a arena posta de verdade.
--
-- Guardamos só o @ (sem URL): a action normaliza, e assim a página monta o link
-- sozinha sem depender de a arena ter colado "https://" na mão.
alter table organizations add column if not exists instagram text;
