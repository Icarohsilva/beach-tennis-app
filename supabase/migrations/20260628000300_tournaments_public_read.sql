-- Torneios não-rascunho são visíveis publicamente (página /t/[id]).
-- A página atual usa createAdminClient() mas a policy evita lock-in.
CREATE POLICY IF NOT EXISTS "tournaments_public_read" ON tournaments
  FOR SELECT TO anon, authenticated
  USING (status IN ('open', 'in_progress', 'finished'));

-- Inscrições de torneios públicos também são visíveis.
CREATE POLICY IF NOT EXISTS "tournament_entries_public_read" ON tournament_entries
  FOR SELECT TO anon, authenticated
  USING (
    tournament_id IN (
      SELECT id FROM tournaments WHERE status IN ('open', 'in_progress', 'finished')
    )
  );
