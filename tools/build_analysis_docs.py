from __future__ import annotations

import os
from pathlib import Path
from typing import Iterable, Sequence

from PIL import Image, ImageDraw, ImageFont

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor


ROOT = Path(r"D:\hethongthongtin")
OUT = ROOT / "word_documents"
ASSETS = ROOT / "tools" / "doc_assets"
OUT.mkdir(parents=True, exist_ok=True)
ASSETS.mkdir(parents=True, exist_ok=True)


# Resolved preset: standard_business_brief
PAGE_WIDTH = Inches(8.5)
PAGE_HEIGHT = Inches(11)
MARGIN = Inches(1)
CONTENT_DXA = 9360
TABLE_INDENT_DXA = 120
FONT = "Calibri"
NAVY = "0B2545"
BLUE = "2E74B5"
DARK_BLUE = "1F4D78"
MUTED = "5B6573"
LIGHT_BLUE = "E8EEF5"
LIGHT_GRAY = "F2F4F7"
PALE_BLUE = "EDF5FC"
PALE_GOLD = "FFF4D6"
PALE_RED = "FCE8E6"
GREEN = "2E7D32"
GOLD = "9A6A00"
RED = "9B1C1C"
WHITE = "FFFFFF"
BLACK = "111111"


def set_cell_shading(cell, fill: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_margins(cell, top=80, start=120, bottom=80, end=120) -> None:
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for margin, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tc_mar.find(qn(f"w:{margin}"))
        if node is None:
            node = OxmlElement(f"w:{margin}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def set_table_borders(table, color="B8C2CC", size="6") -> None:
    tbl_pr = table._tbl.tblPr
    borders = tbl_pr.find(qn("w:tblBorders"))
    if borders is None:
        borders = OxmlElement("w:tblBorders")
        tbl_pr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        tag = borders.find(qn(f"w:{edge}"))
        if tag is None:
            tag = OxmlElement(f"w:{edge}")
            borders.append(tag)
        tag.set(qn("w:val"), "single")
        tag.set(qn("w:sz"), size)
        tag.set(qn("w:space"), "0")
        tag.set(qn("w:color"), color)


def set_table_geometry(table, widths_dxa: Sequence[int]) -> None:
    assert sum(widths_dxa) == CONTENT_DXA, (widths_dxa, sum(widths_dxa))
    table.autofit = False
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    tbl_pr = table._tbl.tblPr

    layout = tbl_pr.find(qn("w:tblLayout"))
    if layout is None:
        layout = OxmlElement("w:tblLayout")
        tbl_pr.append(layout)
    layout.set(qn("w:type"), "fixed")

    tbl_w = tbl_pr.find(qn("w:tblW"))
    if tbl_w is None:
        tbl_w = OxmlElement("w:tblW")
        tbl_pr.append(tbl_w)
    tbl_w.set(qn("w:w"), str(CONTENT_DXA))
    tbl_w.set(qn("w:type"), "dxa")

    tbl_ind = tbl_pr.find(qn("w:tblInd"))
    if tbl_ind is None:
        tbl_ind = OxmlElement("w:tblInd")
        tbl_pr.append(tbl_ind)
    tbl_ind.set(qn("w:w"), str(TABLE_INDENT_DXA))
    tbl_ind.set(qn("w:type"), "dxa")

    grid = table._tbl.tblGrid
    for child in list(grid):
        grid.remove(child)
    for width in widths_dxa:
        col = OxmlElement("w:gridCol")
        col.set(qn("w:w"), str(width))
        grid.append(col)

    for row in table.rows:
        for idx, cell in enumerate(row.cells):
            width = widths_dxa[idx]
            cell.width = Inches(width / 1440)
            tc_pr = cell._tc.get_or_add_tcPr()
            tc_w = tc_pr.find(qn("w:tcW"))
            if tc_w is None:
                tc_w = OxmlElement("w:tcW")
                tc_pr.append(tc_w)
            tc_w.set(qn("w:w"), str(width))
            tc_w.set(qn("w:type"), "dxa")
            set_cell_margins(cell)
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER


def repeat_header(row) -> None:
    tr_pr = row._tr.get_or_add_trPr()
    tbl_header = OxmlElement("w:tblHeader")
    tbl_header.set(qn("w:val"), "true")
    tr_pr.append(tbl_header)


def set_keep_with_next(paragraph, value=True) -> None:
    paragraph.paragraph_format.keep_with_next = value


def set_run_font(run, size=None, color=None, bold=None, italic=None, name=FONT) -> None:
    run.font.name = name
    run._element.get_or_add_rPr().rFonts.set(qn("w:ascii"), name)
    run._element.get_or_add_rPr().rFonts.set(qn("w:hAnsi"), name)
    run._element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), name)
    if size is not None:
        run.font.size = Pt(size)
    if color:
        run.font.color.rgb = RGBColor.from_string(color)
    if bold is not None:
        run.bold = bold
    if italic is not None:
        run.italic = italic


def add_page_number(paragraph) -> None:
    paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    run = paragraph.add_run("Trang ")
    set_run_font(run, size=9, color=MUTED)
    fld = OxmlElement("w:fldSimple")
    fld.set(qn("w:instr"), "PAGE")
    paragraph._p.append(fld)


def configure_document(doc: Document, running_label: str) -> None:
    section = doc.sections[0]
    section.page_width = PAGE_WIDTH
    section.page_height = PAGE_HEIGHT
    section.top_margin = MARGIN
    section.right_margin = MARGIN
    section.bottom_margin = MARGIN
    section.left_margin = MARGIN
    section.header_distance = Inches(0.492)
    section.footer_distance = Inches(0.492)

    styles = doc.styles
    normal = styles["Normal"]
    normal.font.name = FONT
    normal._element.rPr.rFonts.set(qn("w:ascii"), FONT)
    normal._element.rPr.rFonts.set(qn("w:hAnsi"), FONT)
    normal._element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
    normal.font.size = Pt(11)
    normal.font.color.rgb = RGBColor.from_string(BLACK)
    normal.paragraph_format.space_before = Pt(0)
    normal.paragraph_format.space_after = Pt(6)
    normal.paragraph_format.line_spacing = 1.10

    for style_name, size, color, before, after in (
        ("Heading 1", 16, BLUE, 16, 8),
        ("Heading 2", 13, BLUE, 12, 6),
        ("Heading 3", 12, DARK_BLUE, 8, 4),
    ):
        style = styles[style_name]
        style.font.name = FONT
        style._element.rPr.rFonts.set(qn("w:ascii"), FONT)
        style._element.rPr.rFonts.set(qn("w:hAnsi"), FONT)
        style._element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
        style.font.size = Pt(size)
        style.font.bold = True
        style.font.color.rgb = RGBColor.from_string(color)
        style.paragraph_format.space_before = Pt(before)
        style.paragraph_format.space_after = Pt(after)
        style.paragraph_format.keep_with_next = True

    if "Figure Caption" not in styles:
        cap = styles.add_style("Figure Caption", WD_STYLE_TYPE.PARAGRAPH)
    else:
        cap = styles["Figure Caption"]
    cap.font.name = FONT
    cap.font.size = Pt(9)
    cap.font.italic = True
    cap.font.color.rgb = RGBColor.from_string(MUTED)
    cap.paragraph_format.space_before = Pt(4)
    cap.paragraph_format.space_after = Pt(8)
    cap.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER
    cap.paragraph_format.keep_with_next = False

    if "Callout" not in styles:
        callout = styles.add_style("Callout", WD_STYLE_TYPE.PARAGRAPH)
    else:
        callout = styles["Callout"]
    callout.font.name = FONT
    callout.font.size = Pt(10.5)
    callout.font.color.rgb = RGBColor.from_string(NAVY)
    callout.paragraph_format.space_before = Pt(6)
    callout.paragraph_format.space_after = Pt(8)
    callout.paragraph_format.left_indent = Inches(0.18)
    callout.paragraph_format.right_indent = Inches(0.18)
    callout.paragraph_format.line_spacing = 1.10

    header = section.header
    hp = header.paragraphs[0]
    hp.text = ""
    hp.alignment = WD_ALIGN_PARAGRAPH.LEFT
    hr = hp.add_run(running_label.upper())
    set_run_font(hr, size=8.5, color=MUTED, bold=True)
    hp.paragraph_format.space_after = Pt(2)
    p_pr = hp._p.get_or_add_pPr()
    p_bdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "4")
    bottom.set(qn("w:space"), "3")
    bottom.set(qn("w:color"), "D7DBE2")
    p_bdr.append(bottom)
    p_pr.append(p_bdr)

    footer = section.footer
    fp = footer.paragraphs[0]
    fp.text = ""
    add_page_number(fp)

    create_numbering_definitions(doc)


def create_numbering_definitions(doc: Document) -> None:
    numbering = doc.part.numbering_part.element
    existing_abs = [int(e.get(qn("w:abstractNumId"))) for e in numbering.findall(qn("w:abstractNum"))]
    existing_num = [int(e.get(qn("w:numId"))) for e in numbering.findall(qn("w:num"))]
    base_abs = max(existing_abs, default=0) + 1
    base_num = max(existing_num, default=0) + 1

    def make_abstract(abs_id: int, fmt: str, text: str, font: str | None = None):
        abstract = OxmlElement("w:abstractNum")
        abstract.set(qn("w:abstractNumId"), str(abs_id))
        multi = OxmlElement("w:multiLevelType")
        multi.set(qn("w:val"), "singleLevel")
        abstract.append(multi)
        lvl = OxmlElement("w:lvl")
        lvl.set(qn("w:ilvl"), "0")
        start = OxmlElement("w:start")
        start.set(qn("w:val"), "1")
        lvl.append(start)
        num_fmt = OxmlElement("w:numFmt")
        num_fmt.set(qn("w:val"), fmt)
        lvl.append(num_fmt)
        lvl_text = OxmlElement("w:lvlText")
        lvl_text.set(qn("w:val"), text)
        lvl.append(lvl_text)
        suff = OxmlElement("w:suff")
        suff.set(qn("w:val"), "tab")
        lvl.append(suff)
        p_pr = OxmlElement("w:pPr")
        tabs = OxmlElement("w:tabs")
        tab = OxmlElement("w:tab")
        tab.set(qn("w:val"), "num")
        tab.set(qn("w:pos"), "720")
        tabs.append(tab)
        p_pr.append(tabs)
        ind = OxmlElement("w:ind")
        ind.set(qn("w:left"), "720")
        ind.set(qn("w:hanging"), "360")
        p_pr.append(ind)
        spacing = OxmlElement("w:spacing")
        spacing.set(qn("w:after"), "160")
        spacing.set(qn("w:line"), "280")
        spacing.set(qn("w:lineRule"), "auto")
        p_pr.append(spacing)
        lvl.append(p_pr)
        if font:
            r_pr = OxmlElement("w:rPr")
            fonts = OxmlElement("w:rFonts")
            fonts.set(qn("w:ascii"), font)
            fonts.set(qn("w:hAnsi"), font)
            r_pr.append(fonts)
            lvl.append(r_pr)
        abstract.append(lvl)
        numbering.append(abstract)

    make_abstract(base_abs, "bullet", "•")
    make_abstract(base_abs + 1, "decimal", "%1.")
    for num_id, abs_id in ((base_num, base_abs), (base_num + 1, base_abs + 1)):
        num = OxmlElement("w:num")
        num.set(qn("w:numId"), str(num_id))
        abstract_id = OxmlElement("w:abstractNumId")
        abstract_id.set(qn("w:val"), str(abs_id))
        num.append(abstract_id)
        numbering.append(num)
    doc._custom_bullet_num_id = base_num
    doc._custom_decimal_num_id = base_num + 1
    doc._custom_bullet_abs_id = base_abs
    doc._custom_decimal_abs_id = base_abs + 1
    doc._custom_next_num_id = base_num + 2


def new_numbering_instance(doc: Document, ordered: bool) -> int:
    num_id = doc._custom_next_num_id
    doc._custom_next_num_id += 1
    abs_id = doc._custom_decimal_abs_id if ordered else doc._custom_bullet_abs_id
    numbering = doc.part.numbering_part.element
    num = OxmlElement("w:num")
    num.set(qn("w:numId"), str(num_id))
    abstract_id = OxmlElement("w:abstractNumId")
    abstract_id.set(qn("w:val"), str(abs_id))
    num.append(abstract_id)
    if ordered:
        override = OxmlElement("w:lvlOverride")
        override.set(qn("w:ilvl"), "0")
        start_override = OxmlElement("w:startOverride")
        start_override.set(qn("w:val"), "1")
        override.append(start_override)
        num.append(override)
    numbering.append(num)
    return num_id


def add_list(doc: Document, items: Iterable[str], ordered=False) -> None:
    num_id = new_numbering_instance(doc, ordered)
    for item in items:
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(8)
        p.paragraph_format.line_spacing = 1.167
        p_pr = p._p.get_or_add_pPr()
        num_pr = OxmlElement("w:numPr")
        ilvl = OxmlElement("w:ilvl")
        ilvl.set(qn("w:val"), "0")
        nid = OxmlElement("w:numId")
        nid.set(qn("w:val"), str(num_id))
        num_pr.append(ilvl)
        num_pr.append(nid)
        p_pr.append(num_pr)
        run = p.add_run(item)
        set_run_font(run, size=11, color=BLACK)


def add_title_block(doc: Document, doc_no: str, title: str, subtitle: str) -> None:
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(12)
    p.paragraph_format.space_after = Pt(4)
    r = p.add_run(f"ĐỀ TÀI 20  |  TÀI LIỆU PHÂN TÍCH {doc_no}")
    set_run_font(r, size=9.5, color=BLUE, bold=True)

    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.space_after = Pt(6)
    r = p.add_run(title)
    set_run_font(r, size=24, color=NAVY, bold=True)

    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.space_after = Pt(14)
    r = p.add_run(subtitle)
    set_run_font(r, size=12.5, color=MUTED, italic=True)

    rows = [
        ("Tên đề tài", "Hệ thống quản lý khóa mã hóa và chứng thư số"),
        ("Nhóm thực hiện", "........................................................"),
        ("Môn học/Lớp", "........................................................"),
        ("Phiên bản", "1.0 - 17/08/2026"),
    ]
    table = doc.add_table(rows=0, cols=2)
    for label, value in rows:
        cells = table.add_row().cells
        cells[0].text = label
        cells[1].text = value
    set_table_geometry(table, [2200, 7160])
    repeat_header(table.rows[0])
    set_table_borders(table, color="D7DBE2", size="4")
    for row in table.rows:
        set_cell_shading(row.cells[0], LIGHT_BLUE)
        for run in row.cells[0].paragraphs[0].runs:
            set_run_font(run, size=9.5, color=NAVY, bold=True)
        for run in row.cells[1].paragraphs[0].runs:
            set_run_font(run, size=9.5, color=BLACK)
    doc.add_paragraph()


def add_callout(doc: Document, label: str, text: str, fill=PALE_BLUE) -> None:
    table = doc.add_table(rows=1, cols=1)
    repeat_header(table.rows[0])
    set_table_geometry(table, [CONTENT_DXA])
    set_table_borders(table, color="A8BED3", size="5")
    cell = table.cell(0, 0)
    set_cell_shading(cell, fill)
    p = cell.paragraphs[0]
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.space_after = Pt(2)
    r = p.add_run(f"{label}: ")
    set_run_font(r, size=10.5, color=NAVY, bold=True)
    r = p.add_run(text)
    set_run_font(r, size=10.5, color=NAVY)
    after = doc.add_paragraph()
    after.paragraph_format.space_after = Pt(2)


def add_table(doc: Document, headers: Sequence[str], rows: Sequence[Sequence[str]], widths: Sequence[int],
              center_cols: Sequence[int] = ()):
    table = doc.add_table(rows=1, cols=len(headers))
    table.style = "Table Grid"
    for idx, text in enumerate(headers):
        cell = table.rows[0].cells[idx]
        cell.text = text
        set_cell_shading(cell, LIGHT_BLUE)
        for p in cell.paragraphs:
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            p.paragraph_format.space_before = Pt(2)
            p.paragraph_format.space_after = Pt(2)
            for run in p.runs:
                set_run_font(run, size=9.5, color=NAVY, bold=True)
    repeat_header(table.rows[0])
    for ridx, row_data in enumerate(rows):
        cells = table.add_row().cells
        for idx, text in enumerate(row_data):
            cells[idx].text = str(text)
            if ridx % 2 == 1:
                set_cell_shading(cells[idx], "FAFBFC")
            for p in cells[idx].paragraphs:
                p.paragraph_format.space_before = Pt(1)
                p.paragraph_format.space_after = Pt(1)
                p.paragraph_format.line_spacing = 1.05
                p.alignment = WD_ALIGN_PARAGRAPH.CENTER if idx in center_cols else WD_ALIGN_PARAGRAPH.LEFT
                for run in p.runs:
                    set_run_font(run, size=9.2, color=BLACK)
    set_table_geometry(table, widths)
    set_table_borders(table)
    return table


def add_figure(doc: Document, path: Path, caption: str, width=6.25) -> None:
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(6)
    p.paragraph_format.space_after = Pt(2)
    p.paragraph_format.keep_with_next = True
    picture = p.add_run().add_picture(str(path), width=Inches(width))
    # Make diagrams meaningful to screen readers instead of exposing a generic
    # "Picture N" label. The caption is already a concise visual summary.
    picture._inline.docPr.set("descr", caption)
    picture._inline.docPr.set("title", caption.split(".", 1)[0])
    cap = doc.add_paragraph(caption, style="Figure Caption")
    cap.paragraph_format.keep_with_next = False


def add_section_break(doc: Document) -> None:
    doc.add_page_break()


FONT_REGULAR = Path(r"C:\Windows\Fonts\arial.ttf")
FONT_BOLD = Path(r"C:\Windows\Fonts\arialbd.ttf")


class DiagramCanvas:
    def __init__(self, image: Image.Image):
        self.image = image
        self.draw = ImageDraw.Draw(image)
        self.width, self.height = image.size

    def xy(self, x: float, y: float):
        return int(x * self.width), int((1 - y) * self.height)

    def font(self, size: float, bold=False):
        path = FONT_BOLD if bold and FONT_BOLD.exists() else FONT_REGULAR
        return ImageFont.truetype(str(path), max(16, int(size * 2.2)))

    def text(self, x, y, text, ha="center", va="center", fontsize=10,
             fontweight="normal", color="#0B2545", wrap=False, **_):
        px, py = self.xy(x, y)
        anchor_h = {"center": "m", "left": "l", "right": "r"}.get(ha, "m")
        anchor_v = {"center": "m", "top": "a", "bottom": "d"}.get(va, "m")
        self.draw.multiline_text(
            (px, py), text, font=self.font(fontsize, fontweight == "bold"),
            fill=color, anchor=anchor_h + anchor_v, align="center", spacing=5
        )


def box(ax, x, y, w, h, text, fill="#EDF5FC", edge="#2E74B5", size=10, bold=False):
    x1, y1 = ax.xy(x, y + h)
    x2, y2 = ax.xy(x + w, y)
    ax.draw.rounded_rectangle((x1, y1, x2, y2), radius=22, fill=fill, outline=edge, width=4)
    ax.text(x + w / 2, y + h / 2, text, fontsize=size,
            fontweight="bold" if bold else "normal", color="#0B2545")


def _arrow_head(ax, tip, tail, color):
    import math
    tx, ty = ax.xy(*tip)
    sx, sy = ax.xy(*tail)
    angle = math.atan2(ty - sy, tx - sx)
    length = 18
    spread = 0.55
    p1 = (tx - length * math.cos(angle - spread), ty - length * math.sin(angle - spread))
    p2 = (tx - length * math.cos(angle + spread), ty - length * math.sin(angle + spread))
    ax.draw.polygon([(tx, ty), p1, p2], fill=color)


def arrow(ax, start, end, color="#5B6573", style="-|>"):
    s = ax.xy(*start)
    e = ax.xy(*end)
    ax.draw.line((s, e), fill=color, width=4)
    _arrow_head(ax, end, start, color)
    if style == "<->":
        _arrow_head(ax, start, end, color)


def setup_fig(width=12, height=6):
    px_w = int(width * 180)
    px_h = int(height * 180)
    image = Image.new("RGB", (px_w, px_h), "white")
    return image, DiagramCanvas(image)


def save_fig(fig, filename: str) -> Path:
    path = ASSETS / filename
    fig.save(path, "PNG", dpi=(180, 180))
    return path


def diagram_actor_context() -> Path:
    fig, ax = setup_fig(12, 6)
    box(ax, .34, .34, .32, .32, "HỆ THỐNG QUẢN LÝ\nKHÓA MÃ HÓA VÀ\nCHỨNG THƯ SỐ", "#DCEAF7", "#1F4D78", 13, True)
    positions = [
        (.03, .67, .23, .17, "USER / EMPLOYEE\nTạo yêu cầu, xem tài sản"),
        (.74, .67, .23, .17, "APPROVER / MANAGER\nPhê duyệt theo phạm vi"),
        (.03, .13, .23, .17, "SECURITY ADMIN\nPolicy, RBAC, Audit"),
        (.74, .13, .23, .17, "SYSTEM / JOB\nCảnh báo, hết hạn, thực thi"),
    ]
    for x, y, w, h, text in positions:
        box(ax, x, y, w, h, text, "#F2F4F7", "#7E8A97", 10.5, True)
        sx = x + w if x < .5 else x
        sy = y + h / 2
        ex = .34 if x < .5 else .66
        ey = .5
        arrow(ax, (sx, sy), (ex, ey), style="<->")
    ax.text(.5, .95, "Bốn tác nhân chính và ranh giới tương tác", ha="center", va="center",
            fontsize=15, fontweight="bold", color="#0B2545")
    return save_fig(fig, "actor_context.png")


def diagram_responsibility_chain() -> Path:
    fig, ax = setup_fig(12, 4.2)
    labels = [
        ("USER", "Đăng ký / gửi yêu cầu", "#EDF5FC"),
        ("BACKEND", "Kiểm tra RBAC và policy", "#F2F4F7"),
        ("APPROVER", "Phê duyệt hoặc từ chối", "#FFF4D6"),
        ("SYSTEM", "Thực thi và thông báo", "#E8F5E9"),
        ("ADMIN", "Giám sát và kiểm toán", "#FCE8E6"),
    ]
    xs = [.02, .215, .41, .605, .80]
    for i, ((title, detail, fill), x) in enumerate(zip(labels, xs)):
        box(ax, x, .35, .17, .32, f"{title}\n{detail}", fill, "#5B6573", 9.5, True)
        if i < len(labels) - 1:
            arrow(ax, (x + .17, .51), (xs[i + 1], .51))
    ax.text(.5, .86, "Chuỗi trách nhiệm và phân tách nhiệm vụ", ha="center", fontsize=14,
            fontweight="bold", color="#0B2545")
    return save_fig(fig, "responsibility_chain.png")


def diagram_function_map() -> Path:
    fig, ax = setup_fig(12, 7)
    box(ax, .34, .39, .32, .22, "CHỨC NĂNG\nHỆ THỐNG", "#DCEAF7", "#1F4D78", 13, True)
    groups = [
        (.02, .66, .27, .25, "USER", ["Đăng ký/cấp mới", "Gia hạn", "Thu hồi", "Xem tài sản"]),
        (.71, .66, .27, .25, "APPROVER", ["Hàng đợi", "Xem chi tiết", "Approve/Reject", "Lịch sử"]),
        (.02, .08, .27, .25, "SECURITY ADMIN", ["Quản lý tài sản", "Policy", "RBAC", "Audit Log"]),
        (.71, .08, .27, .25, "SYSTEM JOB", ["Cấp phát", "Nhắc hết hạn", "Cập nhật Expired", "Thông báo"]),
    ]
    for x, y, w, h, title, items in groups:
        box(ax, x, y, w, h, title + "\n" + "\n".join(f"• {i}" for i in items), "#F6F8FA", "#7E8A97", 9.2, True)
        start = (x + w if x < .5 else x, y + h / 2)
        end = (.34 if x < .5 else .66, .50)
        arrow(ax, start, end, style="<->")
    ax.text(.5, .97, "Phân rã chức năng theo tác nhân", ha="center", va="center", fontsize=15,
            fontweight="bold", color="#0B2545")
    return save_fig(fig, "function_map.png")


def diagram_overall_flow() -> Path:
    fig, ax = setup_fig(13, 5)
    xs = [.02, .19, .36, .53, .70, .87]
    labels = [
        ("1", "User tạo\nyêu cầu", "#EDF5FC"),
        ("2", "Kiểm tra\nquyền + policy", "#F2F4F7"),
        ("3", "Approver\nquyết định", "#FFF4D6"),
        ("4", "Worker\nthực thi", "#E8F5E9"),
        ("5", "Tạo/cập nhật\ntài sản", "#E8F5E9"),
        ("6", "Thông báo +\nAudit Log", "#FCE8E6"),
    ]
    for i, (x, (num, text, fill)) in enumerate(zip(xs, labels)):
        box(ax, x, .34, .13, .30, f"{num}\n{text}", fill, "#5B6573", 10, True)
        if i < len(xs) - 1:
            arrow(ax, (x + .13, .49), (xs[i + 1], .49))
    ax.text(.5, .86, "Quy trình nghiệp vụ tổng quát", ha="center", fontsize=15,
            fontweight="bold", color="#0B2545")
    ax.text(.5, .13, "Mọi bước thay đổi trạng thái đều được backend kiểm soát và ghi vết",
            ha="center", fontsize=10.5, color="#5B6573")
    return save_fig(fig, "overall_flow.png")


def diagram_request_decision() -> Path:
    fig, ax = setup_fig(12, 7)
    nodes = {
        "start": (.39, .84, .22, .10, "Yêu cầu PENDING", "#EDF5FC"),
        "perm": (.39, .67, .22, .10, "Có quyền approve?", "#FFF4D6"),
        "scope": (.39, .50, .22, .10, "Đúng phạm vi?", "#FFF4D6"),
        "sod": (.39, .33, .22, .10, "Creator ≠ Approver?", "#FFF4D6"),
        "decision": (.39, .16, .22, .10, "Approve / Reject", "#E8F5E9"),
        "deny": (.73, .48, .22, .12, "TỪ CHỐI\n403/404/422", "#FCE8E6"),
    }
    for _, vals in nodes.items():
        box(ax, *vals, edge="#5B6573", size=10.5, bold=True)
    for y1, y2 in ((.84, .77), (.67, .60), (.50, .43), (.33, .26)):
        arrow(ax, (.50, y1), (.50, y2))
    for y in (.72, .55, .38):
        arrow(ax, (.61, y), (.73, .54))
        ax.text(.65, y + .025, "Không", fontsize=8.5, color="#9B1C1C")
    ax.text(.52, .635, "Có", fontsize=8.5, color="#2E7D32")
    ax.text(.52, .465, "Có", fontsize=8.5, color="#2E7D32")
    ax.text(.52, .295, "Có", fontsize=8.5, color="#2E7D32")
    ax.text(.5, .97, "Kiểm soát quyết định phê duyệt", ha="center", va="center", fontsize=15,
            fontweight="bold", color="#0B2545")
    return save_fig(fig, "request_decision.png")


def diagram_lifecycle() -> Path:
    fig, ax = setup_fig(13, 5.2)
    xs = [.02, .20, .38, .56, .74]
    labels = [
        ("REGISTERED", "Đã đăng ký"),
        ("PENDING", "Chờ phê duyệt"),
        ("ACTIVE", "Đang hoạt động"),
        ("EXPIRING SOON", "Sắp hết hạn"),
        ("EXPIRED", "Hết hạn"),
    ]
    for i, (x, (state, desc)) in enumerate(zip(xs, labels)):
        fill = "#E8F5E9" if state == "ACTIVE" else "#EDF5FC"
        box(ax, x, .50, .15, .22, f"{state}\n{desc}", fill, "#5B6573", 9.5, True)
        if i < len(xs) - 1:
            arrow(ax, (x + .15, .61), (xs[i + 1], .61))
    box(ax, .48, .12, .18, .19, "REVOKED\nĐã thu hồi", "#FCE8E6", "#9B1C1C", 10, True)
    box(ax, .70, .12, .18, .19, "SUPERSEDED\nĐã thay thế", "#FFF4D6", "#9A6A00", 10, True)
    arrow(ax, (.455, .50), (.55, .31))
    arrow(ax, (.635, .50), (.57, .31))
    arrow(ax, (.635, .50), (.79, .31))
    ax.text(.5, .90, "Vòng đời tài sản khóa/chứng thư", ha="center", fontsize=15,
            fontweight="bold", color="#0B2545")
    return save_fig(fig, "asset_lifecycle.png")


def diagram_expiry_job() -> Path:
    fig, ax = setup_fig(12, 6)
    box(ax, .04, .63, .18, .18, "Scheduler\nchạy hàng ngày", "#EDF5FC", "#2E74B5", 10, True)
    box(ax, .29, .63, .18, .18, "Nạp policy\n30 / 7 / 1 ngày", "#F2F4F7", "#5B6573", 10, True)
    box(ax, .54, .63, .18, .18, "Tìm asset\nđủ điều kiện", "#F2F4F7", "#5B6573", 10, True)
    box(ax, .79, .63, .18, .18, "Kiểm tra\nexpires_at", "#FFF4D6", "#9A6A00", 10, True)
    for a, b in ((.22, .29), (.47, .54), (.72, .79)):
        arrow(ax, (a, .72), (b, .72))
    box(ax, .60, .20, .18, .18, "Đúng mốc\nTạo notification", "#E8F5E9", "#2E7D32", 10, True)
    box(ax, .82, .20, .15, .18, "Đã hết hạn\n→ EXPIRED", "#FCE8E6", "#9B1C1C", 10, True)
    box(ax, .35, .20, .18, .18, "Deduplication\nngăn gửi trùng", "#EDF5FC", "#2E74B5", 10, True)
    arrow(ax, (.84, .63), (.69, .38))
    arrow(ax, (.91, .63), (.895, .38))
    arrow(ax, (.60, .29), (.53, .29))
    ax.text(.72, .46, "Sắp hết hạn", fontsize=8.5, color="#2E7D32")
    ax.text(.90, .46, "Đã hết hạn", fontsize=8.5, color="#9B1C1C")
    ax.text(.5, .92, "Quy trình nhắc hết hạn và cập nhật trạng thái", ha="center", fontsize=15,
            fontweight="bold", color="#0B2545")
    return save_fig(fig, "expiry_job.png")


def add_actor_profile(doc: Document, number: str, name: str, goal: str, characteristics: Sequence[str],
                      functions: Sequence[str], data_scope: Sequence[str], constraints: Sequence[str], example: str):
    doc.add_heading(f"{number}. {name}", level=1)
    add_callout(doc, "Mục tiêu", goal)
    doc.add_heading("Đặc điểm và trách nhiệm", level=2)
    add_list(doc, characteristics)
    doc.add_heading("Chức năng sử dụng", level=2)
    add_list(doc, functions)
    doc.add_heading("Phạm vi dữ liệu", level=2)
    add_list(doc, data_scope)
    doc.add_heading("Giới hạn và kiểm soát", level=2)
    add_list(doc, constraints)
    doc.add_heading("Tình huống điển hình", level=2)
    p = doc.add_paragraph(example)
    p.paragraph_format.left_indent = Inches(0.18)
    p.paragraph_format.right_indent = Inches(0.18)
    p.paragraph_format.space_after = Pt(10)


def build_doc1() -> Path:
    doc = Document()
    configure_document(doc, "Đề tài 20 - Đối tượng sử dụng phần mềm")
    add_title_block(doc, "01", "ĐỐI TƯỢNG SỬ DỤNG PHẦN MỀM",
                    "Phân tích tác nhân, nhu cầu, trách nhiệm và phạm vi dữ liệu")

    doc.add_heading("1. Mục đích tài liệu", level=1)
    doc.add_paragraph(
        "Tài liệu xác định các đối tượng trực tiếp hoặc tự động tương tác với phần mềm. "
        "Việc phân tích đúng tác nhân là cơ sở để xây dựng Use Case, phân quyền, giao diện theo vai trò "
        "và kiểm soát truy cập dữ liệu nhạy cảm."
    )
    add_callout(doc, "Kết luận chính",
                "Hệ thống có ba tác nhân con người (User, Approver, Security Admin) và một tác nhân tự động (System/Background Job). "
                "Crypto Provider và Email Service là hệ thống tích hợp, không phải người dùng phần mềm.")

    doc.add_heading("2. Phạm vi hệ thống", level=1)
    doc.add_paragraph(
        "Phần mềm quản lý thông tin vòng đời của khóa mã hóa và chứng thư số: đăng ký hoặc yêu cầu cấp mới, "
        "phê duyệt, cấp phát, gia hạn/thay thế, thu hồi, cảnh báo sắp hết hạn và kiểm toán. "
        "Private key không được lưu dạng rõ trong cơ sở dữ liệu của ứng dụng."
    )
    add_figure(doc, diagram_actor_context(), "Hình 1. Các tác nhân chính của hệ thống")

    doc.add_heading("3. Nguyên tắc xác định tác nhân", level=1)
    add_list(doc, [
        "Một tác nhân được xác định theo trách nhiệm nghiệp vụ, không chỉ theo chức danh.",
        "Mỗi tác nhân chỉ được truy cập chức năng và dữ liệu cần thiết cho nhiệm vụ.",
        "Người tạo yêu cầu và người phê duyệt phải là hai người khác nhau.",
        "Security Admin quản trị hệ thống nhưng không có quyền phê duyệt nghiệp vụ.",
        "System Job sử dụng service identity với quyền tối thiểu và mọi hành động đều được ghi Audit Log.",
    ])

    add_section_break(doc)
    add_actor_profile(
        doc, "4", "Người dùng thông thường (User / Employee)",
        "Đăng ký hoặc đề nghị cấp khóa/chứng thư phục vụ công việc và theo dõi các tài sản do mình sở hữu.",
        [
            "Là nhân viên hoặc thành viên của một phòng ban trong tổ chức.",
            "Chịu trách nhiệm khai báo đúng mục đích sử dụng và bảo vệ thông tin được cấp.",
            "Chủ động yêu cầu gia hạn khi nhận cảnh báo và yêu cầu thu hồi khi có dấu hiệu rủi ro.",
        ],
        [
            "Đăng ký khóa/chứng thư đã tồn tại hoặc gửi yêu cầu cấp phát mới.",
            "Yêu cầu gia hạn/thay thế tài sản sắp hết hạn.",
            "Yêu cầu thu hồi, chọn lý do và đánh dấu khẩn cấp khi nghi lộ khóa.",
            "Xem danh sách, chi tiết, trạng thái, thời hạn và lịch sử tài sản của mình.",
            "Theo dõi trạng thái yêu cầu và nhận thông báo.",
        ],
        [
            "Chỉ xem tài sản có owner là chính mình.",
            "Chỉ xem request do mình tạo, trừ khi đồng thời có vai trò khác.",
            "Không nhìn thấy private key, refresh token, policy quản trị hoặc Audit Log toàn hệ thống.",
        ],
        [
            "Không được tự phê duyệt bất kỳ yêu cầu nào do mình tạo.",
            "Không được tự sửa trạng thái tài sản hoặc sửa request đã được quyết định.",
            "Không được truy cập tài sản bằng cách thay đổi ID trên URL/API.",
        ],
        "Nguyễn An cần chứng thư để ký tài liệu. An đăng nhập, chọn “Yêu cầu cấp mới”, khai báo mục đích và thời hạn, "
        "sau đó theo dõi trạng thái cho đến khi hệ thống thông báo đã cấp phát thành công."
    )

    add_actor_profile(
        doc, "5", "Người phê duyệt (Approver / Manager)",
        "Đánh giá yêu cầu trong phạm vi phụ trách và bảo đảm yêu cầu hợp lệ trước khi hệ thống thực thi.",
        [
            "Thường là trưởng phòng, quản lý hoặc cán bộ được ủy quyền.",
            "Chỉ phê duyệt yêu cầu của đơn vị/phòng ban được gán trong Approver Scope.",
            "Chịu trách nhiệm về quyết định approve/reject và nội dung ghi chú kèm theo.",
        ],
        [
            "Xem Approval Queue theo phòng ban và mức độ ưu tiên.",
            "Xem thông tin người gửi, tài sản, lý do, policy check và lịch sử liên quan.",
            "Phê duyệt hoặc từ chối yêu cầu; bắt buộc ghi lý do khi từ chối.",
            "Xem lịch sử các quyết định do mình thực hiện.",
        ],
        [
            "Xem request và metadata tài sản trong phạm vi phụ trách.",
            "Không được xem dữ liệu ngoài scope nếu không có permission bổ sung.",
            "Không được xem private key hoặc thông tin bí mật của provider.",
        ],
        [
            "Backend kiểm tra creator_id khác approver_id.",
            "Chỉ request ở trạng thái PENDING mới được quyết định.",
            "Nếu hai Approver xử lý đồng thời, chỉ một quyết định được ghi nhận.",
            "Không được thay đổi policy hoặc gán vai trò tài khoản.",
        ],
        "Trưởng phòng Kế toán nhận yêu cầu gia hạn của Nguyễn An. Người phê duyệt kiểm tra owner, thời hạn và policy, "
        "sau đó phê duyệt. Backend ghi quyết định và đưa công việc gia hạn vào hàng đợi xử lý."
    )

    add_section_break(doc)
    add_actor_profile(
        doc, "6", "Quản trị viên bảo mật (Security Admin)",
        "Quản trị chính sách, tài khoản và khả năng kiểm toán của hệ thống mà không tham gia quyết định nghiệp vụ.",
        [
            "Là cán bộ an toàn thông tin hoặc quản trị viên được tổ chức ủy quyền.",
            "Chịu trách nhiệm cấu hình policy và duy trì mô hình phân quyền.",
            "Theo dõi tình trạng tài sản và điều tra sự kiện thông qua Audit Log.",
        ],
        [
            "Xem toàn bộ metadata tài sản trong tổ chức.",
            "Tạo phiên bản policy: thuật toán, độ dài khóa, thời hạn và mốc cảnh báo.",
            "Quản lý tài khoản, trạng thái, role và Approver Scope.",
            "Tra cứu Audit Log theo actor, hành động, đối tượng, kết quả và thời gian.",
            "Theo dõi job lỗi, notification lỗi và tài sản không tuân thủ.",
        ],
        [
            "Được xem metadata toàn hệ thống theo permission asset:read:any.",
            "Được xem Audit Log đã che dữ liệu nhạy cảm.",
            "Không được lấy private key rõ hoặc sử dụng bí mật của người dùng.",
        ],
        [
            "Không có permission request:approve.",
            "Không được xóa cứng asset, request, decision hoặc Audit Log.",
            "Mọi thay đổi role và policy phải lưu giá trị trước/sau trong Audit Log.",
            "Không được xóa vai trò của quản trị viên cuối cùng.",
        ],
        "Security Admin thay đổi mốc cảnh báo từ 14 ngày thành 30, 7 và 1 ngày. Hệ thống tạo policy version mới, "
        "giữ nguyên phiên bản cũ và ghi đầy đủ người thay đổi, thời điểm, giá trị trước và sau."
    )

    add_actor_profile(
        doc, "7", "Hệ thống tự động (System / Background Job)",
        "Thực hiện công việc định kỳ hoặc bất đồng bộ một cách nhất quán, có thể retry và truy vết.",
        [
            "Không phải người dùng con người; hoạt động bằng service identity.",
            "Chạy theo lịch hoặc nhận job từ hàng đợi sau khi request được phê duyệt.",
            "Phải idempotent: chạy lại không tạo tài sản hoặc thông báo trùng.",
        ],
        [
            "Gọi Crypto Provider để provision, renew hoặc revoke.",
            "Quét tài sản sắp hết hạn theo policy.",
            "Tạo notification và gửi email qua SMTP/MailHog.",
            "Chuyển trạng thái tài sản sang EXPIRED khi qua thời gian hiệu lực.",
            "Retry tác vụ thất bại và ghi nhận lỗi an toàn.",
        ],
        [
            "Chỉ đọc các trường cần thiết cho job.",
            "Chỉ cập nhật trạng thái theo state machine được định nghĩa.",
            "Truy cập provider bằng service credential nằm trong secret store.",
        ],
        [
            "Không được bỏ qua phê duyệt để tự tạo tài sản nghiệp vụ.",
            "Không ghi private key, token hoặc provider secret vào log.",
            "Sử dụng deduplication key và lock để tránh chạy trùng.",
        ],
        "Mỗi ngày lúc 01:00, job đọc policy cảnh báo, tìm chứng thư còn 30, 7 hoặc 1 ngày, tạo notification duy nhất "
        "cho từng mốc và chuyển các tài sản đã qua expires_at sang EXPIRED."
    )

    doc.add_heading("8. Hệ thống tích hợp hỗ trợ", level=1)
    add_table(doc,
              ["Thành phần", "Vai trò", "Dữ liệu trao đổi", "Lưu ý bảo mật"],
              [
                  ["Crypto Provider", "Tạo/gia hạn/thu hồi", "Tham số nghiệp vụ, metadata, provider reference", "Không trả private key vào log"],
                  ["Email Service", "Gửi cảnh báo", "Người nhận, template, nội dung thông báo", "Không gửi dữ liệu tối mật"],
                  ["Identity Provider (mở rộng)", "SSO/MFA", "Danh tính, claim, trạng thái phiên", "Xác minh issuer/audience"],
              ], [1800, 2100, 3300, 2160])

    doc.add_heading("9. Ma trận phạm vi truy cập", level=1)
    add_table(doc,
              ["Dữ liệu/chức năng", "User", "Approver", "Security Admin", "System Job"],
              [
                  ["Tài sản", "Của mình", "Trong scope", "Toàn hệ thống", "Theo job"],
                  ["Yêu cầu", "Do mình tạo", "Trong scope", "Toàn hệ thống - chỉ đọc", "Theo job"],
                  ["Phê duyệt", "Không", "Có", "Không", "Không"],
                  ["Policy", "Chỉ đọc giá trị áp dụng", "Chỉ đọc giá trị áp dụng", "Quản lý", "Chỉ đọc"],
                  ["Audit Log", "Không", "Không", "Tra cứu", "Chỉ ghi qua service"],
                  ["Private key", "Không hiển thị", "Không hiển thị", "Không hiển thị", "Chỉ provider xử lý"],
              ], [2500, 1500, 1800, 1900, 1660], center_cols=(1, 2, 3, 4))

    add_figure(doc, diagram_responsibility_chain(), "Hình 2. Chuỗi trách nhiệm và nguyên tắc SoD")

    doc.add_heading("10. Tiêu chí xác nhận phân tích tác nhân", level=1)
    add_list(doc, [
        "Mỗi chức năng đều có một tác nhân chịu trách nhiệm chính.",
        "Không có vai trò nào đồng thời tạo, tự duyệt và tự thực thi cùng một yêu cầu.",
        "Mỗi tác nhân có phạm vi dữ liệu rõ ràng và được kiểm tra ở backend.",
        "Giao diện điều hướng thay đổi theo vai trò nhưng không thay thế kiểm tra quyền API.",
        "System Job và hệ thống tích hợp được mô tả riêng với người dùng con người.",
    ])

    path = OUT / "01_Doi_tuong_su_dung_phan_mem.docx"
    doc.save(path)
    return path


def add_function_spec(doc: Document, uc: str, name: str, actor: str, purpose: str,
                      inputs: Sequence[str], process: Sequence[str], outputs: Sequence[str],
                      rules: Sequence[str], exceptions: Sequence[str]):
    doc.add_heading(f"{uc} - {name}", level=2)
    p = doc.add_paragraph()
    r = p.add_run("Tác nhân chính: ")
    set_run_font(r, bold=True, color=DARK_BLUE)
    p.add_run(actor)
    p = doc.add_paragraph()
    r = p.add_run("Mục đích: ")
    set_run_font(r, bold=True, color=DARK_BLUE)
    p.add_run(purpose)
    doc.add_heading("Đầu vào", level=3)
    add_list(doc, inputs)
    doc.add_heading("Xử lý chính", level=3)
    add_list(doc, process, ordered=True)
    doc.add_heading("Đầu ra", level=3)
    add_list(doc, outputs)
    doc.add_heading("Quy tắc nghiệp vụ", level=3)
    add_list(doc, rules)
    doc.add_heading("Ngoại lệ", level=3)
    add_list(doc, exceptions)


def build_doc2() -> Path:
    doc = Document()
    configure_document(doc, "Đề tài 20 - Chức năng theo đối tượng")
    add_title_block(doc, "02", "CHỨC NĂNG CỦA TỪNG ĐỐI TƯỢNG",
                    "Đặc tả phạm vi chức năng, đầu vào, xử lý, đầu ra và quy tắc")

    doc.add_heading("1. Mục đích tài liệu", level=1)
    doc.add_paragraph(
        "Tài liệu phân rã các chức năng của phần mềm theo từng tác nhân. Mỗi chức năng được mô tả bằng mục đích, "
        "đầu vào, luồng xử lý, đầu ra, quy tắc nghiệp vụ và trường hợp ngoại lệ để làm cơ sở thiết kế Use Case, "
        "API, giao diện và kiểm thử nghiệm thu."
    )
    add_callout(doc, "Phạm vi cốt lõi",
                "Đăng ký/cấp mới khóa hoặc chứng thư, gia hạn, thu hồi, nhắc hết hạn, quản lý vòng đời, "
                "phân tách nhiệm vụ và kiểm soát dữ liệu nhạy cảm.")

    doc.add_heading("2. Bản đồ chức năng", level=1)
    add_figure(doc, diagram_function_map(), "Hình 1. Phân rã chức năng theo bốn tác nhân")

    doc.add_heading("3. Danh mục chức năng", level=1)
    add_table(doc,
              ["Mã", "Tác nhân", "Chức năng", "Mức ưu tiên"],
              [
                  ["UC01", "User", "Đăng ký tài sản đã tồn tại", "Must"],
                  ["UC02", "User", "Yêu cầu cấp phát mới", "Must"],
                  ["UC03", "User", "Yêu cầu gia hạn/thay thế", "Must"],
                  ["UC04", "User", "Yêu cầu thu hồi", "Must"],
                  ["UC05", "User", "Xem tài sản, yêu cầu và thông báo", "Must"],
                  ["UC06", "Approver", "Xem hàng đợi chờ duyệt", "Must"],
                  ["UC07", "Approver", "Phê duyệt hoặc từ chối", "Must"],
                  ["UC08", "Admin", "Quản lý tài sản toàn hệ thống", "Must"],
                  ["UC09", "Admin", "Thiết lập chính sách", "Must"],
                  ["UC10", "Admin", "Xem Audit Log", "Must"],
                  ["UC11", "Admin", "Quản lý tài khoản, role và scope", "Must"],
                  ["UC12", "System", "Thực thi provision/renew/revoke", "Must"],
                  ["UC13", "System", "Quét và nhắc hết hạn", "Must"],
                  ["UC14", "System", "Cập nhật trạng thái hết hạn", "Must"],
              ], [1000, 1900, 4800, 1660], center_cols=(0, 1, 3))

    doc.add_heading("4. Chức năng của User / Employee", level=1)
    add_function_spec(doc, "UC01", "Đăng ký khóa/chứng thư đã tồn tại", "User",
        "Đưa một tài sản đã có vào phạm vi quản lý tập trung.",
        ["Loại tài sản", "Owner và phòng ban", "Thuật toán, mục đích", "Ngày hiệu lực/hết hạn", "Fingerprint, serial hoặc provider reference"],
        ["Kiểm tra quyền tạo đăng ký", "Validate metadata", "Đối chiếu policy", "Kiểm tra trùng fingerprint/serial", "Tạo request PENDING và ghi Audit Log"],
        ["Mã request", "Trạng thái chờ duyệt", "Thông báo cho Approver"],
        ["Không nhận private key dạng rõ", "Certificate serial/fingerprint không được trùng", "Owner phải thuộc đơn vị hợp lệ"],
        ["Thiếu metadata", "Tài sản đã tồn tại", "Thuật toán bị policy cấm", "Không tìm thấy Approver phù hợp"])

    add_function_spec(doc, "UC02", "Yêu cầu cấp phát mới", "User",
        "Đề nghị hệ thống tạo hoặc cấp một khóa/chứng thư mới cho mục đích công việc.",
        ["Loại tài sản", "Mục đích sử dụng", "Thuật toán và kích thước", "Thời hạn mong muốn", "Lý do nghiệp vụ"],
        ["Validate dữ liệu", "Kiểm tra policy", "Tạo request PENDING", "Thông báo Approver", "Chờ quyết định và worker thực thi"],
        ["Request và timeline", "Asset mới nếu được duyệt", "Notification kết quả"],
        ["Thời hạn không vượt policy", "User không được tự duyệt", "Private key không ghi log"],
        ["Policy violation", "Provider lỗi", "Request bị từ chối", "Timeout xử lý"])

    add_function_spec(doc, "UC03", "Yêu cầu gia hạn/thay thế", "User",
        "Duy trì khả năng sử dụng khi tài sản sắp hết hạn.",
        ["Target asset", "Thời hạn mong muốn", "Lý do", "Tham số thay đổi nếu có"],
        ["Xác minh User là owner", "Kiểm tra trạng thái asset", "Kiểm tra request trùng", "Tạo request PENDING", "Sau phê duyệt tạo asset kế tiếp"],
        ["Asset mới liên kết asset cũ", "Asset cũ giữ nguyên lịch sử", "Notification hoàn tất"],
        ["Không sửa chứng thư đã phát hành", "Không có hai request gia hạn mở", "Asset mới tuân thủ policy hiện tại"],
        ["Asset đã revoked", "Asset không thuộc owner", "Đã có request đang mở", "Provider không tạo được tài sản mới"])

    add_function_spec(doc, "UC04", "Yêu cầu thu hồi", "User",
        "Chấm dứt hiệu lực tài sản khi không còn sử dụng hoặc có nguy cơ lộ khóa.",
        ["Target asset", "Lý do thu hồi", "Mô tả", "Cờ khẩn cấp"],
        ["Kiểm tra owner và trạng thái", "Tạo request", "Ưu tiên nếu khẩn cấp", "Approver quyết định", "Worker gọi provider revoke"],
        ["Asset REVOKED", "Request COMPLETED", "Audit và notification"],
        ["Bắt buộc lý do", "REVOKED là trạng thái một chiều", "Nghi lộ khóa phải đánh dấu ưu tiên"],
        ["Asset đã revoked/expired", "Provider revoke lỗi", "Yêu cầu bị từ chối"])

    add_function_spec(doc, "UC05", "Tra cứu tài sản, yêu cầu và thông báo", "User",
        "Theo dõi tài sản và tiến độ xử lý của chính mình.",
        ["Bộ lọc loại, trạng thái, ngày hết hạn", "Mã asset/request"],
        ["Xác thực phiên", "Áp dụng owner scope", "Phân trang và lọc", "Che trường nhạy cảm"],
        ["Danh sách/chi tiết asset", "Timeline request", "Notification chưa đọc"],
        ["Không trả asset của người khác", "Không trả private key/provider secret"],
        ["Không có quyền", "Không tìm thấy", "Phiên hết hạn"])

    add_section_break(doc)
    doc.add_heading("5. Chức năng của Approver / Manager", level=1)
    add_function_spec(doc, "UC06", "Xem hàng đợi chờ duyệt", "Approver",
        "Tập trung các yêu cầu cần xử lý trong phạm vi phụ trách.",
        ["Scope được gán", "Bộ lọc loại, độ khẩn cấp, phòng ban, ngày gửi"],
        ["Kiểm tra permission", "Áp dụng department scope", "Ưu tiên emergency", "Trả kết quả phân trang"],
        ["Approval Queue", "Số lượng chờ xử lý", "Thông tin SLA/thời gian chờ"],
        ["Không hiển thị request ngoài scope", "Request do chính Approver tạo có thể xem nhưng không thể duyệt"],
        ["Scope chưa được gán", "Request đã được người khác xử lý"])

    add_function_spec(doc, "UC07", "Phê duyệt hoặc từ chối", "Approver",
        "Đưa ra quyết định nghiệp vụ có trách nhiệm và truy vết được.",
        ["Request ID", "Decision APPROVE/REJECT", "Comment/lý do"],
        ["Kiểm tra role", "Kiểm tra scope", "Kiểm tra SoD", "Kiểm tra trạng thái/version", "Ghi decision + status + audit trong transaction"],
        ["Request APPROVED hoặc REJECTED", "Job thực thi nếu approve", "Notification cho creator"],
        ["creator_id phải khác approver_id", "Reject bắt buộc lý do", "Chỉ PENDING được quyết định"],
        ["SOD_VIOLATION", "409 do quyết định đồng thời", "Request ngoài scope", "Transaction rollback"])

    add_figure(doc, diagram_request_decision(), "Hình 2. Các lớp kiểm soát trước khi ghi nhận quyết định", width=5.2)

    add_section_break(doc)
    doc.add_heading("6. Chức năng của Security Admin", level=1)
    add_function_spec(doc, "UC08", "Quản lý tài sản toàn hệ thống", "Security Admin",
        "Giám sát tình trạng tài sản mật mã trên phạm vi toàn tổ chức.",
        ["Bộ lọc loại, trạng thái, phòng ban, owner, thời hạn"],
        ["Kiểm tra asset:read:any", "Truy vấn metadata", "Tổng hợp dashboard", "Che trường nhạy cảm"],
        ["Danh sách và thống kê asset", "Danh sách không tuân thủ/sắp hết hạn"],
        ["Không xóa cứng asset", "Không hiển thị private key"],
        ["Dữ liệu provider thiếu", "Asset metadata không nhất quán"])

    add_function_spec(doc, "UC09", "Thiết lập chính sách", "Security Admin",
        "Cấu hình quy tắc về thuật toán, độ dài khóa, thời hạn và cảnh báo.",
        ["Allowed algorithms", "Minimum key size", "Validity limits", "Warning thresholds", "Effective time"],
        ["Validate policy", "So sánh phiên bản trước", "Tạo policy version mới", "Ghi Audit Log"],
        ["Policy version mới", "Diff trước/sau", "Thời điểm hiệu lực"],
        ["Không sửa phiên bản lịch sử", "Threshold phải hợp lệ và không trùng", "Policy phải có người thay đổi"],
        ["Cấu hình mâu thuẫn", "Không còn thuật toán hợp lệ", "Không đủ quyền"])

    add_function_spec(doc, "UC10", "Tra cứu Audit Log", "Security Admin",
        "Truy vết đầy đủ các hành động quan trọng phục vụ kiểm tra và điều tra.",
        ["Actor", "Action", "Entity", "Outcome", "Khoảng thời gian", "Request ID"],
        ["Kiểm tra audit:read", "Áp dụng filter", "Phân trang", "Che metadata nhạy cảm"],
        ["Danh sách audit event", "Chi tiết trước/sau đã redaction"],
        ["Không có API sửa/xóa", "Truy cập Audit Log cũng được ghi log"],
        ["Khoảng thời gian quá lớn", "Không đủ quyền", "Log storage tạm thời lỗi"])

    add_function_spec(doc, "UC11", "Quản lý tài khoản, role và scope", "Security Admin",
        "Duy trì mô hình phân quyền phù hợp với cơ cấu tổ chức.",
        ["User ID", "Trạng thái tài khoản", "Roles", "Approver scopes"],
        ["Kiểm tra quyền", "Validate role/scope", "Ngăn xóa admin cuối", "Cập nhật và tăng token_version", "Ghi Audit Log"],
        ["Vai trò/phạm vi mới", "Phiên cũ bị thu hồi nếu cần", "Audit trước/sau"],
        ["Admin không được tự thêm permission approve ngoài mô hình", "Không xóa admin cuối cùng"],
        ["Role không tồn tại", "Scope không hợp lệ", "Xung đột cập nhật"])

    add_section_break(doc)
    doc.add_heading("7. Chức năng của System / Background Job", level=1)
    add_function_spec(doc, "UC12", "Thực thi provision, renew và revoke", "System Worker",
        "Biến request đã được duyệt thành thay đổi tài sản thực tế.",
        ["Approved request", "Provider configuration", "Idempotency key"],
        ["Khóa job", "Chuyển PROCESSING", "Gọi provider adapter", "Lưu metadata/kết quả", "Chuyển COMPLETED hoặc FAILED"],
        ["Asset được tạo/cập nhật", "Provider reference", "Notification và Audit Log"],
        ["Chỉ xử lý APPROVED", "Không tạo trùng khi retry", "Không log private key"],
        ["Provider timeout", "Kết quả không xác định", "Retry vượt giới hạn"])

    add_function_spec(doc, "UC13", "Quét và nhắc hết hạn", "System Scheduler",
        "Cảnh báo chủ sở hữu trước khi tài sản mất hiệu lực.",
        ["Policy thresholds", "Asset ACTIVE/EXPIRING_SOON", "Thời gian hiện tại UTC"],
        ["Nạp policy", "Tìm asset đủ điều kiện", "Tạo deduplication key", "Gửi in-app/email", "Ghi kết quả"],
        ["Notification SENT/FAILED", "Asset EXPIRING_SOON", "Audit/metric job"],
        ["Không gửi trùng một mốc", "Job idempotent", "Email lỗi không rollback asset"],
        ["SMTP lỗi", "Job chạy đồng thời", "Policy thiếu threshold"])

    add_function_spec(doc, "UC14", "Cập nhật trạng thái hết hạn", "System Scheduler",
        "Bảo đảm trạng thái phản ánh đúng thời gian hiệu lực.",
        ["Asset có expires_at", "Thời gian UTC hiện tại"],
        ["Tìm asset chưa terminal", "So sánh expires_at", "Atomic update EXPIRED", "Ghi Audit Log"],
        ["Asset EXPIRED", "Thông báo phù hợp", "Job metrics"],
        ["Không chuyển REVOKED/SUPERSEDED về EXPIRED tùy ý", "Không phụ thuộc timezone trình duyệt"],
        ["Dữ liệu expires_at thiếu/sai", "Lock conflict", "Database lỗi"])

    doc.add_heading("8. Ma trận quyền chức năng", level=1)
    add_table(doc,
              ["Permission", "User", "Approver", "Admin", "System"],
              [
                  ["request:create", "Có", "Có*", "Không", "Không"],
                  ["request:read:own", "Có", "Có", "Có", "Không"],
                  ["request:read:scope", "Không", "Có", "Có", "Theo job"],
                  ["request:approve", "Không", "Có", "Không", "Không"],
                  ["asset:read:own", "Có", "Có", "Có", "Theo job"],
                  ["asset:read:any", "Không", "Không", "Có", "Không"],
                  ["policy:manage", "Không", "Không", "Có", "Không"],
                  ["role:assign", "Không", "Không", "Có", "Không"],
                  ["audit:read", "Không", "Không", "Có", "Không"],
                  ["job:execute", "Không", "Không", "Dev only**", "Có"],
              ], [3000, 1300, 1600, 1500, 1960], center_cols=(1, 2, 3, 4))
    p = doc.add_paragraph("* Approver có thể tạo request cho mình nhưng vẫn không được tự duyệt.  ** Chỉ công cụ demo/development, tắt ở production.")
    p.paragraph_format.space_before = Pt(4)
    p.paragraph_format.space_after = Pt(8)
    for run in p.runs:
        set_run_font(run, size=9, color=MUTED, italic=True)

    doc.add_heading("9. Tiêu chí nghiệm thu chức năng", level=1)
    add_list(doc, [
        "Mỗi Use Case có thể chạy từ giao diện đến database với dữ liệu demo.",
        "Mọi endpoint kiểm tra authentication, permission và object scope.",
        "Creator không tự duyệt được kể cả khi gọi API trực tiếp.",
        "Gia hạn tạo tài sản kế tiếp và giữ lịch sử tài sản cũ.",
        "Thu hồi là thao tác một chiều và có lý do truy vết.",
        "Background Job chạy lại không tạo thông báo hoặc tài sản trùng.",
        "Không có private key, mật khẩu hoặc token trong response và log.",
    ])

    path = OUT / "02_Chuc_nang_cua_tung_doi_tuong.docx"
    doc.save(path)
    return path


def add_process(doc: Document, code: str, name: str, purpose: str, actors: str,
                preconditions: Sequence[str], steps: Sequence[str], postconditions: Sequence[str],
                exceptions: Sequence[str]):
    doc.add_heading(f"{code} - {name}", level=1)
    add_callout(doc, "Mục đích", purpose)
    p = doc.add_paragraph()
    r = p.add_run("Tác nhân tham gia: ")
    set_run_font(r, bold=True, color=DARK_BLUE)
    p.add_run(actors)
    doc.add_heading("Điều kiện trước", level=2)
    add_list(doc, preconditions)
    doc.add_heading("Luồng chính", level=2)
    add_list(doc, steps, ordered=True)
    doc.add_heading("Điều kiện sau", level=2)
    add_list(doc, postconditions)
    doc.add_heading("Luồng ngoại lệ", level=2)
    add_list(doc, exceptions)


def build_doc3() -> Path:
    doc = Document()
    configure_document(doc, "Đề tài 20 - Quy trình hoạt động phần mềm")
    add_title_block(doc, "03", "QUY TRÌNH HOẠT ĐỘNG CỦA PHẦN MỀM",
                    "Quy trình tổng thể và quy trình của các chức năng chính")

    doc.add_heading("1. Mục đích tài liệu", level=1)
    doc.add_paragraph(
        "Tài liệu mô tả cách phần mềm vận hành từ khi người dùng đăng nhập, tạo yêu cầu, phê duyệt, thực thi, "
        "quản lý vòng đời đến khi cảnh báo hoặc kết thúc hiệu lực. Nội dung được dùng làm cơ sở vẽ BPMN, "
        "Activity Diagram và Sequence Diagram trên Visual Paradigm."
    )
    add_callout(doc, "Nguyên tắc xuyên suốt",
                "Mọi thay đổi trạng thái phải đi qua backend, được kiểm tra role + scope + business rule và tạo Audit Log.")

    doc.add_heading("2. Quy trình hoạt động tổng thể", level=1)
    add_figure(doc, diagram_overall_flow(), "Hình 1. Quy trình nghiệp vụ tổng quát của phần mềm")
    add_list(doc, [
        "User đăng ký tài sản hoặc gửi yêu cầu cấp mới, gia hạn, thu hồi.",
        "Backend xác thực phiên, kiểm tra phạm vi dữ liệu và policy.",
        "Request hợp lệ chuyển PENDING và xuất hiện trong Approval Queue.",
        "Approver đúng scope đưa ra quyết định; backend cưỡng chế SoD.",
        "Worker gọi Crypto Provider và cập nhật tài sản.",
        "Notification thông báo kết quả; Audit Log lưu toàn bộ chuỗi sự kiện.",
        "Background Job tiếp tục theo dõi hết hạn trong suốt vòng đời.",
    ], ordered=True)

    doc.add_heading("3. Mô hình trạng thái", level=1)
    add_figure(doc, diagram_lifecycle(), "Hình 2. Vòng đời tổng quát của khóa/chứng thư")
    add_table(doc,
              ["Đối tượng", "Trạng thái chính", "Trạng thái kết thúc"],
              [
                  ["Request", "DRAFT → PENDING → APPROVED → PROCESSING", "COMPLETED / REJECTED / CANCELLED"],
                  ["Crypto Asset", "REGISTERED → ACTIVE → EXPIRING_SOON", "EXPIRED / REVOKED / SUPERSEDED"],
                  ["Notification", "PENDING → SENDING", "SENT / FAILED"],
              ], [1900, 4300, 3160])

    add_section_break(doc)
    add_process(doc, "QT01", "Đăng nhập và thiết lập phiên", "Xác minh danh tính và nạp quyền theo vai trò.",
        "User/Approver/Admin, Frontend, Backend, Database",
        ["Tài khoản tồn tại và chưa bị khóa.", "Kết nối HTTPS hoạt động."],
        ["Người dùng nhập email và mật khẩu.", "Frontend gửi POST /auth/login.", "Backend tìm tài khoản và so sánh password hash.",
         "Backend tạo access token ngắn hạn và refresh session.", "Frontend gọi /auth/me để lấy role, permission và profile.",
         "Hệ thống hiển thị dashboard tương ứng vai trò và ghi Audit Log."],
        ["Phiên đăng nhập hợp lệ.", "Menu và route hiển thị theo quyền."],
        ["Sai mật khẩu: trả 401 và tăng bộ đếm thất bại.", "Tài khoản bị khóa: từ chối đăng nhập.", "Quá nhiều lần thử: trả 429/lockout mềm."])

    add_process(doc, "QT02", "Đăng ký tài sản đã tồn tại", "Đưa khóa/chứng thư đã có vào hệ thống quản lý.",
        "User, Backend, Approver, Database",
        ["User đã đăng nhập.", "User có quyền request:create.", "Không nhập private key dạng rõ."],
        ["User chọn “Đăng ký tài sản”.", "Nhập loại, owner, thuật toán, thời hạn, fingerprint/serial và provider reference.",
         "Backend kiểm tra định dạng, trùng lặp và policy.", "Backend tạo request PENDING và Audit Log.",
         "Approver xem thông tin và xác minh phạm vi.", "Nếu approve, hệ thống tạo Crypto Asset ở ACTIVE/REGISTERED theo quy tắc.",
         "User nhận notification và thấy asset trong danh sách."],
        ["Tài sản có mã quản lý và owner rõ ràng.", "Request, decision và asset liên kết để truy vết."],
        ["Fingerprint/serial trùng: trả 409.", "Thuật toán không phù hợp: trả 422.", "Bị từ chối: request REJECTED, không tạo asset."])

    add_section_break(doc)
    add_process(doc, "QT03", "Yêu cầu cấp phát mới", "Cấp một khóa/chứng thư mới sau khi được phê duyệt.",
        "User, Backend, Approver, Worker, Crypto Provider",
        ["User đang hoạt động.", "Policy có cấu hình hợp lệ.", "Crypto Provider sẵn sàng hoặc có mock provider."],
        ["User điền form cấp mới.", "Backend validate và tạo request PENDING.", "Approver mở request, xem policy check và đưa ra quyết định.",
         "Backend kiểm tra creator khác approver và ghi decision trong transaction.", "Nếu approved, backend enqueue provisioning job.",
         "Worker chuyển request PROCESSING và gọi provider.", "Provider trả metadata và reference.",
         "Worker tạo asset, chuyển request COMPLETED, ghi Audit Log và notification."],
        ["Tài sản mới ở ACTIVE.", "Private key không xuất hiện trong database hoặc log.", "User nhận kết quả."],
        ["Approver tự duyệt: SOD_VIOLATION.", "Provider lỗi: request FAILED và retry.", "Hai Approver cùng xử lý: một thành công, một nhận 409."])

    add_figure(doc, diagram_request_decision(), "Hình 3. Kiểm tra quyền, phạm vi và SoD trong phê duyệt")

    add_process(doc, "QT04", "Gia hạn hoặc thay thế", "Duy trì hiệu lực mà vẫn bảo toàn lịch sử tài sản cũ.",
        "User, Backend, Approver, Worker, Crypto Provider",
        ["User là owner.", "Asset ở ACTIVE, EXPIRING_SOON hoặc trạng thái được policy cho phép.", "Không có request gia hạn đang mở."],
        ["User chọn asset và yêu cầu gia hạn.", "Backend kiểm tra owner, trạng thái và request trùng.", "Approver phê duyệt theo SoD.",
         "Worker yêu cầu provider cấp tài sản kế tiếp.", "Hệ thống tạo asset mới và liên kết replaces_asset_id.",
         "Asset cũ chuyển SUPERSEDED khi asset mới có hiệu lực.", "Ghi Audit Log và thông báo."],
        ["Asset mới ACTIVE và tuân thủ policy hiện tại.", "Asset cũ còn nguyên trong lịch sử."],
        ["Asset REVOKED: không gia hạn.", "Provider thất bại: request FAILED.", "Policy mới không chấp nhận tham số cũ: yêu cầu điều chỉnh."])

    add_section_break(doc)
    add_process(doc, "QT05", "Thu hồi tài sản", "Chấm dứt hiệu lực tài sản có rủi ro hoặc không còn sử dụng.",
        "User, Backend, Approver, Worker, Crypto Provider",
        ["User là owner hoặc có quyền phù hợp.", "Asset chưa REVOKED.", "Có lý do thu hồi."],
        ["User chọn asset, lý do và mức khẩn cấp.", "Backend tạo request và ưu tiên emergency.", "Approver xem cảnh báo, policy và lịch sử.",
         "Approver phê duyệt; backend ghi transaction.", "Worker gọi provider revoke.", "Asset chuyển REVOKED, request COMPLETED.",
         "Thông báo các bên liên quan và ghi Audit Log."],
        ["Tài sản không còn được sử dụng.", "Lý do, người yêu cầu, người duyệt và thời gian được truy vết."],
        ["Provider tạm lỗi: retry có giới hạn.", "Asset đã thu hồi: trả 409/422.", "Yêu cầu bị từ chối: giữ nguyên trạng thái asset."])

    add_process(doc, "QT06", "Phê duyệt hoặc từ chối", "Bảo đảm một quyết định hợp lệ, có trách nhiệm và không xung đột.",
        "Approver, Backend, Database",
        ["Request đang PENDING.", "Approver đã đăng nhập và có scope."],
        ["Approver mở chi tiết request.", "Backend kiểm tra permission request:approve.", "Backend kiểm tra department scope.",
         "Backend kiểm tra creator_id khác approver_id.", "Approver chọn approve hoặc reject; reject bắt buộc lý do.",
         "Transaction khóa/so sánh version, ghi decision, cập nhật status và Audit Log.", "Nếu approve, tạo outbox/job; nếu reject, thông báo creator."],
        ["Chỉ một quyết định cuối cùng có hiệu lực.", "Mọi quyết định có actor, thời gian và comment."],
        ["Sai scope: 403/404.", "Self-approval: 422 SOD_VIOLATION.", "Request đã xử lý: 409 Conflict.", "Transaction lỗi: rollback toàn bộ."])

    add_section_break(doc)
    add_process(doc, "QT07", "Nhắc hết hạn", "Cảnh báo chủ sở hữu theo các mốc policy trước khi tài sản hết hiệu lực.",
        "Scheduler, Policy Engine, Database, Notification Service, Email Service",
        ["Policy có mốc cảnh báo.", "Asset có expires_at hợp lệ.", "Scheduler và queue hoạt động."],
        ["Scheduler lấy distributed lock.", "Nạp policy 30/7/1 ngày.", "Truy vấn asset ACTIVE/EXPIRING_SOON đủ điều kiện.",
         "Tạo deduplication key theo asset, threshold và ngày.", "Nếu notification chưa tồn tại, tạo bản ghi và gửi in-app/email.",
         "Cập nhật SENT/FAILED, ghi metric và Audit Log.", "Giải phóng hoặc để lock hết hạn."],
        ["Owner nhận cảnh báo đúng mốc.", "Job chạy lại không gửi trùng."],
        ["SMTP lỗi: notification FAILED và retry.", "Job trùng: lock/dedup ngăn xử lý lặp.", "Policy lỗi: job dừng an toàn và báo Admin."])

    add_figure(doc, diagram_expiry_job(), "Hình 4. Quy trình Background Job nhắc hết hạn")

    add_process(doc, "QT08", "Cập nhật trạng thái hết hạn", "Đồng bộ trạng thái tài sản với thời gian hiệu lực thực tế.",
        "Scheduler, Asset Service, Database",
        ["Asset có expires_at.", "Thời gian xử lý được chuẩn hóa UTC."],
        ["Job truy vấn asset chưa ở trạng thái terminal.", "So sánh expires_at với thời gian hiện tại.",
         "Atomic update ACTIVE/EXPIRING_SOON sang EXPIRED.", "Ghi Audit Log SYSTEM:ASSET_EXPIRED.",
         "Tạo notification nếu policy yêu cầu."],
        ["Trạng thái hiển thị đúng trên dashboard.", "Lịch sử asset có sự kiện hết hạn."],
        ["Không cập nhật REVOKED/SUPERSEDED sai quy tắc.", "Dữ liệu ngày sai: đưa vào danh sách kiểm tra và báo Admin."])

    doc.add_heading("11. Quy trình Audit Log", level=1)
    add_table(doc,
              ["Thời điểm", "Sự kiện", "Dữ liệu lưu", "Dữ liệu phải che"],
              [
                  ["Authentication", "LOGIN_SUCCESS/FAILED", "Actor, IP, time, outcome", "Password, token"],
                  ["Tạo request", "REQUEST_CREATED", "Creator, type, entity, request ID", "Private key, secret"],
                  ["Phê duyệt", "REQUEST_APPROVED /\nREQUEST_REJECTED", "Approver, decision, reason", "Token, provider credential"],
                  ["Provider", "ASSET_PROVISIONED/REVOKED", "Asset, provider reference, outcome", "Private key"],
                  ["Quản trị", "POLICY/ROLE_CHANGED", "Before/after đã lọc", "Hash mật khẩu, session"],
              ], [1700, 2600, 3100, 1960])

    doc.add_heading("12. Các trường hợp lỗi xuyên suốt", level=1)
    add_table(doc,
              ["Mã", "Tình huống", "Phản hồi", "Hành động hệ thống"],
              [
                  ["401", "Token thiếu/hết hạn", "Unauthorized", "Yêu cầu đăng nhập/làm mới phiên"],
                  ["403", "Không đủ quyền/scope", "Forbidden", "Không trả dữ liệu nhạy cảm; ghi denied audit"],
                  ["409", "Xung đột trạng thái", "Conflict", "Refresh dữ liệu; không ghi quyết định thứ hai"],
                  ["422", "Vi phạm policy/SoD", "Business error", "Trả mã lỗi dễ hiểu; giữ nguyên dữ liệu"],
                  ["503", "Provider/email tạm lỗi", "Unavailable", "Đưa job retry; hiển thị trạng thái phù hợp"],
              ], [900, 2800, 2000, 3660], center_cols=(0,))

    doc.add_heading("13. Kịch bản demo xuyên suốt", level=1)
    add_list(doc, [
        "User đăng nhập và tạo yêu cầu cấp chứng thư.",
        "Approver đăng nhập bằng profile riêng, mở Approval Queue và phê duyệt.",
        "Hệ thống hiển thị trạng thái PROCESSING rồi COMPLETED; asset mới xuất hiện.",
        "User tạo yêu cầu thu hồi khẩn cấp cho một khóa đã seed.",
        "Approver xử lý; asset chuyển REVOKED và không thể kích hoạt lại.",
        "Security Admin xem policy, RBAC và Audit Log nhưng không có nút/quyền approve.",
        "Nhóm kích hoạt job demo; notification hết hạn xuất hiện một lần và có email trong MailHog.",
        "Kết thúc bằng API test chứng minh User không xem asset của người khác và không tự duyệt.",
    ], ordered=True)

    doc.add_heading("14. Tiêu chí nghiệm thu quy trình", level=1)
    add_list(doc, [
        "Luồng thành công và luồng ngoại lệ của các chức năng chính đều có thể demo.",
        "State transition không hợp lệ bị backend từ chối.",
        "Approval, status và Audit Log nhất quán khi transaction rollback.",
        "Background Job idempotent và có retry.",
        "Mọi quy trình tuân thủ RBAC, object scope và SoD.",
        "Không có dữ liệu nhạy cảm xuất hiện trong giao diện, response hoặc log ngoài phạm vi cho phép.",
    ])

    path = OUT / "03_Quy_trinh_hoat_dong_phan_mem.docx"
    doc.save(path)
    return path


def main():
    paths = [build_doc1(), build_doc2(), build_doc3()]
    for path in paths:
        print(path)


if __name__ == "__main__":
    main()
