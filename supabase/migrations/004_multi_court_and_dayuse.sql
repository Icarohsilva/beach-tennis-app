-- 004_multi_court_and_dayuse.sql

-- 1. Quadra nas turmas (padrão = 1)
ALTER TABLE classes ADD COLUMN IF NOT EXISTS court int NOT NULL DEFAULT 1;

-- 2. Slots de day use
CREATE TABLE IF NOT EXISTS dayuse_slots (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  court      int NOT NULL DEFAULT 1,
  date       date NOT NULL,
  start_time time NOT NULL,
  end_time   time NOT NULL,
  capacity   int NOT NULL DEFAULT 8,
  notes      text,
  is_active  boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Bookings de day use (sem crédito)
CREATE TABLE IF NOT EXISTS dayuse_bookings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id      uuid NOT NULL REFERENCES dayuse_slots(id) ON DELETE CASCADE,
  student_id   uuid NOT NULL REFERENCES profiles(id),
  status       text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  booked_at    timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS dayuse_bookings_unique_confirmed
  ON dayuse_bookings(slot_id, student_id)
  WHERE status = 'confirmed';

-- RLS
ALTER TABLE dayuse_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE dayuse_bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dayuse_slots_select_active" ON dayuse_slots FOR SELECT USING (is_active = true);
CREATE POLICY "dayuse_slots_admin_all" ON dayuse_slots FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "dayuse_bookings_select" ON dayuse_bookings FOR SELECT USING (
  student_id = auth.uid() OR
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "dayuse_bookings_insert_own" ON dayuse_bookings FOR INSERT WITH CHECK (student_id = auth.uid());
CREATE POLICY "dayuse_bookings_update_own" ON dayuse_bookings FOR UPDATE USING (student_id = auth.uid());
CREATE POLICY "dayuse_bookings_admin_all" ON dayuse_bookings FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
