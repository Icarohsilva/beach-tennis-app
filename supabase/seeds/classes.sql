-- Seed: Grade de Aulas
-- Baseado na planilha fornecida pelo usuário
-- day_of_week: 0=Dom, 1=Seg, 2=Ter, 3=Qua, 4=Qui, 5=Sex, 6=Sáb
-- level: definir depois conforme o professor configurar (padrão iniciante)
-- court: 1 = quadra principal, 2 = quadra cima

INSERT INTO classes (name, level, type, day_of_week, start_time, end_time, max_students, court, is_active) VALUES
  -- TERÇA
  ('Terça 18h',       'iniciante', 'adult', 2, '18:00', '19:00', 8, 1, true),
  ('Terça 19h',       'iniciante', 'adult', 2, '19:00', '20:00', 8, 1, true),

  -- QUARTA
  ('Quarta 18h',      'iniciante', 'adult', 3, '18:00', '19:00', 8, 1, true),
  ('Quarta 19h',      'iniciante', 'adult', 3, '19:00', '20:00', 8, 1, true),

  -- QUINTA (court 1)
  ('Quinta 17h',      'iniciante', 'adult', 4, '17:00', '18:00', 8, 1, true),
  ('Quinta 18h',      'iniciante', 'adult', 4, '18:00', '19:00', 8, 1, true),
  ('Quinta 19h',      'iniciante', 'adult', 4, '19:00', '20:00', 8, 1, true),
  ('Quinta 20h',      'iniciante', 'adult', 4, '20:00', '21:00', 8, 1, true),

  -- QUINTA (Quadra cima = court 2)
  ('Quinta 19h Q2',   'iniciante', 'adult', 4, '19:00', '20:00', 8, 2, true),

  -- SEXTA
  ('Sexta 18h',       'iniciante', 'adult', 5, '18:00', '19:00', 8, 1, true),
  ('Sexta 19h',       'iniciante', 'adult', 5, '19:00', '20:00', 8, 1, true),

  -- SÁBADO
  ('Sábado 7h',       'iniciante', 'adult', 6, '07:00', '08:00', 8, 1, true),
  ('Sábado 8h',       'iniciante', 'adult', 6, '08:00', '09:00', 8, 1, true),
  ('Sábado 9h',       'iniciante', 'adult', 6, '09:00', '10:00', 8, 1, true),
  ('Sábado 10h',      'iniciante', 'adult', 6, '10:00', '11:00', 8, 1, true),
  ('Sábado 11h Kids', 'iniciante', 'kids',  6, '11:00', '12:00', 8, 1, true)
ON CONFLICT DO NOTHING;
