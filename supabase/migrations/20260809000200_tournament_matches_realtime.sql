-- Placar ao vivo: publica tournament_matches no Realtime.
--
-- Sem estar na publicação `supabase_realtime` o canal do cliente conecta, o
-- `subscribe()` responde SUBSCRIBED e NENHUM evento chega — falha silenciosa
-- que parece "ninguém lançou placar ainda". Por isso vai em migração, e não
-- num clique no painel: ambiente novo já sobe funcionando.
--
-- A entrega continua passando pela RLS de cada assinante. A policy
-- `matches_select_org` (20260621000200) libera a leitura para quem é da
-- academia, que é exatamente quem deve ver o placar mudar.
do $$
begin
  alter publication supabase_realtime add table tournament_matches;
exception
  -- Já publicada (painel do Supabase ou execução anterior): nada a fazer.
  when duplicate_object then null;
  -- Projeto sem a publicação padrão: o Realtime não está em uso ali e o resto
  -- da migração não pode falhar por causa disso.
  when undefined_object then null;
end $$;
