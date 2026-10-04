'use server'
// features/checkin/appCheckinActions.ts
// Check-in Wellhub pelo app: o aluno registra o do dia com o print, e o admin
// liga a função e confere (ou exclui) o que chegou.
import { revalidatePath } from 'next/cache'
import { createAdminClient, getActiveOrgId, getAuthUser } from '@/lib/supabase/server'
import { requireAdmin } from '@/features/aulas/authGuards'
import { recordResolvedCheckin } from '@/lib/checkin/ingest'
import {
  APP_CHECKIN_PARTNER,
  APP_CHECKIN_SETTING,
  appCheckinRef,
  receiptPath,
  resolveAppCheckin,
  validateReceiptFile,
} from '@/lib/checkin/appCheckin'
import { brtToday } from '@/lib/utils/gridSchedule'
import { createHash } from 'crypto'
import { checkReceipt } from '@/lib/checkin/receiptCheck'
import { readWellhubReceipt } from '@/lib/checkin/receiptReader'
import { isAppCheckinEnabled, isWellhubIntegrationConnected } from './appCheckinQueries'
import type { CheckinPartner } from '@/types'

const BLOCK_MESSAGE = {
  disabled: 'O check-in pelo app não está ativo nesta arena.',
  integration: 'Esta arena recebe o check-in do Wellhub automaticamente. Não precisa registrar aqui.',
  not_partner: 'O check-in pelo app é só para quem tem o plano Wellhub nesta arena.',
} as const

/**
 * O aluno do plano Wellhub registra o check-in de HOJE, com o print do app.
 *
 * Grava pelo mesmo núcleo do webhook (recordResolvedCheckin): se houver aula
 * reservada a até 1h, marca presença; se não, dá baixa numa pendência de
 * check-in em aberto. Um por dia — o mesmo limite do próprio Wellhub —, travado
 * pela checagem do dia e, numa corrida, pelo índice único de external_ref.
 *
 * O print sobe por service role (bucket privado): o aluno nunca lê nem lista o
 * bucket, e o caminho fica preso à academia, ao aluno e ao dia.
 */
export async function submitAppCheckin(formData: FormData): Promise<{
  error?: string
  linkedSession?: boolean
  /** 'validated' = o print passou na leitura; 'review' = a arena vai conferir. */
  receiptStatus?: 'validated' | 'review'
}> {
  const user = await getAuthUser()
  if (!user) return { error: 'Faça login de novo para registrar o check-in.' }
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia não encontrada.' }

  const file = formData.get('file')
  const fileErr = validateReceiptFile(file instanceof File ? file : null)
  if (fileErr) return { error: fileErr }
  const receipt = file as File

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('memberships')
    .select('partner, archived_at')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .maybeSingle()
  const m = membership as { partner: CheckinPartner | null; archived_at: string | null } | null
  if (!m || m.archived_at) return { error: 'Seu cadastro não está ativo nesta arena.' }

  const [enabled, integrationConnected] = await Promise.all([
    isAppCheckinEnabled(admin, orgId),
    isWellhubIntegrationConnected(admin, orgId),
  ])
  const rule = resolveAppCheckin({ enabled, integrationConnected, partner: m.partner })
  if (!rule.available) return { error: BLOCK_MESSAGE[rule.reason] }

  // Um check-in por dia, por qualquer caminho: se o admin já registrou o de hoje
  // na mão, o do app seria o mesmo dia contado duas vezes.
  const today = brtToday(new Date())
  const { count } = await admin
    .from('checkins')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('student_id', user.id)
    .eq('checkin_date', today)
  if ((count ?? 0) > 0) return { error: 'Seu check-in de hoje já está registrado.' }

  const bytes = new Uint8Array(await receipt.arrayBuffer())

  // O mesmo arquivo de novo (deste ou de outro aluno) é recusado sem depender da
  // leitura: é a fraude mais simples, e o hash a pega com certeza.
  const sha = createHash('sha256').update(bytes).digest('hex')
  const { count: reused } = await admin
    .from('checkins')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('receipt_sha256', sha)
  if ((reused ?? 0) > 0) return { error: 'Este print já foi usado em outro check-in. Envie o print do check-in de hoje.' }

  // Leitura do print + regras (lib/checkin/receiptCheck.ts): de hoje, não
  // anterior ao último comprovante, e da academia certa. Sem leitura (sem chave,
  // falha de rede), o check-in entra para a arena conferir em vez de travar o
  // aluno por um problema nosso.
  const [{ data: lastRow }, { data: orgRow }] = await Promise.all([
    admin
      .from('checkins')
      .select('receipt_taken_at')
      .eq('organization_id', orgId)
      .eq('student_id', user.id)
      .not('receipt_taken_at', 'is', null)
      .order('receipt_taken_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin.from('organizations').select('name').eq('id', orgId).maybeSingle(),
  ])
  const reading = await readWellhubReceipt(
    bytes,
    receipt.type as 'image/jpeg' | 'image/png' | 'image/webp',
  )
  const verdict = reading
    ? checkReceipt({
        reading,
        now: new Date(),
        orgName: (orgRow as { name: string } | null)?.name ?? '',
        lastTakenAt: (lastRow as { receipt_taken_at: string } | null)?.receipt_taken_at ?? null,
      })
    : { status: 'review' as const, takenAt: null, note: 'Leitura automática indisponível. Confira o print.' }
  if (verdict.status === 'rejected') return { error: verdict.reason }

  const path = receiptPath(orgId, user.id, today, receipt.type)
  const { error: upErr } = await admin.storage
    .from('checkin-receipts')
    .upload(path, bytes, {
      upsert: true,
      contentType: receipt.type,
    })
  if (upErr) return { error: 'Não foi possível enviar o print. Tente de novo.' }

  try {
    const r = await recordResolvedCheckin(admin, {
      orgId,
      studentId: user.id,
      partner: APP_CHECKIN_PARTNER,
      date: today,
      checkinAt: new Date().toISOString(),
      externalRef: appCheckinRef(user.id, today),
      validation: 'app',
      createdBy: user.id,
      receiptUrl: path,
    })
    if (!r.isNew) return { error: 'Seu check-in de hoje já está registrado.' }

    // O resultado da leitura vai para a linha do check-in: é o que a fila do
    // admin mostra ("validado" ou "conferir") e a régua do próximo envio.
    await admin
      .from('checkins')
      .update({
        receipt_status: verdict.status,
        receipt_taken_at: verdict.takenAt,
        receipt_gym_name: reading?.gymName ?? null,
        receipt_note: verdict.note,
        receipt_sha256: sha,
      })
      .eq('organization_id', orgId)
      .eq('partner', APP_CHECKIN_PARTNER)
      .eq('external_ref', appCheckinRef(user.id, today))

    revalidatePath('/home')
    revalidatePath('/admin/wellhub')
    return { linkedSession: Boolean(r.linkedSessionId), receiptStatus: verdict.status }
  } catch (e) {
    console.error('[appCheckin] falha ao registrar', e)
    // Sem o registro, o print não serve para nada: remove para o próximo envio
    // não dar a impressão de que o dia já foi contado.
    await admin.storage.from('checkin-receipts').remove([path])
    return { error: 'Não foi possível registrar o check-in. Tente de novo.' }
  }
}

/** Liga ou desliga o check-in pelo app na arena (Configurações). */
export async function setAppCheckinEnabled(enabled: boolean): Promise<{ error?: string }> {
  const { orgId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  const { error } = await createAdminClient()
    .from('system_settings')
    .upsert(
      { organization_id: orgId, key: APP_CHECKIN_SETTING, value: String(enabled) },
      { onConflict: 'organization_id,key' },
    )
  if (error) return { error: 'Não foi possível salvar.' }

  revalidatePath('/admin/configuracoes')
  revalidatePath('/admin/wellhub')
  revalidatePath('/home')
  return {}
}

/**
 * O admin exclui um check-in do app cujo print não confere.
 *
 * Desfaz também a presença que ESTE check-in marcou (source = wellhub na aula
 * vinculada): sem isso a aula seguiria contando como frequentada por um
 * check-in que não existe mais. Presença marcada na mão pelo professor fica.
 * Não cria pendência sozinha — se a falta for real, a chamada é que marca.
 */
export async function deleteAppCheckin(checkinId: string): Promise<{ error?: string }> {
  const { orgId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  const admin = createAdminClient()
  const { data: row } = await admin
    .from('checkins')
    .select('id, student_id, session_id, receipt_url, validation')
    .eq('id', checkinId)
    .eq('organization_id', orgId)
    .maybeSingle()
  const c = row as {
    student_id: string
    session_id: string | null
    receipt_url: string | null
    validation: string
  } | null
  if (!c) return { error: 'Check-in não encontrado.' }
  if (c.validation !== 'app') return { error: 'Só check-ins feitos pelo app podem ser excluídos aqui.' }

  const { error } = await admin.from('checkins').delete().eq('id', checkinId)
  if (error) return { error: 'Não foi possível excluir o check-in.' }

  if (c.session_id) {
    await admin
      .from('attendance')
      .delete()
      .eq('organization_id', orgId)
      .eq('student_id', c.student_id)
      .eq('session_id', c.session_id)
      .eq('source', APP_CHECKIN_PARTNER)
  }
  if (c.receipt_url) {
    await admin.storage.from('checkin-receipts').remove([c.receipt_url])
  }

  revalidatePath('/admin/wellhub')
  revalidatePath(`/admin/alunos/${c.student_id}`)
  return {}
}
