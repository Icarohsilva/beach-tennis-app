// lib/superAdmin/filterOrgs.ts
// Linha da lista de academias do painel super-admin (serializável para o client).
export interface OrgListRow {
  id: string
  name: string
  city: string | null
  state: string | null
  owner_name: string | null
  org_status: 'active' | 'suspended'
  sub_status: string
  created_at: string
}

// Remove acentos e normaliza caixa para busca tolerante (nomes BR têm acento).
function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

// Filtra academias por substring do nome, ignorando caixa e acentos.
export function filterOrganizations(rows: OrgListRow[], query: string): OrgListRow[] {
  const q = normalize(query)
  if (!q) return rows
  return rows.filter((r) => normalize(r.name).includes(q))
}
