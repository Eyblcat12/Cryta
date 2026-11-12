"""Update the current schema page from a catalog snapshot without changing the original ERD."""
import html
import json
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET


snapshot = Path(sys.argv[1])
schema = json.loads(snapshot.read_text(encoding="utf-8-sig"))
assert schema["migration"] == "027_email_worker_status"
tables = {table["name"]: table for table in schema["tables"]}
assert all(re.fullmatch(r"[a-z_]+", name) for name in tables)
names = [
    "departments", "roles", "users", "user_roles", "approver_scopes",
    "auth_sessions", "account_actions", "account_action_limits", "auth_mfa", "auth_mfa_challenges",
    "auth_oidc_links", "auth_oidc_flows", "auth_oidc_sessions", "auth_oidc_revocations", "report_exports",
    "policies", "policy_versions", "crypto_assets", "cryptographic_keys", "certificates",
    "requests", "request_decisions", "provider_operations", "audit_logs", "notifications",
    "schema_migrations", "expiry_scan_status", "email_worker_status",
]
assert set(names) == set(tables)
table_count = len(tables)
column_count = sum(len(table["columns"]) for table in tables.values())
relation_count = len(schema["relations"])

diagram_path = Path("erd_QuanLyKhoa_HTTT.drawio")
tree = ET.parse(diagram_path)
document = tree.getroot()
for page in list(document):
    if page.get("id") in {"crypta-schema-017", "crypta-schema-027"}:
        document.remove(page)
current = ET.Element("diagram", {"id": "crypta-schema-027", "name": "Schema hiện hành 027"})
document.insert(0, current)
model = ET.SubElement(current, "mxGraphModel", {
    "grid": "1", "gridSize": "10", "page": "1", "pageWidth": "2700", "pageHeight": "2900",
    "guides": "1", "connect": "1", "arrows": "1", "fold": "1", "pageScale": "1",
})
cells = ET.SubElement(model, "root")
ET.SubElement(cells, "mxCell", {"id": "0"})
ET.SubElement(cells, "mxCell", {"id": "1", "parent": "0"})
title = ET.SubElement(cells, "mxCell", {"id": "title-027", "parent": "1", "vertex": "1",
    "value": f"Crypta · schema 027 · {table_count} bảng · {relation_count} khóa ngoại · nguồn PostgreSQL 17",
    "style": "text;html=0;align=left;fontSize=22;fontStyle=1;strokeColor=none;fillColor=none;"})
ET.SubElement(title, "mxGeometry", {"x": "30", "y": "15", "width": "2400", "height": "35", "as": "geometry"})

row_y = 70
preview_tables = []
for row_start in range(0, len(names), 5):
    row_tables = names[row_start:row_start + 5]
    heights = [70 + 22 * len(tables[name]["columns"]) for name in row_tables]
    for col, (name, height) in enumerate(zip(row_tables, heights)):
        body = []
        for column in tables[name]["columns"]:
            flags = ",".join(flag for flag, applies in (("PK", column["primary"]), ("FK", column["foreign"])) if applies)
            optional = "" if column["notNull"] else " nullable"
            body.append(f"{column['name']} · {column['type']} {flags}{optional}".rstrip())
        value = "<b>" + name + "</b><br><br>" + "<br>".join(html.escape(line) for line in body)
        cell = ET.SubElement(cells, "mxCell", {"id": "table-" + name, "parent": "1", "vertex": "1", "value": value,
            "style": "rounded=0;whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacing=10;fontSize=12;fillColor=#f7faff;strokeColor=#6b84a5;"})
        ET.SubElement(cell, "mxGeometry", {"x": str(30 + col * 530), "y": str(row_y), "width": "500", "height": str(height), "as": "geometry"})
        preview_tables.append((name, body))
    row_y += max(heights) + 80

for index, relation in enumerate(schema["relations"]):
    assert relation["source"] in tables and relation["target"] in tables
    foreign = re.search(r"FOREIGN KEY \(([^)]+)\)", relation["definition"])[1]
    edge = ET.SubElement(cells, "mxCell", {"id": f"fk-027-{index}", "parent": "1", "edge": "1",
        "source": "table-" + relation["source"], "target": "table-" + relation["target"], "value": foreign,
        "style": "edgeStyle=orthogonalEdgeStyle;rounded=0;html=0;fontSize=10;endArrow=open;strokeColor=#8795a6;"})
    ET.SubElement(edge, "mxGeometry", {"relative": "1", "as": "geometry"})
model.set("pageHeight", str(row_y + 40))
ET.indent(tree, space="  ")
tree.write(diagram_path, encoding="utf-8", xml_declaration=False)

lines = ["# ERD hiện hành của Crypta", "",
    f"Schema sau migration `{schema['migration']}`, đối chiếu từ PostgreSQL 17 trên stack cách ly. Có {table_count} bảng, {column_count} cột và {relation_count} khóa ngoại. Trang đầu của tệp draw.io chứa schema hiện hành. Trang thiết kế ban đầu được giữ để tra lịch sử. [ERD chỉnh sửa được](../erd_QuanLyKhoa_HTTT.drawio) · [Kiến trúc](../02_so_do_he_thong_tong_quat.md)", "",
    "`PK` là cột khóa chính, `FK` là cột khóa ngoại. `nullable` cho biết cột cho phép NULL. Các điều kiện trạng thái và tính bất biến nằm trong constraint, trigger và service. Yêu cầu nháp có thể thiếu policy và tài sản đích.", "",
    "```mermaid", "erDiagram"]
for name in names:
    lines.append(f"    {name.upper()} {{")
    for column in tables[name]["columns"]:
        data_type = re.sub(r"[^a-zA-Z0-9_]", "_", column["type"])
        flags = ",".join(flag for flag, applies in (("PK", column["primary"]), ("FK", column["foreign"])) if applies)
        lines.append(f"        {data_type} {column['name']} {flags}".rstrip())
    lines.append("    }")
for relation in schema["relations"]:
    foreign = re.search(r"FOREIGN KEY \(([^)]+)\)", relation["definition"])[1].split(", ")
    source = tables[relation["source"]]
    required = all(column["notNull"] for column in source["columns"] if column["name"] in foreign)
    unique = any(re.match(r"(?:PRIMARY KEY|UNIQUE) \(" + re.escape(", ".join(foreign)) + r"\)", c["definition"])
                 for c in source["constraints"] or [])
    parent_end = "||" if required else "o|"
    child_end = "o|" if unique else "o{"
    lines.append(f"    {relation['target'].upper()} {parent_end}--{child_end} {relation['source'].upper()} : {'_'.join(foreign)}")
lines += ["```", "", "Các kiểu dữ liệu SQL đầy đủ và constraint được liệt kê theo bảng bên dưới.", ""]
for name in names:
    table = tables[name]
    lines += [f"## {name}", "", "| Cột | Kiểu PostgreSQL | Ràng buộc cột |", "| --- | --- | --- |"]
    for column in table["columns"]:
        flags = [flag for flag, applies in (("PK", column["primary"]), ("FK", column["foreign"]), ("NOT NULL", column["notNull"])) if applies]
        lines.append(f"| `{column['name']}` | `{column['type']}` | {', '.join(flags) or 'NULL được phép'} |")
    lines += ["", "```sql"] + [c["definition"] for c in table["constraints"] or []] + ["```", ""]
Path("docs/ERD_HIEN_HANH.md").write_text("\n".join(lines), encoding="utf-8")

preview = f"<!doctype html><meta charset=utf-8><title>Crypta schema 027</title><style>body{{font:14px system-ui;background:#eef3f8;padding:20px;color:#17314d}}main{{display:grid;grid-template-columns:repeat(5,500px);gap:30px;align-items:start}}section{{background:#f7faff;border:1px solid #6b84a5;padding:12px;box-sizing:border-box}}h2{{font-size:18px;margin:0 0 14px}}p{{margin:3px 0;line-height:19px;overflow-wrap:anywhere}}h1{{font-size:24px}}</style><h1>Crypta · schema 027 · {table_count} bảng · {relation_count} khóa ngoại</h1><main>"
for name, body in preview_tables:
    preview += "<section><h2>" + name + "</h2>" + "".join("<p>" + html.escape(line) + "</p>" for line in body) + "</section>"
preview += "</main>"
(snapshot.parent / "erd-preview.html").write_text(preview, encoding="utf-8")
print(f"Updated {table_count} tables, {column_count} columns and {relation_count} foreign keys")
