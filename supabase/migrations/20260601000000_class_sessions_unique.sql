-- Add unique constraint to prevent duplicate sessions for the same class on the same date
-- Required for safe upsert in generateSessionsForExistingClass
ALTER TABLE class_sessions
  ADD CONSTRAINT class_sessions_class_id_session_date_key
  UNIQUE (class_id, session_date);
