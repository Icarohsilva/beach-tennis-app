# -*- coding: utf-8 -*-
"""Gera as artes da campanha ArenaHub (SVG -> PDF/PNG)."""
import io, os, qrcode, cairosvg
from pypdf import PdfWriter, PdfReader

OUT = "/sessions/magical-charming-gates/mnt/outputs"

# ---- paleta ----
LARANJA   = "#ea580c"
LARANJA_D = "#9a3412"
LARANJA_L = "#ffedd5"
ESCURO    = "#1c1917"
CINZA     = "#57534e"
CINZA_C   = "#a8a29e"
OFF       = "#fafaf9"
AMARELO   = "#facc15"

SITE = "arenahub.website"
WPP  = "WhatsApp (31) 99631-3913"
INSTA = "@arenahub.app"

def qr_path(url, x, y, size, color=ESCURO):
    """QR como um único <path> de quadradinhos, ocupando size x size mm em (x,y)."""
    q = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=0)
    q.add_data(url); q.make(fit=True)
    m = q.get_matrix(); n = len(m); s = size / n
    d = []
    for r in range(n):
        for c in range(n):
            if m[r][c]:
                d.append(f"M{x+c*s:.3f},{y+r*s:.3f}h{s:.3f}v{s:.3f}h{-s:.3f}z")
    return f'<path d="{"".join(d)}" fill="{color}"/>'

def symbol(x, y, h, box=LARANJA, letter="#ffffff", ball=AMARELO):
    """Símbolo: quadrado arredondado + A + bolinha."""
    s = h / 100.0
    return f'''<g transform="translate({x},{y}) scale({s})">
      <rect width="100" height="100" rx="26" fill="{box}"/>
      <text x="46" y="76" font-family="Poppins" font-weight="bold" font-size="64"
            fill="{letter}" text-anchor="middle">A</text>
      <circle cx="74" cy="32" r="9" fill="{ball}"/>
    </g>'''

def wordmark(x, y, h, cor_arena, cor_hub, box=LARANJA, letter="#ffffff"):
    """Símbolo + texto 'ArenaHub'. h = altura do símbolo (mm)."""
    fs = h * 0.72
    tx = x + h * 1.25
    ty = y + h * 0.74
    return (symbol(x, y, h, box, letter) +
        f'<text x="{tx}" y="{ty}" font-family="Poppins" font-weight="bold" font-size="{fs}">'
        f'<tspan fill="{cor_arena}">Arena</tspan><tspan fill="{cor_hub}">Hub</tspan></text>')

def wordmark_centered(cx, y, fs, cor_arena, cor_hub):
    """'ArenaHub' bicolor centralizado: 'Arena' ancorado no fim e 'Hub' no início,
    emendados no ponto de divisão (evita gap dos tspans no cairosvg)."""
    wA, wH = textw("Arena", fs), textw("Hub", fs)
    split = cx + (wA - wH) / 2
    return (f'<text x="{split}" y="{y}" font-family="Poppins" font-weight="bold" '
            f'font-size="{fs}" fill="{cor_arena}" text-anchor="end">Arena</text>'
            f'<text x="{split}" y="{y}" font-family="Poppins" font-weight="bold" '
            f'font-size="{fs}" fill="{cor_hub}" text-anchor="start">Hub</text>')

def svg(w, h, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}mm" height="{h}mm" '
            f'viewBox="0 0 {w} {h}">{body}</svg>')

def save_pdf(svgs, name):
    """Converte lista de SVGs (uma página cada) num PDF único."""
    w = PdfWriter()
    for s in svgs:
        pdf = cairosvg.svg2pdf(bytestring=s.encode())
        for p in PdfReader(io.BytesIO(pdf)).pages:
            w.add_page(p)
    with open(os.path.join(OUT, name), "wb") as f:
        w.write(f)
    print("ok", name)

def save_png(s, name, w_mm, dpi=300):
    px = int(w_mm / 25.4 * dpi)
    cairosvg.svg2png(bytestring=s.encode(), write_to=os.path.join(OUT, name), output_width=px)
    print("ok", name)

def pill(x, y, w, h, fill, text, fs, tcolor, weight="bold", ls="0.4"):
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{h/2}" fill="{fill}"/>'
            f'<text x="{x+w/2}" y="{y+h/2+fs*0.36}" font-family="Poppins" font-weight="{weight}" '
            f'font-size="{fs}" fill="{tcolor}" text-anchor="middle" letter-spacing="{ls}">{text}</text>')

def T(x, y, txt, fs, fill, weight="normal", anchor="start", family="Poppins", ls="0"):
    return (f'<text x="{x}" y="{y}" font-family="{family}" font-weight="{weight}" '
            f'font-size="{fs}" fill="{fill}" text-anchor="{anchor}" letter-spacing="{ls}">{txt}</text>')

def check(x, y, s, color="#16a34a", sw=1.2):
    return (f'<path d="M{x},{y+s*0.55} l{s*0.32},{s*0.32} l{s*0.6},{-s*0.75}" fill="none" '
            f'stroke="{color}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round"/>')

# icones simples (caixa 8x8, tracos brancos)
def icon(kind, x, y, s=8.0):
    k = s / 8.0
    st = f'fill="none" stroke="#ffffff" stroke-width="{0.9*k}" stroke-linecap="round" stroke-linejoin="round"'
    g = f'<g transform="translate({x},{y}) scale({k})">'
    g += f'<rect x="0" y="0" width="8" height="8" rx="2" fill="{LARANJA}" transform="scale(1.6)"/>'
    # conteudo centralizado na caixa 12.8 -> desloca
    g += '<g transform="translate(2.4,2.4)">'
    if kind == "agenda":
        g += f'<rect x="0.6" y="1.4" width="6.8" height="5.6" rx="0.8" {st}/>'
        g += f'<path d="M0.6,3.2 h6.8 M2.4,0.6 v1.4 M5.6,0.6 v1.4" {st}/>'
        g += f'<circle cx="2.6" cy="5" r="0.5" fill="#ffffff"/><circle cx="4.9" cy="5" r="0.5" fill="#ffffff"/>'
    elif kind == "credito":
        g += f'<path d="M6.9,4 a2.9,2.9 0 1 1 -1.1,-2.3" {st}/>'
        g += f'<path d="M6.9,0.9 v1.6 h-1.6" {st}/>'
    elif kind == "checkin":
        g += f'<circle cx="4" cy="4" r="3.2" {st}/>'
        g += f'<path d="M2.5,4.1 l1.1,1.1 l2,-2.4" {st}/>'
    elif kind == "pix":
        g += f'<path d="M4,0.7 L7.3,4 L4,7.3 L0.7,4 Z" {st}/>'
        g += f'<circle cx="4" cy="4" r="0.7" fill="#ffffff"/>'
    elif kind == "torneio":
        g += f'<path d="M2.2,0.8 h3.6 v2 a1.8,1.8 0 0 1 -3.6 0 Z" {st}/>'
        g += f'<path d="M4,4.7 v1.2 M2.6,6.9 h2.8" {st}/>'
        g += f'<path d="M2.2,1.4 h-1.1 a1.2,1.2 0 0 0 1.2,1.5 M5.8,1.4 h1.1 a1.2,1.2 0 0 1 -1.2,1.5" {st}/>'
    elif kind == "chat":
        g += f'<rect x="0.7" y="1" width="6.6" height="4.4" rx="1.2" {st}/>'
        g += f'<path d="M2.6,5.4 v1.8 l1.8,-1.8" {st}/>'
    g += '</g></g>'
    return g

# ================= SISTEMA VISUAL V2 =================
VERDE = "#22c55e"

# ---- medição real de texto (fontTools) ----
from fontTools.ttLib import TTFont as _TTF
import html as _html
_FCACHE = {}
def _font(w):
    p = {"bold": "Poppins-Bold.ttf", "500": "Poppins-Medium.ttf"}.get(w, "Poppins-Regular.ttf")
    if p not in _FCACHE:
        f = _TTF("/usr/share/fonts/truetype/google-fonts/" + p)
        _FCACHE[p] = (f.getBestCmap(), f["hmtx"], f["head"].unitsPerEm)
    return _FCACHE[p]
def textw(txt, fs, weight="bold", ls=0.0):
    t = _html.unescape(txt)
    cmap, hmtx, upm = _font(weight)
    w = 0
    for ch in t:
        g = cmap.get(ord(ch))
        w += (hmtx[g][0] if g else upm * 0.6)
    return w / upm * fs + float(ls) * max(len(t) - 1, 0)
def pill_l(x, y, text, fs, bg, fg, ls=0.0, h=None):
    h = h or fs * 2.3; padx = fs * 1.5
    w = textw(text, fs, "bold", ls) + 2 * padx
    return (f'<rect x="{x}" y="{y}" width="{w:.2f}" height="{h:.2f}" rx="{h/2:.2f}" fill="{bg}"/>'
            f'<text x="{x+padx}" y="{y+h/2+fs*0.36}" font-family="Poppins" font-weight="bold" '
            f'font-size="{fs}" fill="{fg}" letter-spacing="{ls}">{text}</text>')
def pill_c(cx, y, text, fs, bg, fg, ls=0.0, h=None):
    h = h or fs * 2.3; padx = fs * 1.5
    tw = textw(text, fs, "bold", ls); w = tw + 2 * padx
    x = cx - w / 2
    return (f'<rect x="{x:.2f}" y="{y}" width="{w:.2f}" height="{h:.2f}" rx="{h/2:.2f}" fill="{bg}"/>'
            f'<text x="{x+padx:.2f}" y="{y+h/2+fs*0.36}" font-family="Poppins" font-weight="bold" '
            f'font-size="{fs}" fill="{fg}" letter-spacing="{ls}">{text}</text>')

DEFS = (
 '<defs>'
 '<linearGradient id="sun" x1="0" y1="0" x2="0" y2="1">'
 '<stop offset="0" stop-color="#fb923c"/><stop offset="0.55" stop-color="#ea580c"/><stop offset="1" stop-color="#c2410c"/></linearGradient>'
 '<linearGradient id="sunH" x1="0" y1="0" x2="1" y2="0">'
 '<stop offset="0" stop-color="#fb923c"/><stop offset="0.55" stop-color="#ea580c"/><stop offset="1" stop-color="#c2410c"/></linearGradient>'
 '<radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">'
 '<stop offset="0" stop-color="#ea580c" stop-opacity="0.5"/><stop offset="1" stop-color="#ea580c" stop-opacity="0"/></radialGradient>'
 '<radialGradient id="sunR" cx="0.5" cy="0.35" r="0.8">'
 '<stop offset="0" stop-color="#fb923c"/><stop offset="0.65" stop-color="#ea580c"/><stop offset="1" stop-color="#c2410c"/></radialGradient>'
 '<pattern id="dots" width="5" height="5" patternUnits="userSpaceOnUse">'
 '<circle cx="1" cy="1" r="0.85" fill="#ffffff" opacity="0.14"/></pattern>'
 '</defs>')

def court(x, y, w, h, op=0.15, sw=0.8, color="#ffffff"):
    st = f'fill="none" stroke="{color}" stroke-width="{sw}" opacity="{op}"'
    return (f'<g><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="2" {st}/>'
            f'<path d="M{x+w/2},{y} V{y+h}" {st}/>'
            f'<path d="M{x+w*0.25},{y+h*0.28} H{x+w*0.75} M{x+w*0.25},{y+h*0.72} H{x+w*0.75}" {st}/></g>')

def ball(cx, cy, r, fill=AMARELO, seam="#ca8a04", op=1):
    sw = r * 0.16
    return (f'<g opacity="{op}"><circle cx="{cx}" cy="{cy}" r="{r}" fill="{fill}"/>'
            f'<path d="M{cx-r*0.92},{cy-r*0.38} Q{cx},{cy+r*0.28} {cx+r*0.92},{cy-r*0.38}" fill="none" stroke="{seam}" stroke-width="{sw}" stroke-linecap="round"/>'
            f'<path d="M{cx-r*0.92},{cy+r*0.38} Q{cx},{cy-r*0.28} {cx+r*0.92},{cy+r*0.38}" fill="none" stroke="{seam}" stroke-width="{sw}" stroke-linecap="round"/>'
            f'<circle cx="{cx-r*0.35}" cy="{cy-r*0.45}" r="{r*0.16}" fill="#fde68a" opacity="0.9"/></g>')

def HL(x, y, txt, fs, fill, anchor="start"):
    return (f'<g transform="translate({x},{y}) skewX(-8)">'
            f'<text x="0" y="0" font-family="Poppins" font-weight="bold" font-size="{fs}" '
            f'fill="{fill}" text-anchor="{anchor}" letter-spacing="0.15">{txt}</text></g>')

def qr_card(x, y, size, url):
    pad = size * 0.11
    return (f'<rect x="{x}" y="{y}" width="{size}" height="{size}" rx="{size*0.08}" fill="#ffffff"/>' +
            qr_path(url, x + pad, y + pad, size - 2 * pad))

def phone(x, y, w, rot=0):
    u = w / 100.0
    def t(px_, py_, txt, fs, fill, wt="500", anc="start"):
        return T(px_*u, py_*u, txt, fs*u, fill, wt, anc)
    g = f'<g transform="translate({x},{y}) rotate({rot})">'
    g += f'<rect x="{3*u}" y="{4*u}" width="{100*u}" height="{205*u}" rx="{13*u}" fill="#000000" opacity="0.22"/>'
    g += f'<rect width="{100*u}" height="{205*u}" rx="{13*u}" fill="#0c0a09"/>'
    g += f'<rect x="{5*u}" y="{5*u}" width="{90*u}" height="{195*u}" rx="{9*u}" fill="#f5f5f4"/>'
    g += f'<rect x="{5*u}" y="{5*u}" width="{90*u}" height="{26*u}" rx="{9*u}" fill="{LARANJA}"/>'
    g += f'<rect x="{5*u}" y="{20*u}" width="{90*u}" height="{11*u}" fill="{LARANJA}"/>'
    g += t(11, 16, "Quadra 1 · Hoje", 7, "#ffffff", "bold")
    g += t(11, 25.5, "Beach Tennis · 6 horários", 4.6, "#ffedd5")
    slots = [("07h", "Aula · Turma A", LARANJA, "#ffffff"),
             ("08h", "Locação · João", "#ffffff", CINZA),
             ("09h", "Livre", "#ffffff", CINZA_C),
             ("10h", "Torneio · Chaves", AMARELO, ESCURO),
             ("11h", "Aula · Kids", LARANJA_L, LARANJA_D)]
    yy = 38
    for tm, lbl, bg, fg in slots:
        g += t(10, yy + 10.5, tm, 5, CINZA, "bold")
        stroke = f' stroke="#e7e5e4" stroke-width="{0.8*u}"' if bg == "#ffffff" else ""
        g += f'<rect x="{24*u}" y="{yy*u}" width="{64*u}" height="{15*u}" rx="{7.5*u}" fill="{bg}"{stroke}/>'
        g += t(31, yy + 10, lbl, 5, fg, "bold" if bg != "#ffffff" else "500")
        yy += 23
    g += f'<rect x="{10*u}" y="{158*u}" width="{80*u}" height="{18*u}" rx="{6*u}" fill="{ESCURO}"/>'
    g += f'<circle cx="{18*u}" cy="{167*u}" r="{3.2*u}" fill="{VERDE}"/>'
    g += f'<path d="M{16.6*u},{167*u} l{1.1*u},{1.1*u} l{2*u},{-2.4*u}" fill="none" stroke="#ffffff" stroke-width="{0.9*u}" stroke-linecap="round" stroke-linejoin="round"/>'
    g += t(24.5, 169, "Pix recebido · R$ 120,00", 4.8, "#ffffff", "bold")
    g += f'<rect x="{38*u}" y="{190*u}" width="{24*u}" height="{2.4*u}" rx="{1.2*u}" fill="#d6d3d1"/>'
    g += '</g>'
    return g

# =====================================================================
# 1) PANFLETO A5 v2
# =====================================================================
W, H = 154, 216
u_pan = f"https://www.{SITE}/?utm_source=panfleto"

fr = DEFS + f'<rect width="{W}" height="{H}" fill="url(#sun)"/>'
fr += f'<rect x="92" y="0" width="62" height="52" fill="url(#dots)"/>'
fr += court(86, 118, 74, 84, 0.13, 0.7)
fr += wordmark(11, 11, 13, "#ffffff", ESCURO)
fr += pill_l(11, 31, "GESTÃO PARA ARENAS DE AREIA", 3.0, ESCURO, AMARELO, 0.7, 7)
fr += HL(11, 57, "TIRE SUA", 15, "#ffffff")
fr += HL(11, 74, "ARENA DO", 15, "#ffffff")
fr += HL(11, 91, "CADERNINHO.", 15, ESCURO)
fr += f'<rect x="12" y="96.5" width="26" height="2.2" rx="1.1" fill="{AMARELO}"/>'
fr += T(11, 106, "Agenda, mensalidades, check-in e torneios", 4.6, "#ffedd5", "500")
fr += T(11, 112.5, "Tudo num app só, por R$ 49,90/mês.", 4.6, "#ffedd5", "500")
fr += ball(83, 124, 6)
fr += phone(98, 116, 46, -5)
fr += qr_card(11, 124, 40, u_pan)
fr += T(56, 139, "Aponte", 5.8, "#ffffff", "bold")
fr += T(56, 146, "a câmera", 5.8, "#ffffff", "bold")
fr += T(56, 153.5, "e veja a arena", 3.9, "#ffedd5", "500")
fr += T(56, 158.5, "no automático.", 3.9, "#ffedd5", "500")
fr += T(11, 173, SITE, 6.4, "#ffffff", "bold", ls="0.2")
fr += T(11, 180, f"{WPP} · {INSTA}", 3.5, "#ffedd5", "500")
fr += f'<rect x="0" y="204" width="{W}" height="12" fill="{ESCURO}"/>'
fr += T(W/2, 211.5, "Beach Tennis · Padel · Futevôlei · Vôlei de Praia · Tênis", 3.4, CINZA_C, "500", "middle")

feats2 = [
 ("agenda", "Grade inteligente", "Aluno agenda, repõe e entra", "na fila de espera sozinho."),
 ("pix", "Pix e recorrência", "Mensalidade cai na conta.", "Inadimplência num painel só."),
 ("checkin", "Wellhub &amp; TotalPass", "Check-in integrado,", "recepção sem fila."),
 ("credito", "Créditos automáticos", "Cancelou cedo? Crédito", "na conta, sem drama."),
 ("torneio", "Torneios completos", "Chaves, inscrições,", "cobrança e ranking."),
 ("chat", "Comunidade no app", "Avisos, fotos e ranking.", "Alunos fazem o marketing."),
]
vs = DEFS + f'<rect width="{W}" height="{H}" fill="#ffffff"/>'
vs += f'<rect width="{W}" height="36" fill="{ESCURO}"/>'
vs += court(118, 5, 32, 26, 0.22, 0.5)
vs += HL(W/2, 16, "FEITO PRA QUEM VIVE", 7.2, "#ffffff", "middle")
vs += HL(W/2, 27, "DE QUADRA CHEIA.", 7.2, AMARELO, "middle")
i = 0
for k, tt, l1, l2 in feats2:
    cx = 11 + (i % 2) * 72
    cy = 44 + (i // 2) * 24
    vs += icon(k, cx, cy, 8)
    vs += T(cx + 17, cy + 5, tt, 4.3, ESCURO, "bold")
    vs += T(cx + 17, cy + 9.8, l1, 3.05, CINZA, "500")
    vs += T(cx + 17, cy + 13.6, l2, 3.05, CINZA, "500")
    i += 1
vs += f'<rect x="0" y="118" width="{W}" height="34" fill="url(#sunH)"/>'
vs += T(11, 133, "R$ 49,90/mês", 10.5, "#ffffff", "bold")
vs += T(11, 141, "menos que uma aula avulsa", 3.6, "#ffedd5", "500")
cy = 127
for c in ["1º mês grátis, sem cartão", "Alunos e turmas ilimitados", "Cancela quando quiser"]:
    vs += check(88, cy - 3.2, 4, "#ffffff")
    vs += T(94, cy, c, 3.7, "#ffffff", "500")
    cy += 7.4
vs += T(W/2, 163, "Comece em 3 passos", 5.6, ESCURO, "bold", "middle")
steps = [("1", "Cadastre quadras", "e turmas"), ("2", "Alunos baixam", "o app grátis"), ("3", "Agenda e cobrança", "rodam sozinhas")]
for j, (n, a, b2) in enumerate(steps):
    sx = 32 + j * 45
    vs += f'<circle cx="{sx}" cy="{172}" r="5" fill="{LARANJA_L}" stroke="{LARANJA}" stroke-width="0.7"/>'
    vs += T(sx, 173.8, n, 5, LARANJA_D, "bold", "middle")
    vs += T(sx, 183, a, 3.2, CINZA, "500", "middle")
    vs += T(sx, 187.2, b2, 3.2, CINZA, "500", "middle")
vs += f'<rect x="0" y="194" width="{W}" height="22" fill="{ESCURO}"/>'
vs += f'<rect x="11" y="197" width="18" height="18" rx="2" fill="#ffffff"/>'
vs += qr_path(u_pan, 12.5, 198.5, 15)
vs += T(34, 205, SITE, 5.2, "#ffffff", "bold")
vs += T(34, 211, f"{WPP} · {INSTA}", 3.4, CINZA_C, "500")
vs += ball(141, 205, 5.5)
save_pdf([svg(W, H, fr), svg(W, H, vs)], "panfleto-a5-frente-verso.pdf")

# =====================================================================
# 2) CARTAO DE VISITA v2 (96x56)
# =====================================================================
W, H = 96, 56
u_car = f"https://www.{SITE}/?utm_source=cartao"
cf = DEFS + f'<rect width="{W}" height="{H}" fill="{ESCURO}"/>'
cf += f'<rect x="30" y="-10" width="76" height="76" fill="url(#glow)"/>'
cf += court(64, 36, 34, 20, 0.15, 0.5)
cf += wordmark((96 - (15 + textw("ArenaHub", 8.64))) / 2, 13, 12, "#ffffff", LARANJA)
cf += T(48, 37, "Gestão para arenas de areia", 3.2, "#d6d3d1", "500", "middle")
cf += T(48, 45, SITE, 3.8, LARANJA, "bold", "middle", ls="0.3")
cf += ball(85, 11, 4.2)
cv = DEFS + f'<rect width="{W}" height="{H}" fill="#ffffff"/>'
cv += qr_card(8, 8, 37, u_car)
cv += T(26.5, 50, "aponte a câmera", 2.6, CINZA_C, "500", "middle")
cv += T(51, 16, "Tire sua arena", 5.0, ESCURO, "bold")
cv += T(51, 23, "do caderninho.", 5.0, LARANJA, "bold")
cv += T(51, 32, WPP, 3.0, CINZA, "500")
cv += T(51, 37.5, INSTA, 3.0, CINZA, "500")
cv += T(51, 43, SITE, 3.3, LARANJA_D, "bold")
cv += f'<rect x="0" y="52" width="{W}" height="4" fill="url(#sunH)"/>'
save_pdf([svg(W, H, cf), svg(W, H, cv)], "cartao-visita-frente-verso.pdf")

# =====================================================================
# 3) ADESIVO REDONDO v2 (54x54, corte 50)
# =====================================================================
W = H = 54
u_ade = f"https://www.{SITE}/?utm_source=adesivo"
ad = DEFS + f'<circle cx="27" cy="27" r="27" fill="url(#sunR)"/>'
ad += f'<circle cx="27" cy="27" r="24.5" fill="none" stroke="#ffffff" stroke-width="0.35" opacity="0.5"/>'
ad += wordmark_centered(27, 12.5, 6.2, "#ffffff", ESCURO)
ad += ball(44.5, 9.5, 2.6)
ad += f'<rect x="15" y="16" width="24" height="24" rx="2.5" fill="#ffffff"/>'
ad += qr_path(u_ade, 17, 18, 20)
ad += T(27, 46.5, SITE, 3.3, "#ffffff", "bold", "middle", ls="0.2")
save_pdf([svg(W, H, ad)], "adesivo-redondo-5cm.pdf")

# =====================================================================
# 4) CARTAZ CARRO v2 (A5 154x216)
# =====================================================================
W, H = 154, 216
u_carro = f"https://www.{SITE}/?utm_source=carro"
cz = DEFS + f'<rect width="{W}" height="{H}" fill="{ESCURO}"/>'
cz += f'<rect x="27" y="30" width="100" height="100" fill="url(#glow)"/>'
cz += court(102, 8, 46, 34, 0.13, 0.6)
cz += f'<rect x="0" y="0" width="36" height="60" fill="url(#dots)"/>'
cz += pill_c(W/2, 9, "UMA IDEIA PRA SUA CORRIDA", 3.1, LARANJA, "#ffffff", 0.9, 7)
cz += HL(W/2, 31, "TEM UMA ARENA", 11.2, "#ffffff", "middle")
cz += HL(W/2, 44, "DE BEACH, PADEL", 11.2, "#ffffff", "middle")
cz += HL(W/2, 57, "OU FUTEVÔLEI?", 11.2, AMARELO, "middle")
cz += T(W/2, 67, "Ou conhece quem tem? Isso aqui resolve a gestão dela.", 4.1, "#ffedd5", "500", "middle")
b_ = 74; s_ = 52; x_ = (W - s_) / 2
cz += qr_card(x_, b_, s_, u_carro)
for dx, dy, hv in [(x_-3, b_-3, 1), (x_+s_+3, b_-3, -1), (x_-3, b_+s_+3, 1), (x_+s_+3, b_+s_+3, -1)]:
    vy = 1 if dy < b_ else -1
    cz += (f'<path d="M{dx},{dy+vy*8} V{dy} H{dx+hv*8}" fill="none" stroke="{LARANJA}" '
           f'stroke-width="1.6" stroke-linecap="round"/>')
cz += T(W/2, 137, "Aponte a câmera do celular", 4.6, "#ffffff", "bold", "middle")
cz += f'<rect x="0" y="144" width="{W}" height="15" fill="{AMARELO}"/>'
cz += T(W/2, 153.3, "Quem fez isso? O motorista. Pergunta pra ele!", 4.5, ESCURO, "bold", "middle")
cz += ball(22, 172, 6.5)
cz += T(W/2, 170, "Agenda · Pix · Check-in · Torneios", 4.7, "#ffffff", "bold", "middle")
cz += T(W/2, 177.5, "R$ 49,90/mês · 1º mês grátis, sem cartão", 3.9, LARANJA_L, "500", "middle")
cz += T(W/2, 191, SITE, 6.2, LARANJA, "bold", "middle", ls="0.2")
cz += T(W/2, 198, f"{WPP} · {INSTA}", 3.3, CINZA_C, "500", "middle")
cz += f'<rect x="0" y="206" width="{W}" height="10" fill="url(#sunH)"/>'
cz += T(W/2, 212.5, "Beach Tennis · Padel · Futevôlei · Vôlei de Praia", 3.2, "#ffffff", "500", "middle")
save_pdf([svg(W, H, cz)], "cartaz-carro-banco-a5.pdf")

# =====================================================================
# 5) CAMISA v2 (estampas transparentes + preview)
# =====================================================================
u_cam = f"https://www.{SITE}/?utm_source=camisa"
fw = 25 + textw("ArenaHub", 14.4)
fx = (110 - fw) / 2
fre_b = wordmark(fx, 0, 20, "#ffffff", LARANJA) + T(55, 31, "arenahub.website", 4.4, "#d6d3d1", "500", "middle")
save_png(f'<svg xmlns="http://www.w3.org/2000/svg" width="110mm" height="36mm" viewBox="0 0 110 36">{fre_b}</svg>',
         "camisa-estampa-frente-transparente.png", 110)

CW = 300
cos_b = pill_c(CW/2, 2, "GESTÃO PARA ARENAS DE AREIA", 6.6, LARANJA, "#ffffff", 2, 16)
cos_b += court(30, 46, 240, 138, 0.25, 1.4)
wm_w = 60 + textw("ArenaHub", 38.88)
wm_x = (CW - wm_w) / 2
cos_b += wordmark(wm_x, 62, 54, "#ffffff", LARANJA)
cos_b += ball(min(wm_x + wm_w + 14, CW - 14), 58, 11)
cos_b += HL(CW/2, 156, "SUA ARENA NO AUTOMÁTICO", 12, "#ffffff", "middle")
cos_b += qr_card((CW - 70) / 2, 176, 70, u_cam)
cos_b += T(CW/2, 260, "aponte a câmera", 6, "#d6d3d1", "500", "middle")
cos_b += T(CW/2, 286, SITE, 12, AMARELO, "bold", "middle", ls="0.5")
save_png(f'<svg xmlns="http://www.w3.org/2000/svg" width="300mm" height="300mm" viewBox="0 0 300 300">{DEFS}{cos_b}</svg>',
         "camisa-estampa-costas-transparente.png", 300)

W, H = 154, 216
p1 = DEFS + f'<rect width="{W}" height="{H}" fill="#171412"/>'
p1 += T(W/2, 20, "CAMISA PRETA · FRENTE", 5, CINZA_C, "bold", "middle", ls="1")
p1 += f'<g transform="translate(30,80) scale(0.85)">{fre_b}</g>'
p1 += T(W/2, 150, "Estampa no peito esquerdo (~10 cm) · DTF", 3.6, CINZA, "500", "middle")
p2 = DEFS + f'<rect width="{W}" height="{H}" fill="#171412"/>'
p2 += T(W/2, 16, "CAMISA PRETA · COSTAS", 5, CINZA_C, "bold", "middle", ls="1")
p2 += f'<g transform="translate(20,28) scale(0.38)">{cos_b}</g>'
p2 += T(W/2, 156, "Estampa costas (~30 cm de largura) · DTF", 3.6, CINZA, "500", "middle")
save_pdf([svg(W, H, p1), svg(W, H, p2)], "camisa-preta-preview.pdf")
print("PRINT V2 COMPLETO")
