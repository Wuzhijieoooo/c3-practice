#!/usr/bin/env python3
"""从指定 PDF 的原始字符流提取题目，按紫色单元格读取原答案。

用法：python3 scripts/extract_questions.py /path/to/题库.pdf
依赖：pdfplumber。输出 public/questions.json 和 public/import-report.json。
"""

import argparse
import collections
import hashlib
import json
from pathlib import Path

import pdfplumber


TYPES = {"单选": "single", "多选": "multiple", "判断": "boolean"}
ANSWER_COLOR = (0.886, 0.365, 0.933)
KEYS = "ABCDE"


def extract(path):
    questions, warnings, fixes = [], [], []
    image_pages, highlighted_cells = [], 0
    with pdfplumber.open(path) as pdf:
        page_count = len(pdf.pages)
        for page_number, page in enumerate(pdf.pages, 1):
            if page.images:
                image_pages.append(page_number)
            highlights = [r for r in page.rects if r.get("fill") and
                          r.get("non_stroking_color") == ANSWER_COLOR]
            highlighted_cells += len(highlights)
            rows = []
            for table in page.find_tables():
                for text, geometry in zip(table.extract(), table.rows):
                    if (text[0] or "").strip().isdigit():
                        rows.append((int(text[0]), text, geometry.cells))
            assert rows, f"第 {page_number} 页没有题目"
            table_bottom = max(cell[3] for _, _, cells in rows for cell in cells if cell)
            # 原字符流依次绘制题号、题型、题干、选项。用题号切分，可保留
            # PDF 中伸出单元格的换行文字，避免普通表格提取污染相邻题目。
            number_right = rows[0][2][0][2]
            anchors = []
            for index, char in enumerate(page.chars):
                is_number = char["text"].isdigit() and char["x0"] < number_right
                previous = page.chars[index - 1] if index else None
                previous_number = previous and previous["text"].isdigit() and previous["x0"] < number_right
                if is_number and not previous_number:
                    anchors.append(index)
            assert len(anchors) == len(rows), (page_number, len(anchors), len(rows))
            anchors.append(len(page.chars))
            for position, (expected_id, table_text, cells) in enumerate(rows):
                columns = [[] for _ in cells]
                overflow = False
                for char in page.chars[anchors[position]:anchors[position + 1]]:
                    center_x = (char["x0"] + char["x1"]) / 2
                    for column, cell in enumerate(cells):
                        if cell and cell[0] <= center_x <= cell[2]:
                            # 排除页码等不属于表格的文字。
                            if char["top"] > table_bottom + 15:
                                continue
                            columns[column].append(char["text"])
                            if char["top"] < cell[1] - 1 or char["bottom"] > cell[3] + 1:
                                overflow = True
                            break
                values = [" ".join("".join(chars).split()) for chars in columns]
                assert values[0] == str(expected_id), (expected_id, values[0])
                type_label = values[1].replace("题", "")
                assert type_label in TYPES, (expected_id, values[1])
                question_type = TYPES[type_label]
                options = [{"key": KEYS[i], "text": text}
                           for i, text in enumerate(values[3:]) if text]
                answer = []
                for index, cell in enumerate(cells[3:]):
                    if not cell:
                        continue
                    center_x, center_y = (cell[0] + cell[2]) / 2, (cell[1] + cell[3]) / 2
                    if any(r["x0"] - .3 <= center_x <= r["x1"] + .3 and
                           r["top"] - .3 <= center_y <= r["bottom"] + .3 for r in highlights):
                        answer.append(KEYS[index])
                assert values[2] and options and answer, (expected_id, values)
                assert set(answer) <= {o["key"] for o in options}, expected_id
                assert len(options) == {"single": 4, "multiple": 5, "boolean": 2}[question_type], expected_id
                if question_type != "multiple":
                    assert len(answer) == 1, expected_id
                if question_type == "boolean":
                    assert [o["text"] for o in options] == ["正确", "错误"], (expected_id, options)
                if question_type == "multiple" and len(answer) == 1:
                    warnings.append({"id": expected_id, "page": page_number,
                                     "kind": "multiple_with_one_highlight",
                                     "message": "原 PDF 标为多选，但只高亮一个选项；按原答案保留。",
                                     "answer": answer})
                if overflow:
                    fixes.append({"id": expected_id, "page": page_number,
                                  "kind": "text_outside_cell",
                                  "message": "按 PDF 原始字符顺序归属本题，避免邻行文字混入。"})
                questions.append({"id": expected_id, "type": question_type, "text": values[2],
                                  "options": options, "answer": answer, "pages": [page_number]})
                if question_type == "multiple" and len(answer) == 1:
                    questions[-1]["note"] = "原题标为多选，但 PDF 仅高亮一个答案；此处按题库原标记判分。"
            page.close()
    assert [q["id"] for q in questions] == list(range(1, 2001)), "题号必须连续、唯一且共有 2000 题"
    counts = dict(collections.Counter(q["type"] for q in questions))
    assert counts == {"single": 800, "multiple": 400, "boolean": 800}, counts
    assert sum(len(q["answer"]) for q in questions) == highlighted_cells == 3058
    source = {"title": path.name, "pages": page_count, "total": len(questions), "counts": counts}
    report = {"source": source, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
              "answerMethod": "原 PDF 紫色选项单元格，颜色 RGB (0.886, 0.365, 0.933)",
              "highlightedCells": highlighted_cells, "allQuestionsHaveValidAnswers": True,
              "continuousUniqueIds": True, "imagePages": image_pages,
              "crossPageQuestions": [], "warnings": warnings, "layoutRecoveries": fixes,
              "notes": ["保留题干、选项及原 PDF 答案，不生成解析或修正原题。",
                        "题库含上海地方条文，数据版本以原 PDF 为准。"]}
    return {"source": source, "questions": questions}, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "public")
    args = parser.parse_args()
    bank, report = extract(args.pdf)
    args.output.mkdir(parents=True, exist_ok=True)
    for name, data in [("questions.json", bank), ("import-report.json", report)]:
        (args.output / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"questions": bank["source"], "warnings": len(report["warnings"]),
                      "layoutRecoveries": len(report["layoutRecoveries"])}, ensure_ascii=False))


if __name__ == "__main__":
    main()
