// types/index.ts

export type UserRole = 'student' | 'admin' | 'super_admin'
export type OrganizationStatus = 'active' | 'suspended'
export type StudentLevel = 'A' | 'B' | 'C' | 'D' | 'iniciante'
export type PaymentType = 'subscriber' | 'per_class' | 'wellhub' | 'totalpass'
export type ClassType = 'kids' | 'adult'
export type BookingStatus = 'confirmed' | 'cancelled'
export type BookingType = 'extra' | 'makeup'
export type AttendanceStatus = 'present' | 'absent' | 'late'
export type AttendanceSource = 'manual' | 'wellhub' | 'totalpass'
export type CheckinPartner = 'wellhub' | 'totalpass'

export interface OrgIntegration {
  id: string
  organization_id: string
  partner: CheckinPartner
  gym_id: string
  webhook_secret: string
  status: 'connected' | 'disconnected'
  connected_at: string
  created_at: string
}

export interface PendingCheckin {
  id: string
  organization_id: string
  partner: CheckinPartner
  partner_member_id: string
  checkin_date: string
  external_ref: string | null
  payload: unknown
  resolved: boolean
  created_at: string
}

export type SessionStatus = 'scheduled' | 'completed' | 'cancelled'
export type SubscriptionStatus = 'active' | 'paused' | 'cancelled'
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded'
export type PaymentTransactionType = 'subscription' | 'per_class' | 'trial'
export type CreditTransactionType = 'renewed' | 'used' | 'refunded' | 'expired'
export type TournamentFormat = 'super8'
export type TournamentModality = 'dupla_fixa' | 'dupla_revezando'
export type TournamentStatus = 'draft' | 'open' | 'in_progress' | 'finished'
export type TrialStatus = 'pending' | 'attended' | 'no_show' | 'cancelled'

export interface Organization {
  id: string
  name: string
  slug: string
  invite_code: string
  logo_url: string | null
  brand_color: string | null
  description: string | null
  status: OrganizationStatus
  is_default: boolean
  owner_id: string | null
  owner_document: string | null
  is_listed: boolean
  state: string | null
  city: string | null
  neighborhood: string | null
  address_line: string | null
  sports: string[]
  whatsapp: string | null
  cep: string | null
  address_number: string | null
  no_number: boolean
  onboarding_completed: boolean
  created_at: string
}

// profiles = identidade compartilhada (1 por pessoa). Tudo que é por-academia mora
// em Membership. NÃO adicione campos por-academia aqui.
export interface Profile {
  id: string
  full_name: string
  avatar_url: string | null
  phone: string | null
  city: string | null
  created_at: string
}

// Vínculo de uma pessoa com uma academia. Fonte da verdade dos dados por-academia
// (a partir do Plano 2 substitui os campos correspondentes de Profile).
export interface Membership {
  id: string
  user_id: string
  organization_id: string
  role: UserRole
  level: StudentLevel
  payment_type: PaymentType
  is_dependent: boolean
  parent_id: string | null
  contract_active: boolean
  credits_balance: number // cache; verdade = credit_transactions
  monthly_checkin_target: number
  pending_partner: CheckinPartner | null
  wellhub_id: string | null
  totalpass_id: string | null
  created_at: string
}

export interface Class {
  id: string
  organization_id: string
  name: string
  description: string | null
  level: StudentLevel
  type: ClassType
  day_of_week: number // 0=Sunday, 6=Saturday
  start_time: string // HH:MM
  end_time: string
  max_students: number
  is_active: boolean
  court: number
}

export interface ClassSession {
  id: string
  organization_id: string
  class_id: string
  session_date: string // YYYY-MM-DD
  status: SessionStatus
  notes: string | null
}

export interface Enrollment {
  id: string
  organization_id: string
  student_id: string
  class_id: string
  enrolled_at: string
  cancelled_at: string | null
  is_active: boolean
}

export interface SessionBooking {
  id: string
  organization_id: string
  student_id: string
  session_id: string
  type: BookingType
  status: BookingStatus
  from_enrollment: boolean
  credit_used: boolean
  booked_at: string
  cancelled_at: string | null
}

export interface Attendance {
  id: string
  organization_id: string
  student_id: string
  session_id: string
  status: AttendanceStatus
  source: AttendanceSource
  checked_in_at: string
}

export interface Checkin {
  id: string
  organization_id: string
  student_id: string
  partner: CheckinPartner
  checkin_date: string // YYYY-MM-DD
  session_id: string | null
  external_ref: string | null
  validation: 'manual' | CheckinPartner
  created_by: string | null
  created_at: string
}

export interface CreditTransaction {
  id: string
  organization_id: string
  student_id: string
  type: CreditTransactionType
  amount: number
  reason: string
  session_id: string | null
  subscription_id: string | null
  expires_at: string | null // null = expires at month end; date = makeup credit (30 days)
  created_at: string
}

export interface TrialBooking {
  id: string
  organization_id: string
  name: string
  email: string
  phone: string
  session_id: string
  status: TrialStatus
  must_pay_next: boolean
  created_at: string
}

export interface SubscriptionPlan {
  id: string
  organization_id: string
  name: string
  description: string | null
  classes_per_week: number
  credits_per_month: number
  price_monthly: number
  price_quarterly: number
  price_annual: number
  is_active: boolean
}

export interface StudentSubscription {
  id: string
  organization_id: string
  student_id: string
  payer_id: string
  plan_id: string
  status: SubscriptionStatus
  starts_at: string
  ends_at: string | null
  next_billing_at: string
  discount_pct: number
  gateway_subscription_id: string | null
}

export interface Payment {
  id: string
  organization_id: string
  student_id: string
  subscription_id: string | null
  session_id: string | null
  amount: number
  currency: string
  status: PaymentStatus
  type: PaymentTransactionType
  gateway_payment_id: string | null
  gateway: string
  paid_at: string | null
  created_at: string
}

export interface Tournament {
  id: string
  organization_id: string
  name: string
  date: string
  format: TournamentFormat
  modality: TournamentModality
  level: StudentLevel
  status: TournamentStatus
  created_by: string
}

export interface Post {
  id: string
  organization_id: string
  author_id: string
  content: string
  image_urls: string[]
  likes_count: number
  session_id: string | null
  tournament_id: string | null
  created_at: string
}

export interface Notification {
  id: string
  organization_id: string
  user_id: string
  type: string
  title: string
  body: string
  read: boolean
  created_at: string
}

export interface DayUseSlot {
  id: string
  organization_id: string
  court: number       // 1 ou 2
  date: string        // YYYY-MM-DD
  start_time: string  // HH:MM
  end_time: string
  capacity: number
  notes: string | null
  is_active: boolean
  created_by: string
  created_at: string
}

export interface DayUseBooking {
  id: string
  organization_id: string
  slot_id: string
  student_id: string
  status: 'confirmed' | 'cancelled'
  booked_at: string
  cancelled_at: string | null
}

export type WaitlistStatus = 'waiting' | 'offered' | 'accepted' | 'expired' | 'cancelled'

export interface Waitlist {
  id: string
  organization_id: string
  session_id: string
  student_id: string
  position: number
  status: WaitlistStatus
  joined_at: string
  notified_at: string | null
  created_at: string
}

// Joined types for UI
export interface ClassWithSession extends Class {
  sessions: ClassSession[]
  enrolled_count: number
}

export interface SessionWithClass extends ClassSession {
  class: Class
  bookings_count: number
}
