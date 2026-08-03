-- Nova origem de presença: o próprio aluno confirmando pelo app.
--
-- Arquivo separado de propósito: ALTER TYPE ... ADD VALUE não permite usar o
-- valor novo na mesma transação. A migração seguinte (self_checkins) já pode
-- referenciá-lo.

alter type attendance_source add value if not exists 'self';
