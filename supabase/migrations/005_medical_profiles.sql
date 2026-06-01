-- 005_medical_profiles.sql

CREATE TABLE IF NOT EXISTS medical_profiles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      uuid UNIQUE NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  birth_date      date,
  blood_type      text CHECK (blood_type IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  emergency_name  text,
  emergency_phone text,
  health_notes    text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE medical_profiles ENABLE ROW LEVEL SECURITY;

-- Aluno lê e edita o próprio registro
CREATE POLICY "medical_own_select" ON medical_profiles FOR SELECT USING (profile_id = auth.uid());
CREATE POLICY "medical_own_insert" ON medical_profiles FOR INSERT WITH CHECK (profile_id = auth.uid());
CREATE POLICY "medical_own_update" ON medical_profiles FOR UPDATE USING (profile_id = auth.uid());

-- Admin lê tudo (para emergências na quadra)
CREATE POLICY "medical_admin_select" ON medical_profiles FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
