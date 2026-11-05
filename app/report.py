"""Fiche compagnon en PDF (fpdf2) : photo, statistiques, sommets / cols / lieux et sorties d'une période."""
import io
import os
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from fpdf import FPDF
from fpdf.fonts import FontFace
from PIL import Image, ImageDraw, ImageOps

from . import config

ACCENT = (31, 111, 92)
ACCENT_SOFT = (226, 239, 233)
INK = (28, 35, 32)
MUTED = (106, 115, 110)
LINE = (226, 224, 216)
KIND_LABEL = {"sommet": "Sommet", "col": "Col", "lieu": "Lieu"}
KIND_COLOR = {"sommet": (179, 84, 30), "col": (103, 65, 217), "lieu": (12, 133, 153)}
MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."]

# Polices Unicode (accents, cyrillique…), avec une police de secours pour le chinois.
FONT_CANDIDATES = [
    (r"C:\Windows\Fonts\arial.ttf", r"C:\Windows\Fonts\arialbd.ttf"),
    (r"C:\Windows\Fonts\segoeui.ttf", r"C:\Windows\Fonts\segoeuib.ttf"),
    ("/System/Library/Fonts/Supplemental/Arial.ttf", "/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
    ("/Library/Fonts/Arial.ttf", "/Library/Fonts/Arial Bold.ttf"),
    ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
]
CJK_CANDIDATES = [
    r"C:\Windows\Fonts\simhei.ttf", r"C:\Windows\Fonts\Deng.ttf", r"C:\Windows\Fonts\msyh.ttc",
    "/System/Library/Fonts/PingFang.ttc", "/System/Library/Fonts/STHeiti Light.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc",
]


def _num(v, decimals=0):
    s = f"{v:,.{decimals}f}".replace(",", " ").replace(".", ",")
    return s


def fmt_km(m):
    return f"{_num((m or 0) / 1000, 1)} km"


def fmt_m(m):
    return "–" if m is None else f"{_num(m)} m"


def fmt_dur(s):
    if not s:
        return "–"
    tm = round(s / 60)
    h, m = divmod(tm, 60)
    return f"{h} h {m:02d}" if h else f"{m} min"


def fmt_date(iso):
    if not iso:
        return "–"
    if len(iso) == 10:
        d = datetime.strptime(iso, "%Y-%m-%d")
    else:
        d = datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(ZoneInfo(config.LOCAL_TIMEZONE))
    return f"{d.day} {MONTHS[d.month - 1]} {d.year}"


def period_label(prof):
    ys = prof["years_selected"]
    if not ys:
        return "Aucune sortie sur la période"
    if prof["all_years"]:
        return f"Toutes nos sorties ({ys[0]}–{ys[-1]})" if len(ys) > 1 else f"Toutes nos sorties ({ys[0]})"
    if len(ys) == 1:
        return f"Année {ys[0]}"
    consecutive = ys == list(range(ys[0], ys[-1] + 1))
    return f"Années {ys[0]}–{ys[-1]}" if consecutive else "Années " + ", ".join(map(str, ys))


def _round_photo(path, size=360):
    """Photo recadrée en disque (PNG avec transparence) pour l'en-tête."""
    img = ImageOps.fit(Image.open(path).convert("RGB"), (size, size), Image.LANCZOS)
    mask = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size * 4 - 1, size * 4 - 1), fill=255)
    out = Image.new("RGBA", (size, size))
    out.paste(img, (0, 0), mask.resize((size, size), Image.LANCZOS))
    buf = io.BytesIO()
    out.save(buf, "PNG")
    buf.seek(0)
    return buf


def _initials_disc(name, size=360):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse((0, 0, size - 1, size - 1), fill=(255, 255, 255, 60))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    buf.seek(0)
    return buf


class Report(FPDF):
    def __init__(self):
        super().__init__(format="A4")
        self.set_margins(16, 16, 16)
        self.set_auto_page_break(True, 18)
        self.font_name = "helvetica"
        self.unicode = False
        for reg, bold in FONT_CANDIDATES:
            if os.path.exists(reg) and os.path.exists(bold):
                self.add_font("Main", "", reg)
                self.add_font("Main", "B", bold)
                self.font_name, self.unicode = "Main", True
                break
        if self.unicode:
            for i, p in enumerate(CJK_CANDIDATES):
                if os.path.exists(p):
                    try:
                        kw = {"collection_font_number": 0} if p.lower().endswith(".ttc") else {}
                        self.add_font("Fallback", "", p, **kw)
                        self.set_fallback_fonts(["Fallback"])
                        break
                    except Exception:
                        continue

    def t(self, text):
        """Sans police Unicode : remplace ce que les polices de base ne savent pas afficher."""
        text = str(text if text is not None else "")
        if self.unicode:
            return text
        text = (text.replace("’", "'").replace("…", "...").replace("–", "-").replace("—", "-")
                .replace("\u202f", " ").replace("\xa0", " ").replace("·", "-").replace("œ", "oe"))
        return text.encode("latin-1", "replace").decode("latin-1")

    def font(self, size, bold=False, color=INK):
        self.set_font(self.font_name, "B" if bold else "", size)
        self.set_text_color(*color)

    def footer(self):
        self.set_y(-12)
        self.font(8, color=MUTED)
        self.cell(0, 5, self.t(f"Rando Tracker · fiche générée le {fmt_date(datetime.now().date().isoformat())}"), align="L")
        self.cell(0, 5, f"{self.page_no()}/{{nb}}", align="R")

    def section(self, title):
        if self.get_y() > self.h - 50:
            self.add_page()
        self.ln(4)
        self.font(13, True, ACCENT)
        self.cell(0, 8, self.t(title), new_x="LMARGIN", new_y="NEXT")
        self.set_draw_color(*ACCENT)
        self.set_line_width(0.5)
        self.line(self.l_margin, self.get_y(), self.l_margin + 24, self.get_y())
        self.ln(3)


def build_person_report(prof, photo_path: Path | None) -> bytes:
    pdf = Report()
    pdf.alias_nb_pages()
    pdf.add_page()
    person, st = prof["person"], prof["stats"]
    W = pdf.w - pdf.l_margin - pdf.r_margin

    # ---- en-tête
    band_h = 50
    pdf.set_fill_color(*ACCENT)
    pdf.rect(0, 0, pdf.w, band_h, "F")
    px, py, ps = pdf.l_margin, 8, 34
    if photo_path and Path(photo_path).exists():
        pdf.set_fill_color(255, 255, 255)
        pdf.ellipse(px - 1, py - 1, ps + 2, ps + 2, "F")
        pdf.image(_round_photo(photo_path), px, py, ps, ps)
    else:
        pdf.set_fill_color(255, 255, 255)
        pdf.ellipse(px, py, ps, ps, "F")
        initials = "".join(w[0] for w in person["name"].split()[:2]).upper()
        pdf.font(22, True, ACCENT)
        pdf.set_xy(px, py + ps / 2 - 6)
        pdf.cell(ps, 12, pdf.t(initials), align="C")
    tx = px + ps + 8
    pdf.set_xy(tx, py + 3)
    pdf.font(24, True, (255, 255, 255))
    pdf.cell(W - (tx - pdf.l_margin), 11, pdf.t(person["name"]), new_x="LEFT", new_y="NEXT")
    pdf.font(12, False, (225, 240, 234))
    pdf.cell(W - (tx - pdf.l_margin), 7, pdf.t(f"Randonnées ensemble · {period_label(prof)}"), new_x="LEFT", new_y="NEXT")
    if st["first"]:
        span = fmt_date(st["first"]) if st["first"][:10] == (st["last"] or "")[:10] else f"du {fmt_date(st['first'])} au {fmt_date(st['last'])}"
        pdf.font(10, False, (200, 228, 218))
        pdf.cell(W - (tx - pdf.l_margin), 6, pdf.t(span))
    pdf.set_y(band_h + 8)

    # ---- chiffres clés
    tiles = [
        (str(st["count"]), "sortie" + ("s" if st["count"] > 1 else "")),
        (fmt_km(st["distance_m"]), "parcourus"),
        (fmt_m(st["ele_gain"]), "de dénivelé positif"),
        (fmt_dur(st["moving_s"]), "en mouvement"),
    ]
    gap = 4
    tw = (W - gap * 3) / 4
    y0 = pdf.get_y()
    for i, (v, l) in enumerate(tiles):
        x = pdf.l_margin + i * (tw + gap)
        pdf.set_fill_color(*ACCENT_SOFT)
        pdf.rect(x, y0, tw, 22, "F")
        pdf.set_xy(x + 4, y0 + 3)
        pdf.font(16, True, INK)
        pdf.cell(tw - 8, 9, pdf.t(v))
        pdf.set_xy(x + 4, y0 + 13)
        pdf.font(9, False, MUTED)
        pdf.cell(tw - 8, 5, pdf.t(l))
    pdf.set_y(y0 + 26)
    pc = st["places"]
    extra = []
    if st["ele_max"] is not None:
        extra.append(f"Plus haut point atteint ensemble : {fmt_m(st['ele_max'])}")
    counts = [f"{pc[k]} {lab}{'s' if pc[k] > 1 else ''}" for k, lab in (("sommet", "sommet"), ("col", "col"), ("lieu", "lieu marquant")) if pc[k]]
    if counts:
        extra.append(", ".join(counts))
    if extra:
        pdf.font(10, False, MUTED)
        pdf.multi_cell(W, 5, pdf.t(" · ".join(extra)), new_x="LMARGIN", new_y="NEXT")

    head_style = FontFace(emphasis="BOLD", color=(255, 255, 255), fill_color=ACCENT)

    def table(headings, rows, widths, aligns):
        pdf.font(9.5)
        pdf.set_draw_color(*LINE)
        pdf.set_line_width(0.2)
        with pdf.table(col_widths=widths, text_align=aligns, headings_style=head_style, line_height=6.2,
                       cell_fill_color=(248, 247, 243), cell_fill_mode="ROWS", borders_layout="HORIZONTAL_LINES",
                       padding=(1.2, 2)) as tbl:
            r = tbl.row()
            for h in headings:
                r.cell(pdf.t(h))
            for row in rows:
                r = tbl.row()
                for c in row:
                    r.cell(pdf.t(c))

    # ---- par année
    if len(prof["per_year"]) > 1:
        pdf.section("Année par année")
        table(["Année", "Sorties", "Distance", "Dénivelé +", "En mouvement"],
              [[str(y["year"]), str(y["count"]), fmt_km(y["distance_m"]) if y["count"] else "–",
                fmt_m(y["ele_gain"]) if y["count"] else "–", fmt_dur(y["moving_s"])]
               for y in prof["per_year"]],
              (20, 16, 22, 22, 22), ("LEFT", "RIGHT", "RIGHT", "RIGHT", "RIGHT"))

    # ---- sommets, cols, lieux
    pdf.section("Sommets, cols et lieux marquants")
    if prof["places"]:
        table(["Type", "Nom", "Altitude", "Date", "Sortie"],
              [[KIND_LABEL.get(x["kind"], x["kind"]), x["name"], fmt_m(x["ele"]), fmt_date(x["date"]), x.get("hike_name") or "—"]
               for x in prof["places"]],
              (19, 44, 17, 23, 40), ("LEFT", "LEFT", "RIGHT", "LEFT", "LEFT"))
    else:
        pdf.font(10, False, MUTED)
        pdf.multi_cell(W, 5, pdf.t("Aucun sommet, col ou lieu marquant enregistré sur cette période."), new_x="LMARGIN", new_y="NEXT")

    # ---- sorties
    pdf.section("Nos sorties")
    if prof["hikes"]:
        table(["Date", "Sortie", "Distance", "D+", "Durée"],
              [[fmt_date(h["start_time"]), h["name"], fmt_km(h["distance_m"]), fmt_m(h["ele_gain"]),
                fmt_dur(h["moving_s"] if h["moving_s"] is not None else h["duration_s"])] for h in prof["hikes"]],
              (22, 62, 18, 16, 16), ("LEFT", "LEFT", "RIGHT", "RIGHT", "RIGHT"))
    else:
        pdf.font(10, False, MUTED)
        pdf.multi_cell(W, 5, pdf.t("Aucune sortie sur cette période."), new_x="LMARGIN", new_y="NEXT")

    return bytes(pdf.output())
