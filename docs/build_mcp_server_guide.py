from __future__ import annotations

from datetime import date
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK, WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor


ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "MCP_Server_Implementation_Guide.docx"
DIAGRAM = ROOT / ".mcp_architecture.png"

BLUE = "2E74B5"
DARK_BLUE = "1F4D78"
INK = "0B2545"
MUTED = "5B6573"
LIGHT_BLUE = "E8EEF5"
LIGHT_GRAY = "F2F4F7"
CALLOUT = "F4F6F9"
WHITE = "FFFFFF"
GREEN = "287A55"
GOLD = "9A6B00"
RED = "9B1C1C"

CONTENT_DXA = 9360
TABLE_INDENT_DXA = 120
CELL_TOP_BOTTOM = 80
CELL_START_END = 120


def set_cell_shading(cell, fill: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_margins(cell) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for side, value in (
        ("top", CELL_TOP_BOTTOM),
        ("bottom", CELL_TOP_BOTTOM),
        ("start", CELL_START_END),
        ("end", CELL_START_END),
    ):
        node = tc_mar.find(qn(f"w:{side}"))
        if node is None:
            node = OxmlElement(f"w:{side}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def set_cell_width(cell, width_dxa: int) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    tc_w = tc_pr.find(qn("w:tcW"))
    if tc_w is None:
        tc_w = OxmlElement("w:tcW")
        tc_pr.append(tc_w)
    tc_w.set(qn("w:w"), str(width_dxa))
    tc_w.set(qn("w:type"), "dxa")


def set_table_geometry(table, widths: list[int]) -> None:
    if sum(widths) != CONTENT_DXA:
        raise ValueError(f"Table widths must total {CONTENT_DXA} DXA")
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    table.autofit = False
    tbl_pr = table._tbl.tblPr
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
    for width in widths:
        col = OxmlElement("w:gridCol")
        col.set(qn("w:w"), str(width))
        grid.append(col)
    for row in table.rows:
        for index, cell in enumerate(row.cells):
            set_cell_width(cell, widths[index])
            set_cell_margins(cell)
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER


def repeat_header(row) -> None:
    tr_pr = row._tr.get_or_add_trPr()
    tbl_header = OxmlElement("w:tblHeader")
    tbl_header.set(qn("w:val"), "true")
    tr_pr.append(tbl_header)


def keep_row_together(row) -> None:
    tr_pr = row._tr.get_or_add_trPr()
    cant_split = OxmlElement("w:cantSplit")
    tr_pr.append(cant_split)


def set_repeat_header_and_rows(table) -> None:
    repeat_header(table.rows[0])
    for row in table.rows:
        keep_row_together(row)


def set_run_font(run, name: str = "Calibri", size: float | None = None) -> None:
    run.font.name = name
    run._element.get_or_add_rPr().rFonts.set(qn("w:ascii"), name)
    run._element.get_or_add_rPr().rFonts.set(qn("w:hAnsi"), name)
    if size is not None:
        run.font.size = Pt(size)


def set_style_font(style, name: str, size: float, color: str | None = None) -> None:
    style.font.name = name
    style._element.get_or_add_rPr().rFonts.set(qn("w:ascii"), name)
    style._element.get_or_add_rPr().rFonts.set(qn("w:hAnsi"), name)
    style.font.size = Pt(size)
    if color:
        style.font.color.rgb = RGBColor.from_string(color)


def set_paragraph_shading(paragraph, fill: str, left_border: str | None = None) -> None:
    p_pr = paragraph._p.get_or_add_pPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:fill"), fill)
    p_pr.append(shd)
    if left_border:
        p_bdr = OxmlElement("w:pBdr")
        left = OxmlElement("w:left")
        left.set(qn("w:val"), "single")
        left.set(qn("w:sz"), "18")
        left.set(qn("w:space"), "8")
        left.set(qn("w:color"), left_border)
        p_bdr.append(left)
        p_pr.append(p_bdr)


def add_page_field(paragraph) -> None:
    run = paragraph.add_run()
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instruction = OxmlElement("w:instrText")
    instruction.set(qn("xml:space"), "preserve")
    instruction.text = " PAGE "
    separate = OxmlElement("w:fldChar")
    separate.set(qn("w:fldCharType"), "separate")
    text = OxmlElement("w:t")
    text.text = "1"
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    run._r.extend([begin, instruction, separate, text, end])


def add_custom_numbering(document: Document) -> tuple[int, int]:
    numbering = document.part.numbering_part.element
    abstract_ids = [
        int(node.get(qn("w:abstractNumId")))
        for node in numbering.findall(qn("w:abstractNum"))
    ]
    num_ids = [int(node.get(qn("w:numId"))) for node in numbering.findall(qn("w:num"))]
    next_abstract = max(abstract_ids, default=0) + 1
    next_num = max(num_ids, default=0) + 1

    def create_definition(abstract_id: int, num_id: int, fmt: str, text: str) -> None:
        abstract = OxmlElement("w:abstractNum")
        abstract.set(qn("w:abstractNumId"), str(abstract_id))
        multi = OxmlElement("w:multiLevelType")
        multi.set(qn("w:val"), "singleLevel")
        abstract.append(multi)
        level = OxmlElement("w:lvl")
        level.set(qn("w:ilvl"), "0")
        start = OxmlElement("w:start")
        start.set(qn("w:val"), "1")
        num_fmt = OxmlElement("w:numFmt")
        num_fmt.set(qn("w:val"), fmt)
        lvl_text = OxmlElement("w:lvlText")
        lvl_text.set(qn("w:val"), text)
        suff = OxmlElement("w:suff")
        suff.set(qn("w:val"), "tab")
        p_pr = OxmlElement("w:pPr")
        tabs = OxmlElement("w:tabs")
        tab = OxmlElement("w:tab")
        tab.set(qn("w:val"), "num")
        tab.set(qn("w:pos"), "540")
        tabs.append(tab)
        indent = OxmlElement("w:ind")
        indent.set(qn("w:left"), "540")
        indent.set(qn("w:hanging"), "270")
        spacing = OxmlElement("w:spacing")
        spacing.set(qn("w:after"), "80")
        spacing.set(qn("w:line"), "300")
        spacing.set(qn("w:lineRule"), "auto")
        p_pr.extend([tabs, indent, spacing])
        level.extend([start, num_fmt, lvl_text, suff, p_pr])
        abstract.append(level)
        numbering.append(abstract)

        num = OxmlElement("w:num")
        num.set(qn("w:numId"), str(num_id))
        abstract_ref = OxmlElement("w:abstractNumId")
        abstract_ref.set(qn("w:val"), str(abstract_id))
        num.append(abstract_ref)
        numbering.append(num)

    create_definition(next_abstract, next_num, "bullet", "•")
    create_definition(next_abstract + 1, next_num + 1, "decimal", "%1.")
    return next_num, next_num + 1


def apply_numbering(paragraph, num_id: int) -> None:
    p_pr = paragraph._p.get_or_add_pPr()
    num_pr = OxmlElement("w:numPr")
    ilvl = OxmlElement("w:ilvl")
    ilvl.set(qn("w:val"), "0")
    num_id_node = OxmlElement("w:numId")
    num_id_node.set(qn("w:val"), str(num_id))
    num_pr.extend([ilvl, num_id_node])
    p_pr.append(num_pr)


def restart_numbering(document: Document, base_num_id: int) -> int:
    numbering = document.part.numbering_part.element
    base_num = next(
        node
        for node in numbering.findall(qn("w:num"))
        if int(node.get(qn("w:numId"))) == base_num_id
    )
    abstract_ref = base_num.find(qn("w:abstractNumId"))
    if abstract_ref is None:
        raise ValueError("Base numbering definition has no abstract reference")
    abstract_id = abstract_ref.get(qn("w:val"))
    next_num_id = (
        max(
            (int(node.get(qn("w:numId"))) for node in numbering.findall(qn("w:num"))),
            default=0,
        )
        + 1
    )
    num = OxmlElement("w:num")
    num.set(qn("w:numId"), str(next_num_id))
    new_abstract_ref = OxmlElement("w:abstractNumId")
    new_abstract_ref.set(qn("w:val"), str(abstract_id))
    override = OxmlElement("w:lvlOverride")
    override.set(qn("w:ilvl"), "0")
    start_override = OxmlElement("w:startOverride")
    start_override.set(qn("w:val"), "1")
    override.append(start_override)
    num.extend([new_abstract_ref, override])
    numbering.append(num)
    return next_num_id


def configure_document(document: Document) -> tuple[int, int]:
    section = document.sections[0]
    section.page_width = Inches(8.5)
    section.page_height = Inches(11)
    section.top_margin = Inches(1)
    section.right_margin = Inches(1)
    section.bottom_margin = Inches(1)
    section.left_margin = Inches(1)
    section.header_distance = Inches(0.492)
    section.footer_distance = Inches(0.492)
    section.different_first_page_header_footer = True

    styles = document.styles
    normal = styles["Normal"]
    set_style_font(normal, "Calibri", 11, "222222")
    normal.paragraph_format.space_before = Pt(0)
    normal.paragraph_format.space_after = Pt(6)
    normal.paragraph_format.line_spacing = 1.25

    for name, size, color, before, after in (
        ("Heading 1", 16, BLUE, 18, 10),
        ("Heading 2", 13, BLUE, 14, 7),
        ("Heading 3", 12, DARK_BLUE, 10, 5),
    ):
        style = styles[name]
        set_style_font(style, "Calibri", size, color)
        style.font.bold = True
        style.paragraph_format.space_before = Pt(before)
        style.paragraph_format.space_after = Pt(after)
        style.paragraph_format.keep_with_next = True
        style.paragraph_format.widow_control = True

    subtitle = styles["Subtitle"]
    set_style_font(subtitle, "Calibri", 14, MUTED)
    subtitle.paragraph_format.space_after = Pt(12)

    code_style = styles.add_style("Code Block", 1)
    set_style_font(code_style, "Consolas", 9, INK)
    code_style.paragraph_format.left_indent = Inches(0.15)
    code_style.paragraph_format.right_indent = Inches(0.15)
    code_style.paragraph_format.space_before = Pt(4)
    code_style.paragraph_format.space_after = Pt(8)
    code_style.paragraph_format.line_spacing_rule = WD_LINE_SPACING.SINGLE
    code_style.paragraph_format.keep_together = True

    caption = styles["Caption"]
    set_style_font(caption, "Calibri", 9, MUTED)
    caption.font.italic = True
    caption.paragraph_format.space_before = Pt(4)
    caption.paragraph_format.space_after = Pt(8)
    caption.paragraph_format.keep_with_next = True

    header = section.header
    p = header.paragraphs[0]
    p.text = "Reusable MCP Server Implementation Guide"
    p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    p.paragraph_format.space_after = Pt(0)
    run = p.runs[0]
    set_run_font(run, size=9)
    run.font.color.rgb = RGBColor.from_string(MUTED)

    footer = section.footer
    p = footer.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.space_after = Pt(0)
    run = p.add_run("Page ")
    set_run_font(run, size=9)
    run.font.color.rgb = RGBColor.from_string(MUTED)
    add_page_field(p)
    for footer_run in p.runs:
        set_run_font(footer_run, size=9)
        footer_run.font.color.rgb = RGBColor.from_string(MUTED)

    return add_custom_numbering(document)


def add_bullet(document: Document, text: str, bullet_num_id: int) -> None:
    p = document.add_paragraph()
    apply_numbering(p, bullet_num_id)
    p.add_run(text)


def add_step(document: Document, text: str, decimal_num_id: int) -> None:
    p = document.add_paragraph()
    apply_numbering(p, decimal_num_id)
    p.add_run(text)


def add_callout(document: Document, label: str, text: str, color: str = BLUE) -> None:
    p = document.add_paragraph()
    p.paragraph_format.left_indent = Inches(0.15)
    p.paragraph_format.right_indent = Inches(0.08)
    p.paragraph_format.space_before = Pt(6)
    p.paragraph_format.space_after = Pt(10)
    set_paragraph_shading(p, CALLOUT, color)
    label_run = p.add_run(f"{label}: ")
    label_run.bold = True
    label_run.font.color.rgb = RGBColor.from_string(color)
    p.add_run(text)


def add_code(document: Document, code: str) -> None:
    p = document.add_paragraph(style="Code Block")
    set_paragraph_shading(p, LIGHT_GRAY)
    for index, line in enumerate(code.strip("\n").splitlines()):
        if index:
            p.add_run().add_break()
        p.add_run(line)


def add_table(
    document: Document,
    headers: list[str],
    rows: list[list[str]],
    widths: list[int],
) -> None:
    table = document.add_table(rows=1, cols=len(headers))
    table.style = "Table Grid"
    header_cells = table.rows[0].cells
    for index, header in enumerate(headers):
        header_cells[index].text = header
        set_cell_shading(header_cells[index], LIGHT_BLUE)
        for run in header_cells[index].paragraphs[0].runs:
            run.bold = True
            run.font.color.rgb = RGBColor.from_string(INK)
    for row_data in rows:
        cells = table.add_row().cells
        for index, value in enumerate(row_data):
            cells[index].text = value
            for paragraph in cells[index].paragraphs:
                paragraph.paragraph_format.space_before = Pt(0)
                paragraph.paragraph_format.space_after = Pt(2)
                paragraph.paragraph_format.line_spacing = 1.1
                for run in paragraph.runs:
                    set_run_font(run, size=9.5)
    set_table_geometry(table, widths)
    set_repeat_header_and_rows(table)
    after = document.add_paragraph()
    after.paragraph_format.space_before = Pt(4)
    after.paragraph_format.space_after = Pt(2)


def load_font(size: int, bold: bool = False):
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Helvetica.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for candidate in candidates:
        path = Path(candidate)
        if path.exists():
            return ImageFont.truetype(str(path), size=size)
    return ImageFont.load_default()


def create_architecture_diagram() -> None:
    image = Image.new("RGB", (1800, 1050), f"#{WHITE}")
    draw = ImageDraw.Draw(image)
    title_font = load_font(46, bold=True)
    heading_font = load_font(30, bold=True)
    body_font = load_font(24)
    small_font = load_font(21)

    draw.text((90, 52), "Reusable MCP Architecture", fill="#0B2545", font=title_font)

    def rounded_box(x1, y1, x2, y2, fill, outline, heading, body=None):
        draw.rounded_rectangle((x1, y1, x2, y2), radius=24, fill=fill, outline=outline, width=4)
        heading_box = draw.textbbox((0, 0), heading, font=heading_font)
        heading_width = heading_box[2] - heading_box[0]
        draw.text(((x1 + x2 - heading_width) / 2, y1 + 26), heading, fill="#0B2545", font=heading_font)
        if body:
            lines = body.split("\n")
            y = y1 + 82
            for line in lines:
                line_box = draw.textbbox((0, 0), line, font=small_font)
                line_width = line_box[2] - line_box[0]
                draw.text(((x1 + x2 - line_width) / 2, y), line, fill="#374151", font=small_font)
                y += 30

    def arrow(x1, y1, x2, y2):
        draw.line((x1, y1, x2, y2), fill="#5B6573", width=6)
        if y2 >= y1:
            draw.polygon(((x2 - 12, y2 - 18), (x2 + 12, y2 - 18), (x2, y2)), fill="#5B6573")
        else:
            draw.polygon(((x2 - 12, y2 + 18), (x2 + 12, y2 + 18), (x2, y2)), fill="#5B6573")

    rounded_box(120, 145, 650, 280, "#E8EEF5", "#2E74B5", "In-app chatbot", "Signed-in user context")
    rounded_box(1150, 145, 1680, 280, "#E8EEF5", "#2E74B5", "External agents", "Standard MCP clients")
    rounded_box(515, 350, 1285, 490, "#F2F4F7", "#5B6573", "Trusted application adapter", "Authentication • actor context • conversation state")
    arrow(385, 280, 725, 350)
    arrow(1415, 280, 1075, 350)

    draw.rounded_rectangle((90, 555, 1710, 875), radius=28, fill="#F8FAFC", outline="#1F4D78", width=5)
    draw.text((130, 580), "MCP server boundary", fill="#1F4D78", font=heading_font)
    rounded_box(145, 650, 610, 820, "#EAF6F0", "#287A55", "Read path", "Catalog → semantic plan\nvalidation → role scope\nparameterized query")
    rounded_box(670, 650, 1130, 820, "#FFF7DF", "#9A6B00", "Write path", "Explicit command → gather fields\nconfirm → transaction\nreturn committed record")
    rounded_box(1190, 650, 1655, 820, "#F4F6F9", "#5B6573", "Shared controls", "Errors • limits • audit logs\nexplanations • observability")
    arrow(900, 490, 900, 555)

    rounded_box(515, 895, 1285, 1035, "#E8EEF5", "#2E74B5", "Application database", "Dedicated least-privilege DB user")
    arrow(900, 875, 900, 895)
    image.save(DIAGRAM)


def add_cover(document: Document) -> None:
    p = document.add_paragraph()
    p.paragraph_format.space_before = Pt(72)
    p.paragraph_format.space_after = Pt(18)
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = p.add_run("ENGINEERING FIELD GUIDE")
    set_run_font(run, size=11)
    run.bold = True
    run.font.color.rgb = RGBColor.from_string(BLUE)

    p = document.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(12)
    run = p.add_run("Building a Reusable MCP Server")
    set_run_font(run, size=30)
    run.bold = True
    run.font.color.rgb = RGBColor.from_string(INK)

    p = document.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(28)
    run = p.add_run("Secure data access, semantic reads, explicit writes, and agent integration")
    set_run_font(run, size=15)
    run.font.color.rgb = RGBColor.from_string(DARK_BLUE)

    p = document.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.left_indent = Inches(0.65)
    p.paragraph_format.right_indent = Inches(0.65)
    p.paragraph_format.space_before = Pt(14)
    p.paragraph_format.space_after = Pt(30)
    p.add_run(
        "A practical blueprint distilled from the ACARSH CRM implementation, designed "
        "to be adapted to other database-backed applications without giving an LLM "
        "unrestricted database access."
    )

    p = document.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(72)
    p.paragraph_format.space_after = Pt(4)
    run = p.add_run("Version 1.0")
    run.bold = True
    run.font.color.rgb = RGBColor.from_string(MUTED)
    p = document.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(0)
    run = p.add_run(date.today().strftime("%B %d, %Y"))
    run.font.color.rgb = RGBColor.from_string(MUTED)
    document.add_page_break()


def build_document() -> None:
    create_architecture_diagram()
    document = Document()
    bullet_id, decimal_id = configure_document(document)
    add_cover(document)

    document.add_heading("How to use this guide", level=1)
    document.add_paragraph(
        "This guide describes a repeatable MCP server architecture for applications that "
        "store operational data in a relational database and need to expose that data to "
        "an in-product assistant or another MCP-compatible agent. It is an implementation "
        "overview, a security checklist, and a handoff document for engineers."
    )
    add_callout(
        document,
        "Core rule",
        "Let the model express intent as a constrained plan or an explicit domain command. "
        "Let deterministic server code validate authorization, compile queries, execute "
        "transactions, and decide what data may leave the system.",
    )

    document.add_heading("Contents at a glance", level=2)
    for item in (
        "Architecture and trust boundaries",
        "Cataloging entities, fields, relationships, and roles",
        "Simple reads, semantic query planning, and explainability",
        "Explicit insert/update/delete commands and confirmation",
        "Chatbot integration, history, and validation repair",
        "Database access, deployment, testing, and operational readiness",
        "A step-by-step reuse checklist for another application",
    ):
        add_bullet(document, item, bullet_id)

    document.add_heading("1. The architecture in one page", level=1)
    document.add_paragraph(
        "An MCP server should be treated as a governed application service, not as a thin "
        "wrapper around a database driver. The model chooses a tool and supplies structured "
        "arguments. The MCP server remains responsible for every security-sensitive decision."
    )
    architecture_picture = document.add_picture(str(DIAGRAM), width=Inches(6.45))
    architecture_picture._inline.docPr.set(
        "descr",
        "Architecture flow from in-app chatbot and external MCP clients through a trusted "
        "application adapter into an MCP server with separate read, write, and shared-control "
        "paths, ending at a least-privilege application database.",
    )
    architecture_picture._inline.docPr.set("title", "Reusable MCP architecture")
    caption = document.add_paragraph(style="Caption")
    caption.alignment = WD_ALIGN_PARAGRAPH.CENTER
    caption.add_run("Figure 1. A reusable separation between clients, trusted identity, MCP policy, and the database.")

    add_table(
        document,
        ["Layer", "Primary responsibility", "Reusable artifact"],
        [
            ["Client", "Collect the user request and show answers or confirmation controls.", "Chat UI or any MCP client"],
            ["Application adapter", "Resolve the signed-in actor and carry trusted context to MCP.", "Server-only MCP client wrapper"],
            ["MCP contract", "Expose discoverable tools, resources, prompts, and strict schemas.", "server.py and Pydantic models"],
            ["Policy and catalog", "Define what can be read, related, sorted, aggregated, or changed.", "catalog.py and access.py"],
            ["Services", "Compile safe reads and execute transaction-backed domain commands.", "query.py, semantic.py, domain service"],
            ["Database adapter", "Manage connections, parameter binding, transactions, and error translation.", "db.py plus a dedicated DB account"],
        ],
        [1500, 4320, 3540],
    )

    document.add_heading("2. Decisions to make before writing tools", level=1)
    document.add_paragraph(
        "The quality of the MCP server depends more on the domain inventory than on the "
        "framework. Begin by documenting the application rather than immediately exposing tables."
    )
    section_steps = restart_numbering(document, decimal_id)
    for step in (
        "Inventory user-visible entities and workflows. Start with concepts such as leads, activities, projects, invoices, or tickets—not raw table names.",
        "Map roles and ownership. Identify which role can see organization-wide records, owned records, child records, or controlled lookup values.",
        "Record soft-delete, tenancy, archival, and status predicates that must be applied to every query.",
        "Identify natural references users actually say: company name, project code, contact name, or ticket number.",
        "Separate read questions from state-changing actions. Reads may use a query planner; writes should remain explicit commands.",
        "List sensitive fields and whether they may be selected, filtered, sorted, aggregated, logged, or returned to an LLM.",
    ):
        add_step(document, step, section_steps)

    add_callout(
        document,
        "Do not expose the schema automatically",
        "A database may contain internal tables, credentials, audit data, deleted records, or "
        "columns whose names do not reflect business meaning. Build an intentional catalog.",
        RED,
    )

    document.add_heading("3. Build a safe semantic catalog", level=1)
    document.add_paragraph(
        "The catalog is the contract between natural-language intent and database structure. "
        "It gives the model stable business names while keeping table names and SQL expressions "
        "inside trusted code."
    )
    document.add_heading("3.1 Field specification", level=2)
    add_code(
        document,
        '''FieldSpec(
    expression="l.CompanyName",       # server-owned SQL expression
    kind="string",
    description="Company or organization name",
    filterable=True,
    sortable=True,
    aggregatable=False,
    sensitive=False,
)''',
    )
    document.add_paragraph(
        "Expose the business key company_name to MCP clients; retain l.CompanyName only inside "
        "the catalog. Apply the same rule to joins, computed values, and soft-delete predicates."
    )

    document.add_heading("3.2 Entity and relationship specifications", level=2)
    add_code(
        document,
        '''EntitySpec(
    name="activities",
    description="Activities recorded against a customer or lead",
    primary_key="id",
    fields={...},
    default_fields=("id", "company_name", "type", "date"),
    default_sort=(("date", "desc"),),
    base_predicates=("COALESCE(l.IsDeleted, 0) = 0",),
)

RelationshipSpec(
    source_entity="activities",
    name="lead",
    target_entity="leads",
    source_field="lead_id",
    target_field="id",
)''',
    )
    document.add_paragraph(
        "Relationships must be allow-listed and named in domain language. A one-hop relationship "
        "catalog supports many useful questions without permitting arbitrary joins. Add deeper or "
        "specialized relationships deliberately when a real use case requires them."
    )

    document.add_heading("4. Authentication and authorization", level=1)
    document.add_paragraph(
        "The model must never provide user_id, role_id, tenant_id, or permissions. Resolve the actor "
        "from a trusted application session, then pass it to MCP through a server-only channel."
    )
    add_table(
        document,
        ["Connection mode", "Recommended identity mechanism", "Important constraint"],
        [
            ["In-product chatbot", "Application validates session; server passes signed or internal actor context.", "Browser must never receive the internal MCP token."],
            ["Local trusted STDIO", "Explicit default actor for development or a user-bound local process.", "Do not use a shared production actor."],
            ["Remote third-party client", "OAuth or independently validated access token at the MCP boundary.", "Do not trust caller-supplied role headers."],
        ],
        [1850, 4050, 3460],
    )
    document.add_heading("4.1 Enforce scope below the model", level=2)
    add_code(
        document,
        '''class AccessPolicy:
    def for_entity(entity, actor):
        if actor.is_manager:
            return organization_scope()
        if entity == "leads":
            return predicate("owner_id = :actor_id", actor.id)
        if entity == "activities":
            return predicate("lead_owner = :actor_id OR created_by = :actor_id", actor.id)
        raise AccessDenied()''',
    )
    add_callout(
        document,
        "Defense in depth",
        "Apply access scope in query compilation and again in write-domain services. Tool prompts "
        "are guidance; authorization code is enforcement.",
        GREEN,
    )

    document.add_heading("5. Design the read surface", level=1)
    document.add_paragraph(
        "Use multiple read tools, each matched to a level of complexity. This reduces model errors "
        "and keeps common questions fast while retaining a safe path for harder questions."
    )
    document.add_heading("5.1 Discovery and direct tools", level=2)
    for item in (
        "list_capabilities — entities, lookups, supported writes, and access summary.",
        "describe_entity — fields, descriptions, allowed operations, defaults, and relationships.",
        "get_record — one role-scoped record by identifier.",
        "get_company_contacts — a deterministic tool for a high-value recurring question.",
        "list_lookup_values — valid statuses, types, roles, and other controlled values.",
    ):
        add_bullet(document, item, bullet_id)

    document.add_heading("5.2 Simple structured search", level=2)
    document.add_paragraph(
        "Use search_records for one entity, AND-combined filters, selected fields, sorting, and "
        "pagination. Validate every field against the catalog and parameterize every value."
    )
    add_code(
        document,
        '''{
  "entity": "activities",
  "filters": [{"field": "date", "operator": "gte", "value": "this_month"}],
  "fields": ["company_name", "type", "subject", "date", "status"],
  "sort": [{"field": "date", "direction": "desc"}],
  "limit": 25
}''',
    )

    document.add_heading("5.3 Aggregate reads", level=2)
    document.add_paragraph(
        "Use aggregate_records for counts, grouping, and simple metrics. Metric functions and fields "
        "must be allow-listed; aliases must be validated before they become result-column names."
    )

    document.add_heading("6. Semantic query planning for complex questions", level=1)
    document.add_paragraph(
        "A semantic query planner is the safe middle ground between a rigid collection of tools and "
        "unrestricted text-to-SQL. The LLM generates a bounded JSON plan. The MCP server converts "
        "that plan into parameterized, role-scoped SQL."
    )
    add_callout(
        document,
        "Why not raw SQL",
        "Raw SQL lets the model choose tables, joins, expressions, and potentially write operations. "
        "A semantic plan lets the model choose only catalog names and approved operators.",
        RED,
    )
    document.add_heading("6.1 Recommended plan contract", level=2)
    for item in (
        "entity and selected fields",
        "top-level filters and bounded all/any filter groups",
        "allow-listed relationship conditions using exists, not_exists, min_count, or max_count",
        "group_by, metrics, HAVING conditions, and aggregate sorting",
        "bounded limit and offset",
    ):
        add_bullet(document, item, bullet_id)

    document.add_heading("6.2 Example: prospects with no recent activity", level=2)
    add_code(
        document,
        '''{
  "entity": "leads",
  "fields": ["company_name", "owner_name", "status"],
  "filters": [
    {"field": "account_type", "operator": "eq", "value": "Prospect"}
  ],
  "related": [
    {
      "relationship": "activities",
      "quantifier": "not_exists",
      "filters": [
        {"field": "date", "operator": "gte", "value": "last_30_days"}
      ]
    }
  ],
  "limit": 25
}''',
    )
    document.add_heading("6.3 Compilation sequence", level=2)
    section_steps = restart_numbering(document, decimal_id)
    for step in (
        "Validate the entity, fields, operators, metrics, aliases, relationship names, and limits.",
        "Resolve relative periods such as today, this_month, last_quarter, or last_30_days in the configured business timezone.",
        "Build a role-scoped base query that already includes tenant, owner, and soft-delete predicates.",
        "Compile related conditions as correlated EXISTS/NOT EXISTS or bounded related counts.",
        "Bind user values as parameters. Never interpolate values, aliases, columns, or directions from free text.",
        "Execute through a read-only database method and return records plus a non-SQL explanation.",
    ):
        add_step(document, step, section_steps)

    document.add_heading("7. Make every read explainable", level=1)
    document.add_paragraph(
        "A good result contains enough metadata for the assistant to explain what happened without "
        "exposing SQL or security headers. Use a consistent response envelope."
    )
    add_code(
        document,
        '''{
  "status": "ok",
  "entity": "leads",
  "mode": "records",
  "items": [...],
  "pagination": {"limit": 25, "offset": 0, "returned": 2, "total": 2},
  "explanation": {
    "access_scope": "role_scoped_records",
    "filters": [...],
    "relationships": [...],
    "resolved_period": {"start": "...", "end_exclusive": "..."},
    "parameterized": true,
    "raw_sql_accepted": false
  }
}''',
    )
    document.add_paragraph(
        "The assistant should summarize the entity, role scope, date range, filters, relationships, "
        "calculations, and empty-result state in plain language. It should never infer rows after a "
        "tool error."
    )

    document.add_heading("8. Keep writes explicit", level=1)
    document.add_paragraph(
        "Do not use a semantic query planner or generated SQL for inserts, updates, or deletes. "
        "Expose one command per domain action: create_lead, update_activity, schedule_reminder, "
        "convert_lead, assign_project_resource, and so on."
    )
    document.add_heading("8.1 Command workflow", level=2)
    section_steps = restart_numbering(document, decimal_id)
    for step in (
        "Accept a strict draft or changes object. Allow natural string references where a safe unique resolver exists.",
        "If required fields are missing, return status=needs_input with exact field names and questions.",
        "Resolve names within the actor's permitted scope. Prefer a unique exact match; return candidates for ambiguity and never guess.",
        "Show a structured preview in the application and require an explicit Confirm or Reject action.",
        "On confirmation, re-authorize the target, validate lookups, execute one transaction, and return the committed record.",
        "Use idempotency keys for commands that may be retried across unreliable networks.",
    ):
        add_step(document, step, section_steps)

    document.add_heading("8.2 Command result states", level=2)
    add_table(
        document,
        ["Status", "Meaning", "Application behavior"],
        [
            ["needs_input", "Required values are missing or a name is ambiguous.", "Ask only the returned questions; preserve the draft."],
            ["ready_to_confirm", "A complete change has been prepared but not executed.", "Display Confirm and Reject buttons."],
            ["ok", "The transaction committed successfully.", "Show the committed record and identifier."],
            ["error", "Validation, permission, conflict, database, or internal failure.", "Stop; do not infer success or substitute data."],
        ],
        [2050, 3410, 3900],
    )

    document.add_heading("9. Integrate the chatbot reliably", level=1)
    document.add_paragraph(
        "The chatbot is an orchestrator. It should discover MCP tools at runtime, pass their schemas "
        "to the model, normalize model arguments, execute read tools, and hold writes for confirmation."
    )
    for item in (
        "Use deterministic tools for high-frequency questions such as company contact details or latest activities.",
        "Use search_records for straightforward single-entity questions and query_crm for relationships, absence, counts, boolean groups, or HAVING.",
        "If a tool schema wraps one object (for example plan), expose the inner schema to the model and reapply the wrapper before the MCP call.",
        "Coerce safe scalar representations such as digit-only strings to integers only when the MCP schema permits that type.",
        "Recover common rendered function markup only as a compatibility fallback; structured tool_calls remains the required mechanism.",
        "Retry correctable validation failures a small bounded number of times. Stop immediately on access, database, or internal failures.",
        "Persist conversation messages and pending confirmations. Treat earlier factual results as stale and re-query before stating current data.",
    ):
        add_bullet(document, item, bullet_id)

    document.add_heading("10. Database access and configuration", level=1)
    document.add_paragraph(
        "The MCP server connects to the same application database using its own least-privilege "
        "database account. The database password is the password assigned to that database user. "
        "The MCP HTTP port is separate from the database port."
    )
    add_table(
        document,
        ["Service", "Typical endpoint", "Purpose"],
        [
            ["MySQL", "127.0.0.1:3306", "Executes parameterized reads and explicit transactional commands."],
            ["MCP HTTP", "127.0.0.1:8000/mcp", "Exposes tools/resources/prompts to trusted MCP clients."],
            ["Application", "Application-defined port", "Authenticates users and hosts the chatbot UI/API."],
        ],
        [1800, 2650, 4910],
    )
    add_code(
        document,
        '''ACARSH_MCP_DB_HOST=127.0.0.1
ACARSH_MCP_DB_PORT=3306
ACARSH_MCP_DB_NAME=application_db
ACARSH_MCP_DB_USER=mcp_database
ACARSH_MCP_DB_PASSWORD=<database-user-password>

ACARSH_MCP_TRANSPORT=http
ACARSH_MCP_HOST=127.0.0.1
ACARSH_MCP_PORT=8030
ACARSH_MCP_HTTP_PATH=/mcp
ACARSH_MCP_INTERNAL_TOKEN=<long-random-server-only-token>''',
    )
    add_callout(
        document,
        "Least privilege",
        "Grant only the SELECT, INSERT, UPDATE, and narrowly required DELETE permissions for the "
        "supported workflows. Do not grant DROP, ALTER, CREATE, FILE, or global privileges.",
        GOLD,
    )

    document.add_heading("11. Recommended project layout", level=1)
    add_code(
        document,
        '''mcp-server/
├── pyproject.toml
├── config.example.env
├── src/<app>_mcp/
│   ├── server.py       # FastMCP tools, resources, prompts
│   ├── models.py       # strict request/command contracts
│   ├── catalog.py      # entities, fields, relationships, lookups
│   ├── access.py       # actor resolution and role policies
│   ├── query.py        # simple search and aggregate compiler
│   ├── semantic.py     # complex semantic-plan compiler
│   ├── domain.py       # explicit write services and transactions
│   ├── db.py           # connection and transaction adapter
│   ├── config.py       # environment validation
│   └── errors.py       # stable error taxonomy
└── tests/
    ├── test_access.py
    ├── test_query.py
    ├── test_semantic.py
    ├── test_domain.py
    └── test_server.py''',
    )
    document.add_paragraph(
        "Keep the MCP package independently runnable. The application should connect through the "
        "standard MCP protocol rather than importing the server's internal query or domain modules."
    )

    document.add_heading("12. Error taxonomy and retry policy", level=1)
    add_table(
        document,
        ["Error class", "Example", "Retry automatically?"],
        [
            ["validation_error", "Unknown field, relationship, operator, lookup, or malformed plan.", "At most one or two corrected calls; never repeat unchanged."],
            ["needs_input", "Missing required write field or ambiguous name.", "Ask the user; preserve state."],
            ["access_denied", "Actor cannot read or modify the target.", "No. Stop and explain the permitted scope."],
            ["not_found/conflict", "Missing record, duplicate value, stale version, or ambiguous target.", "Usually requires user action or a fresh lookup."],
            ["database_error", "Connection, statement execution, constraint, or transaction failure.", "No model retry; log a correlation identifier."],
            ["internal_error", "Unexpected server failure.", "No model retry; alert and investigate."],
        ],
        [1900, 4660, 2800],
    )

    document.add_heading("13. Testing strategy", level=1)
    document.add_paragraph(
        "Tests should prove both usefulness and containment. A planner that answers complex questions "
        "but can bypass role scope is not ready; a secure server whose schemas the model cannot call "
        "reliably is also not ready."
    )
    add_table(
        document,
        ["Test layer", "Minimum checks", "Evidence"],
        [
            ["Contract", "Strict schemas, forbidden extra properties, ids-or-names where intended, wrapper shape.", "Model validation and protocol tests"],
            ["Compiler", "Filters, relative dates, boolean groups, EXISTS/NOT EXISTS, counts, HAVING, limits.", "Exact SQL structure and bound parameters"],
            ["Authorization", "Manager scope, owner scope, child records, unsupported roles, inaccessible targets.", "Unit tests plus live role comparison"],
            ["Security", "Unknown fields/relationships, SQL-like aliases, oversized lists, raw SQL attempts.", "All rejected before execution"],
            ["Writes", "Missing-input flow, ambiguity, confirmation, transaction commit/rollback, idempotency.", "Domain-service tests"],
            ["Protocol", "Tool discovery, schema compatibility, resources, prompts, stable response envelopes.", "In-process MCP client tests"],
            ["Integration", "Real database query, port/configuration, chatbot-to-MCP transport, error rendering.", "Read-only smoke tests and staged writes"],
        ],
        [1700, 4780, 2880],
    )

    document.add_heading("14. Deployment and operations", level=1)
    for item in (
        "Keep MCP on localhost or a private network unless it has production-grade remote authentication.",
        "Store database credentials and internal tokens in a secret manager; never send them to the browser or model.",
        "Use connection pooling, statement timeouts, query limits, bounded offsets, and maximum tool-call depth.",
        "Log tool name, actor identifier, duration, result status, correlation id, and affected record ids—never full sensitive payloads by default.",
        "Run schema migrations separately from MCP startup. History/audit tables may share the application database, but should have explicit migrations and retention rules.",
        "Publish health checks that verify configuration and connectivity without disclosing credentials or customer data.",
        "Version tool contracts carefully. Prefer additive fields and new tools over breaking existing schemas used by other agents.",
    ):
        add_bullet(document, item, bullet_id)

    document.add_heading("15. Reuse this architecture for another application", level=1)
    document.add_paragraph(
        "The following sequence is the recommended implementation path. It avoids beginning with a "
        "generic database tool and progressively adds capability behind stable policy boundaries."
    )
    section_steps = restart_numbering(document, decimal_id)
    for step in (
        "Create a standalone FastMCP package with validated configuration and a database adapter.",
        "Document actors, roles, tenants, ownership rules, sensitive fields, and mandatory base predicates.",
        "Build the entity/field/lookup catalog and expose list_capabilities plus describe_entity.",
        "Implement access-policy compilation and test every role before adding flexible reads.",
        "Add get_record, search_records, lookup tools, and one or two deterministic high-value tools.",
        "Add aggregate_records with allow-listed metrics and grouping.",
        "Add the semantic query plan only after the catalog and access scope are stable.",
        "Implement explicit domain write commands with missing-input responses, name resolution, and transactions.",
        "Add application-level confirmation and durable pending-action state.",
        "Integrate the chatbot with runtime tool discovery, schema normalization, bounded correction, and conversation history.",
        "Run unit, protocol, role-scope, injection, and live database tests.",
        "Document connection modes so another MCP-compatible application can attach without changing domain code.",
    ):
        add_step(document, step, section_steps)

    document.add_heading("16. Definition of done", level=1)
    for item in (
        "Every exposed entity, field, relationship, metric, lookup, and command is intentionally cataloged.",
        "The model cannot supply identity, role, tenant, raw SQL, table names, or arbitrary expressions.",
        "All reads are role-scoped, parameterized, limited, and explainable.",
        "All writes are explicit, validated, transaction-backed, and confirmed before execution.",
        "Ambiguous names produce candidates; missing fields produce questions; failures never produce guessed answers.",
        "Tool schemas work with the chosen model provider and survive sequential messages and page refreshes.",
        "Automated tests cover permission boundaries, unsafe inputs, compiler behavior, protocol discovery, and live connectivity.",
        "The server can be connected from the in-product chatbot and from another approved MCP client without rewriting business logic.",
    ):
        add_bullet(document, item, bullet_id)

    add_callout(
        document,
        "Final takeaway",
        "Most database-backed MCP servers can follow this architecture. The reusable core is the "
        "contract/policy/compiler/command separation. What changes between applications is the "
        "catalog, access policy, and domain workflows—not the security model.",
        GREEN,
    )

    document.add_heading("Appendix A. Suggested MCP surface", level=1)
    add_table(
        document,
        ["Category", "Suggested tools/resources", "Use"],
        [
            ["Discovery", "list_capabilities, describe_entity, schema resources", "Teach any agent the supported domain safely."],
            ["Direct reads", "get_record, deterministic business lookups", "Reliable common questions."],
            ["Flexible reads", "search_records, aggregate_records, query_<domain>", "Simple through complex bounded analysis."],
            ["Lookups", "list_lookup_values, lookup resources", "Controlled statuses, types, roles, and categories."],
            ["Writes", "One tool per domain action", "Explicit inserts, updates, conversions, assignments, and deletes."],
            ["Operations", "health, capability explanations", "Connectivity, diagnostics, and agent guidance."],
        ],
        [1700, 3650, 4010],
    )

    document.add_heading("Appendix B. Review questions", level=1)
    for question in (
        "Can a client change its role by modifying tool arguments or headers?",
        "Can an unknown field, relationship, sort, metric alias, or table name reach SQL compilation?",
        "Can a sales user infer organization-wide counts from an aggregate or related subquery?",
        "Can a failed tool call be followed by a plausible but unsupported answer?",
        "Can a write run without a fresh permission check and explicit confirmation?",
        "Can a repeated confirmation execute the same write twice?",
        "Can sensitive values appear in logs, conversation history, errors, or explanations?",
        "Can another approved agent discover and call the same server through standard MCP?",
    ):
        add_bullet(document, question, bullet_id)

    properties = document.core_properties
    properties.title = "Building a Reusable MCP Server"
    properties.subject = "Secure database access, semantic reads, explicit writes, and agent integration"
    properties.author = "ACARSH Engineering"
    properties.keywords = "MCP, FastMCP, semantic query planner, authorization, database, LLM"
    properties.comments = "Reusable implementation guide based on the ACARSH CRM MCP architecture."

    document.save(OUTPUT)
    DIAGRAM.unlink(missing_ok=True)


if __name__ == "__main__":
    build_document()
    print(OUTPUT)
