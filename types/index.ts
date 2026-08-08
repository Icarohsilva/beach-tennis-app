// types/index.ts

export type UserRole = 'student' | 'admin' | 'super_admin'
export type OrganizationStatus = 'active' | 'suspended'
export type StudentLevel = 'A' | 'B' | 'C' | 'D' | 'iniciante'
export type PaymentType = 'subscriber' | 'per_class' | 'wellhub' | 'totalpass'
export type ClassType = 'kids' | 'adult'
export type BookingStatus = 'confirmed' | 'cancelled'
export type BookingType = 'extra' | 'makeup'
export type AttendanceStatus = 'present' | 'absent' | 'late'
// 'self' = o próprio aluno confirmou pelo app (ver SelfCheckin).
export type AttendanceSource = 'manual' | 'wellhub' | 'totalpass' | 'self'
export type CheckinPartner = 'wellhub' | 'totalpass'

/**
 * Motivo da adição de um aluno sem plano, parceiro nem crédito a uma sessão.
 * Pré-declaração: 'experimental' e 'on_spot' gravam payments na hora, o que
 * SUPRIME a dívida automática da presença (via payments_session_student_unique).
 * 'open' não grava nada — a presença cria a pendência normalmente.
 */
export type AddStudentReason = 'experimental' | 'on_spot' | 'open'

export interface OrgIntegration {
  id: string
  organization_id: string
  partner: CheckinPartner
  gym_id: string
  webhook_secret: string
  // Chave do Access Control API (Bearer) usada no validate. Segredo — nunca vai ao browser.
  api_key: string | null
  environment: 'sandbox' | 'production'
  status: 'connected' | 'disconnected'
  connected_at: string
  created_at: string
}

// Versão segura para o browser: NUNCA inclui os segredos (webhook_secret, api_key).
// Use este tipo em qualquer dado de integração serializado para Client Components.
export type OrgIntegrationView = Omit<OrgIntegration, 'webhook_secret' | 'api_key'> & {
  has_api_key: boolean
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
  partner_validated: boolean
  partner_validation_error: string | null
  created_at: string
}

export interface PartnerCheckinRate {
  organization_id: string
  partner: CheckinPartner
  value: number
  updated_at: string
}

export type SessionStatus = 'scheduled' | 'completed' | 'cancelled'
export type SubscriptionStatus = 'active' | 'paused' | 'cancelled' | 'pending_payment' | 'past_due'
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded'
export type PaymentTransactionType = 'subscription' | 'per_class' | 'trial' | 'day_use'
export type CreditTransactionType = 'renewed' | 'used' | 'refunded' | 'expired' | 'purchased'
export type Periodicity = 'monthly' | 'bimonthly' | 'quarterly' | 'semiannual' | 'annual'
export type SubscriptionGateway = 'manual' | 'mercadopago'
export type Gender = 'M' | 'F'
export type TournamentCategory = 'masculino' | 'feminino' | 'misto' | 'livre'
export type ParticipantType = 'individual' | 'dupla_fixa' | 'dupla_revezando'
// 'super8' mantido p/ leitura de linhas legadas; o motor novo usa 'americano'.
export type TournamentFormat =
  | 'americano'
  | 'round_robin'
  | 'eliminatoria'
  | 'ranking'
  | 'super8'

export interface ScoringConfig {
  sets_to_win: number
  games_per_set: number
  tiebreak_games: boolean
}

export interface StandingRow {
  playerId: string
  played: number
  wins: number
  gamesFor: number
  gamesAgainst: number
  diff: number
  points: number
}
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
  tournament_discount_2_pct: number
  tournament_discount_3_pct: number
  onboarding_completed: boolean
  // Ponto da quadra, usado para conferir a confirmação de presença do aluno.
  // null = academia ainda não marcou o ponto (toda confirmação vira pendente).
  latitude: number | null
  longitude: number | null
  checkin_radius_m: number
  self_checkin_enabled: boolean
  created_at: string
}

// profiles = identidade compartilhada (1 por pessoa). Tudo que é por-academia mora
// em Membership. NÃO adicione campos por-academia aqui.
export interface Profile {
  id: string
  full_name: string
  avatar_url: string | null
  phone: string | null
  gender: Gender | null
  city: string | null
  is_platform_admin: boolean
  tour_aluno_seen_at: string | null
  tour_admin_seen_at: string | null
  created_at: string
}

// Vínculo de uma pessoa com uma academia. Fonte da verdade dos dados por-academia
// (a partir do Plano 2 substitui os campos correspondentes de Profile).
export interface Membership {
  id: string
  user_id: string
  organization_id: string
  role: UserRole
  is_co_owner: boolean // admin com poderes de dono (financeiro/configurações/equipe) sem ser o owner_id da org
  level: StudentLevel
  payment_type: PaymentType // eixo cobrança: 'subscriber' | 'per_class' (não recebe mais wellhub/totalpass)
  partner: CheckinPartner | null // eixo parceiro, independente da cobrança
  is_dependent: boolean
  parent_id: string | null
  contract_active: boolean
  credits_balance: number // cache; verdade = credit_transactions
  monthly_checkin_target: number
  pending_partner: CheckinPartner | null
  wellhub_id: string | null
  totalpass_id: string | null
  sports: string[] // esportes que a pessoa pratica NESTA academia; slugs de lib/arenas/sports.ts
  liga_opted_out: boolean // aluno escolheu não aparecer no ranking da Liga; continua pontuando
  created_at: string
}

export interface Class {
  id: string
  organization_id: string
  name: string
  description: string | null
  level: StudentLevel
  sport: string | null // modalidade da turma; informativa, nunca bloqueia reserva
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
  /** Quando o professor iniciou a aula. Null = chamada ainda só leitura. */
  started_at: string | null
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
  // Resultado do validate do parceiro (Wellhub). Só validados geram receita.
  partner_validated: boolean
  partner_validation_error: string | null
  created_by: string | null
  created_at: string
}

export type SelfCheckinStatus = 'validated' | 'pending' | 'rejected'

/** Por que a conferência de localização não pôde validar a confirmação. */
export type SelfCheckinGeoError =
  | 'denied' // aluno negou a permissão
  | 'unavailable' // o dispositivo não conseguiu obter posição
  | 'timeout' // demorou demais
  | 'unsupported' // browser sem geolocation
  | 'org_unset' // a academia não marcou o ponto da quadra
  | 'inaccurate' // leitura imprecisa demais para afirmar qualquer coisa
  | 'out_of_range' // fora do raio da academia

/**
 * Confirmação de presença feita pelo PRÓPRIO aluno pelo app, na janela em torno
 * da aula. Evidência, não veredito: quando `validated`, gera uma linha em
 * `attendance` com source='self'; quando `pending`, só vira presença depois de
 * o professor aprovar na chamada.
 *
 * Não confundir com `Checkin` (catraca do parceiro) nem com `Attendance`
 * (a marcação em si).
 */
export interface SelfCheckin {
  id: string
  organization_id: string
  student_id: string
  session_id: string
  status: SelfCheckinStatus
  latitude: number | null
  longitude: number | null
  accuracy_m: number | null
  /** Distância medida até a academia, em metros. null quando não houve GPS. */
  distance_m: number | null
  geo_error: SelfCheckinGeoError | null
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
}

export type MissedCheckinStatus = 'open' | 'paid' | 'waived'

/**
 * Check-in que a academia deixou de receber: o aluno de parceiro tinha aula
 * reservada e o professor marcou AUSENTE na chamada.
 *
 * Não confundir com `PendingCheckin` (fila do webhook sem aluno casado) nem com a
 * pendência financeira de aula avulsa (`Payment` com `session_id`).
 */
export interface MissedCheckin {
  id: string
  organization_id: string
  student_id: string
  session_id: string
  partner: CheckinPartner
  session_date: string // YYYY-MM-DD
  amount: number // reais, congelado no momento da falta
  status: MissedCheckinStatus
  payment_id: string | null // null quando amount = 0 (só controle, sem cobrança)
  resolved_at: string | null
  resolved_by: string | null
  resolution_note: string | null
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

export type PlanCycle = 'weekly' | 'monthly'

export interface SubscriptionPlan {
  id: string
  organization_id: string
  name: string
  description: string | null
  classes_per_week: number
  cycle: PlanCycle
  max_classes_per_day: number
  refund_on_late_cancel: boolean
  is_active: boolean
}

export interface PlanBillingOption {
  id: string
  organization_id: string
  plan_id: string
  periodicity: Periodicity
  price: number
  is_enabled: boolean
}

export interface GatewayIntegrationRequest {
  id: string
  organization_id: string
  requested_by: string
  gateway_name: string
  notes: string | null
  status: 'pending' | 'reviewed'
  created_at: string
}

export interface PlanRecommendation {
  id: string
  organization_id: string
  student_id: string
  plan_id: string
  billing_option_id: string
  created_by: string
  status: 'pending' | 'completed' | 'dismissed'
  created_at: string
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
  billing_option_id: string | null
  periodicity: Periodicity | null
  price: number | null
  current_period_end: string | null
  gateway: SubscriptionGateway
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
  dayuse_booking_id: string | null
  credits_qty: number | null
  // true = nasceu de uma pendência de check-in de parceiro, não de aula avulsa.
  // Quem filtra por dívida de avulsa precisa excluir estes (ver MissedCheckin).
  missed_checkin: boolean
  paid_at: string | null
  created_at: string
}

export interface Tournament {
  id: string
  organization_id: string
  name: string
  date: string
  sport: string
  category: TournamentCategory
  participant_type: ParticipantType
  format: TournamentFormat
  modality: TournamentModality | null
  level: StudentLevel
  sets_to_win: number
  games_per_set: number
  tiebreak_games: boolean
  status: TournamentStatus
  created_by: string
  cover_image_url: string | null
  winner1_id: string | null
  winner2_id: string | null
  winner3_id: string | null
  winner1_partner_id: string | null
  winner2_partner_id: string | null
  winner3_partner_id: string | null
  entry_price_cents: number | null
  pix_key: string | null
  max_players: number | null
}

export interface TournamentEntry {
  id: string
  organization_id: string
  tournament_id: string
  player_id: string
  partner_id: string | null
  seed: number | null
  created_at: string
  payment_status: 'free' | 'pending' | 'paid'
  discount_pct: number
  final_price_cents: number
  receipt_url: string | null
  entry_status: 'confirmed' | 'waitlist' | 'offered'
  offer_expires_at: string | null
}

export interface Post {
  id: string
  organization_id: string
  author_id: string
  content: string
  image_urls: string[]
  likes_count: number
  is_pinned: boolean // mural de comunicados: fixado no topo do feed pela academia
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
  status: 'confirmed' | 'cancelled' | 'pending_payment'
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

// --- Liga (gamificação do aluno) -------------------------------------------
// A divisão é definida em lib/liga/divisions.ts junto da regra de movimentação: a
// regra pura não pode depender deste arquivo (que importa tipos de Supabase). Aqui só
// o alias, para que as telas não precisem importar de lib/liga.
import type { Division } from '@/lib/liga/divisions'

export type LigaDivision = Division

export type LigaPointReason =
  | 'attendance'
  | 'streak'
  | 'tournament_entry'
  | 'tournament_result'
  | 'manual'
  | 'kudos_given'
  | 'kudos_received'
  // Fontes extras: comportamento que ajuda a academia (features/liga/extraPoints.ts).
  | 'self_checkin'
  | 'cancel_in_time'
  | 'waitlist_accept'
  | 'early_booking'
  | 'profile_complete'
  | 'dayuse'

export interface LigaSeason {
  id: string
  organization_id: string
  starts_on: string // YYYY-MM-DD
  ends_on: string // YYYY-MM-DD
  status: 'active' | 'closed'
  created_at: string
}

export interface LigaPointEntry {
  id: string
  organization_id: string
  season_id: string
  student_id: string
  sport: string
  points: number
  reason: LigaPointReason
  source_id: string | null
  note: string | null
  awarded_by: string | null
  created_at: string
}

export interface LigaStanding {
  organization_id: string
  season_id: string
  student_id: string
  sport: string
  division: LigaDivision
  points: number
  streak_weeks: number
}

// Medalha conquistada. O catálogo (o que cada chave exige) mora em lib/liga/medals.ts:
// medalha é regra, não dado. Não vale ponto.
export interface LigaMedal {
  id: string
  organization_id: string
  student_id: string
  medal_key: string
  sport: string | null // null = medalha global (tempo de casa)
  earned_at: string
  seen_at: string | null // null = ainda não comemorada com o aluno
}
