"""Format Markdown tables for Telegram's text-message fallback."""

import re


def _cells(line: str) -> list[str]:
    return [cell.strip().replace(r"\|", "|") for cell in re.split(r"(?<!\\)\|", line.strip().strip("|"))]


def _is_separator(line: str, column_count: int) -> bool:
    cells = _cells(line)
    return len(cells) == column_count and all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells)


def has_markdown_table(message: str) -> bool:
    """Return whether a message contains a GitHub-style table."""
    lines = message.splitlines()
    return any(
        "|" in lines[index]
        and len(_cells(lines[index])) >= 2
        and _is_separator(lines[index + 1], len(_cells(lines[index])))
        for index in range(len(lines) - 1)
    )


def telegram_text_fallback(message: str) -> str:
    """Turn tables into labeled rows that remain legible on narrow screens."""
    lines = message.splitlines()
    output: list[str] = []
    index = 0
    while index < len(lines):
        headers = _cells(lines[index])
        if (index + 1 >= len(lines) or "|" not in lines[index]
                or len(headers) < 2 or not _is_separator(lines[index + 1], len(headers))):
            output.append(lines[index])
            index += 1
            continue

        index += 2
        row_number = 0
        while index < len(lines) and "|" in lines[index]:
            values = _cells(lines[index])
            if len(values) != len(headers):
                break
            row_number += 1
            output.append(f"{row_number}. " + " · ".join(
                f"{header}: {value}" for header, value in zip(headers, values, strict=True)
            ))
            index += 1
        if row_number == 0:
            output.append(" · ".join(headers))
    return "\n".join(output)
