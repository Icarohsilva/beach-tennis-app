# -*- coding: utf-8 -*-
"""Social v2: WhatsApp post/status + LinkedIn post/capa (px)."""
import os, qrcode, cairosvg

OUT = "/sessions/magical-charming-gates/mnt/outputs"
LARANJA, LARANJA_D, LARANJA_L = "#ea580c", "#9a3412", "#ffedd5"
ESCURO, CINZA, CINZA_C = "#1c1917", "#57534e", "#a8a29e"
AMARELO, VERDE = "#facc15", "#22c55e"
SITE, WPP, INSTA = "arenahub.website", "WhatsApp (31) 99631-3913", "@arenahub.app"

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
 '<linearGradient id="sunH" x1="0" y1="0" x2="1" y2="0">'
 '<stop offset="0" stop-color="#fb923c"/><stop offset="0.55" stop-color="#ea580c"/><stop offset="1" stop-color="#c2410c"/></linearGradient>'
 '<radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">'
 '<stop offset="0" stop-color="#ea580c" stop-opacity="0.45"/><stop offset="1" stop-color="#ea580c" stop-opacity="0"/></radialGradient>'
 '<pattern id="dots" width="34" height="34" patternUnits="userSpaceOnUse">'
 '<circle cx="7" cy="7" r="5.5" fill="#ffffff" opacity="0.10"/></pattern>'
 '</defs>')

def qr_path(url, x, y, size, color=ESCURO):
    q = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=0)
    q.add_data(url); q.make(fit=True)
    m = q.get_matrix(); n = len(m); s = size / n
    d = []
    for r in range(n):
        for c in range(n):
            if m[r][c]:
                d.append(f"M{x+c*s:.2f},{y+r*s:.2f}h{s:.2f}v{s:.2f}h{-s:.2f}z")
    return f'<path d="{"".join(d)}" fill="{color}"/>'

def qr_card(x, y, size, url):
    pad = size * 0.11
    return (f'<rect x="{x}" y="{y}" width="{size}" height="{size}" rx="{size*0.08}" fill="#ffffff"/>' +
            qr_path(url, x + pad, y + pad, size - 2 * pad))

def symbol(x, y, h, box=LARANJA, letter="#ffffff", bl=AMARELO, op=1):
    s = h / 100.0
    return (f'<g transform="translate({x},{y}) scale({s})" opacity="{op}">'
            f'<rect width="100" height="100" rx="26" fill="{box}"/>'
            f'<text x="46" y="76" font-family="Poppins" font-weight="bold" font-size="64" '
            f'fill="{letter}" text-anchor="middle">A</text>'
            f'<circle cx="74" cy="32" r="9" fill="{bl}"/></g>')

def lockup(x, y, h, hub=LARANJA):
    fs = h * 0.72
    return (symbol(x, y, h) +
            f'<text x="{x+h*1.25}" y="{y+h*0.74}" font-family="Poppins" font-weight="bold" font-size="{fs}">'
            f'<tspan fill="#ffffff">Arena</tspan><tspan fill="{hub}">Hub</tspan></text>')

def T(x, y, txt, fs, fill, weight="normal", anchor="start", ls="0"):
    return (f'<text x="{x}" y="{y}" font-family="Poppins" font-weight="{weight}" '
            f'font-size="{fs}" fill="{fill}" text-anchor="{anchor}" letter-spacing="{ls}">{txt}</text>')

def HL(x, y, txt, fs, fill, anchor="start"):
    return (f'<g transform="translate({x},{y}) skewX(-8)">'
            f'<text x="0" y="0" font-family="Poppins" font-weight="bold" font-size="{fs}" '
            f'fill="{fill}" text-anchor="{anchor}" letter-spacing="1">{txt}</text></g>')

def check(x, y, s, color=VERDE, sw=6):
    return (f'<path d="M{x},{y+s*0.55} l{s*0.32},{s*0.32} l{s*0.6},{-s*0.75}" fill="none" '
            f'stroke="{color}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round"/>')

def court(x, y, w, h, op=0.12, sw=5):
    st = f'fill="none" stroke="#ffffff" stroke-width="{sw}" opacity="{op}"'
    return (f'<g><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="14" {st}/>'
            f'<path d="M{x+w/2},{y} V{y+h}" {st}/>'
            f'<path d="M{x+w*0.25},{y+h*0.28} H{x+w*0.75} M{x+w*0.25},{y+h*0.72} H{x+w*0.75}" {st}/></g>')

def ball(cx, cy, r, op=1):
    sw = r * 0.16
    return (f'<g opacity="{op}"><circle cx="{cx}" cy="{cy}" r="{r}" fill="{AMARELO}"/>'
            f'<path d="M{cx-r*0.92},{cy-r*0.45} Q{cx},{cy+r*0.12} {cx+r*0.92},{cy-r*0.45}" fill="none" stroke="#ca8a04" stroke-width="{sw}" stroke-linecap="round"/>'
            f'<path d="M{cx-r*0.92},{cy+r*0.45} Q{cx},{cy-r*0.12} {cx+r*0.92},{cy+r*0.45}" fill="none" stroke="#ca8a04" stroke-width="{sw}" stroke-linecap="round"/>'
            f'<circle cx="{cx-r*0.35}" cy="{cy-r*0.45}" r="{r*0.16}" fill="#fde68a" opacity="0.9"/></g>')

def phone(x, y, w, rot=0):
    u = w / 100.0
    def t(px_, py_, txt, fs, fill, wt="500"):
        return T(px_*u, py_*u, txt, fs*u, fill, wt)
    g = f'<g transform="translate({x},{y}) rotate({rot})">'
    g += f'<rect x="{3*u}" y="{4*u}" width="{100*u}" height="{205*u}" rx="{13*u}" fill="#000000" opacity="0.25"/>'
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

def save(body, w, h, name):
    s = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
         f'viewBox="0 0 {w} {h}">{body}</svg>')
    cairosvg.svg2png(bytestring=s.encode(), write_to=os.path.join(OUT, name),
                     output_width=w, output_height=h)
    print("ok", name)

U_WPP = f"https://www.{SITE}/?utm_source=whatsapp"
U_LKD = f"https://www.{SITE}/?utm_source=linkedin"

# ============== WHATSAPP POST 1080x1080 ==============
W, H = 1080, 1080
b = DEFS + f'<rect width="{W}" height="{H}" fill="{ESCURO}"/>'
b += f'<rect x="380" y="180" width="700" height="700" fill="url(#glow)"/>'
b += f'<rect x="700" y="0" width="380" height="300" fill="url(#dots)"/>'
b += court(660, 200, 380, 250, 0.10)
b += lockup(72, 60, 88)
b += ball(990, 260, 38, 0.95)
b += HL(72, 320, "TIRE SUA ARENA", 84, "#ffffff")
b += HL(72, 424, "DO CADERNINHO.", 84, LARANJA)
b += f'<rect x="72" y="452" width="150" height="12" rx="6" fill="{AMARELO}"/>'
b += T(72, 526, "Agenda, Pix, check-in e torneios", 39, LARANJA_L, "500")
b += T(72, 578, "Tudo num app só.", 39, LARANJA_L, "500")
y = 660
for c in ["Aluno agenda e repõe sozinho", "Pix e cartão recorrente", "Check-in Wellhub &amp; TotalPass", "Torneios com ranking"]:
    b += check(72, y - 28, 32)
    b += T(122, y, c, 35, "#ffffff", "500")
    y += 58
b += f'<rect x="72" y="892" width="560" height="62" rx="31" fill="{AMARELO}"/>'
b += T(352, 933, "R$ 49,90/mês · 1º mês grátis", 31, ESCURO, "bold", "middle")
b += f'<rect x="0" y="970" width="{W}" height="110" fill="url(#sunH)"/>'
b += qr_card(884, 930, 124, U_WPP)
b += T(72, 1018, SITE, 42, "#ffffff", "bold")
b += T(72, 1056, f"{WPP} · {INSTA}", 26, "#ffedd5", "500")
b += phone(790, 470, 210, -4)
save(b, W, H, "flyer-whatsapp-post-1080.png")

# ============== WHATSAPP STATUS 1080x1920 ==============
W, H = 1080, 1920
b = DEFS + f'<rect width="{W}" height="{H}" fill="{ESCURO}"/>'
b += f'<rect x="240" y="560" width="760" height="900" fill="url(#glow)"/>'
b += f'<rect x="660" y="0" width="420" height="340" fill="url(#dots)"/>'
b += court(150, 700, 780, 500, 0.10)
b += lockup(84, 90, 96)
b += ball(920, 420, 46, 0.95)
b += HL(84, 350, "TIRE SUA ARENA", 86, "#ffffff")
b += HL(84, 456, "DO CADERNINHO.", 86, LARANJA)
b += f'<rect x="84" y="490" width="160" height="12" rx="6" fill="{AMARELO}"/>'
b += T(84, 562, "Agenda, mensalidades, check-in e", 42, LARANJA_L, "500")
b += T(84, 616, "torneios. Tudo num app só.", 42, LARANJA_L, "500")
b += phone(340, 690, 400, -4)
b += f'<rect x="220" y="1560" width="640" height="66" rx="33" fill="{AMARELO}"/>'
b += T(540, 1604, "R$ 49,90/mês · 1º mês grátis, sem cartão", 30, ESCURO, "bold", "middle")
b += qr_card(300, 1650, 118, U_WPP)
b += T(444, 1700, "Aponte a câmera", 36, "#ffffff", "bold")
b += T(444, 1744, SITE, 34, LARANJA, "bold")
b += f'<rect x="0" y="1800" width="{W}" height="120" fill="url(#sunH)"/>'
b += T(W/2, 1852, f"{WPP} · {INSTA}", 31, "#ffffff", "bold", "middle")
b += T(W/2, 1896, "Beach Tennis · Padel · Futevôlei · Vôlei de Praia", 27, "#ffedd5", "500", "middle")
save(b, W, H, "flyer-whatsapp-status-1080x1920.png")

# ============== LINKEDIN POST 1200x1200 ==============
W, H = 1200, 1200
b = DEFS + f'<rect width="{W}" height="{H}" fill="{ESCURO}"/>'
b += f'<rect x="420" y="120" width="760" height="760" fill="url(#glow)"/>'
b += f'<rect x="780" y="0" width="420" height="280" fill="url(#dots)"/>'
b += court(720, 130, 440, 280, 0.10)
b += lockup(80, 64, 88)
b += ball(1120, 240, 42, 0.95)
b += pill_l(80, 198, "1,5 MILHÃO DE PRATICANTES NO BRASIL", 26, AMARELO, ESCURO, 1)
b += HL(80, 358, "O CADERNINHO", 92, "#ffffff")
b += HL(80, 468, "NÃO ESCALA.", 92, LARANJA)
b += T(80, 548, "O beach tennis explodiu. A gestão da sua arena precisa", 38, LARANJA_L, "500")
b += T(80, 598, "acompanhar: agenda, Pix, check-in e torneios.", 38, LARANJA_L, "500")
stats = [("10 mil+", "quadras no Brasil", 220), ("R$ 49,90", "por mês, tudo incluso", 560), ("1º mês", "grátis, sem cartão", 860)]
for n, lb, sx in stats:
    b += T(sx, 760, n, 60, AMARELO, "bold", "middle")
    b += T(sx, 806, lb, 27, "#d6d3d1", "500", "middle")
b += phone(1000, 610, 180, -4)
b += f'<rect x="0" y="1080" width="{W}" height="120" fill="url(#sunH)"/>'
b += qr_card(80, 1035, 124, U_LKD)
b += T(230, 1136, SITE, 42, "#ffffff", "bold")
b += T(230, 1172, "Feito no Brasil pra arenas de areia", 25, "#ffedd5", "500")
b += T(1120, 1146, "R$ 49,90/mês", 34, "#ffffff", "bold", "end")
save(b, W, H, "linkedin-post-1200.png")

# ============== LINKEDIN CAPA 1584x396 ==============
W, H = 1584, 396
b = DEFS + f'<rect width="{W}" height="{H}" fill="{ESCURO}"/>'
b += f'<rect x="500" y="-100" width="700" height="600" fill="url(#glow)"/>'
b += court(60, 150, 400, 200, 0.13)
b += ball(200, 90, 52, 0.9)
b += f'<rect x="0" y="0" width="300" height="120" fill="url(#dots)"/>'
b += lockup(620, 84, 96)
b += T(620, 250, "Gestão completa para arenas de areia", 34, "#d6d3d1", "500")
cx = 620
for ch in ["Agenda", "Pix &amp; mensalidades", "Check-in", "Torneios"]:
    wch = textw(ch, 22, "500") + 44
    b += f'<rect x="{cx}" y="286" width="{wch}" height="48" rx="24" fill="#292524"/>'
    b += T(cx + wch/2, 317, ch, 22, "#ffffff", "500", "middle")
    cx += wch + 16
b += T(1504, 178, SITE, 38, LARANJA, "bold", "end")
b += T(1504, 120, "R$ 49,90/mês · 1º mês grátis", 26, AMARELO, "bold", "end")
save(b, W, H, "linkedin-capa-1584x396.png")
print("SOCIAL V2 COMPLETO")
