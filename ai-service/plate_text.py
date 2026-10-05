"""Cleaning and repairing the text an OCR engine read from a number plate.

OCR engines confuse look-alike characters (0/O, 1/I, 8/B, 5/S ...). Indian plates have a
fixed shape, so a doubtful character can be repaired by asking what its position needs:

    DL 01 AB 1234     state (2 letters) + district (1-2 digits) + series (1-3 letters) + number (4 digits)
    22 BH 1234 AB     Bharat series

A repair is only made when the result is a valid shape AND starts with a real state code,
and it never changes more than 2 characters. Anything else is returned as it was read, and
the server's own checks (and the operator) deal with it.
"""
from __future__ import annotations

import re

STATES = set(
    "AN AP AR AS BR CH CG DD DL DN GA GJ HP HR JH JK KA KL LA LD MH ML MN MP MZ NL OD OR PB PY RJ SK TN TR TS UK UP WB".split()
)
VALID = re.compile(r"^(?:[A-Z]{2}(?P<district>\d{1,2})[A-Z]{1,3}\d{4}|\d{2}BH\d{4}[A-Z]{1,2})$")

# What a character most likely is when its position needs the other kind.
TO_LETTER = {"0": "O", "1": "I", "2": "Z", "5": "S", "6": "G", "8": "B", "4": "A", "7": "T"}
TO_DIGIT = {"O": "0", "Q": "0", "D": "0", "I": "1", "L": "1", "Z": "2", "S": "5", "G": "6", "B": "8", "A": "4", "T": "7"}

MAX_COST = 2.5  # total price of a repair: a changed state/digit costs 1, a changed series letter 2, a dropped end character 2.5


def clean(raw: str) -> str:
    """'dl 01-ab 1234' -> 'DL01AB1234'."""
    return re.sub(r"[^A-Z0-9]", "", str(raw or "").upper())


def is_valid(text: str) -> bool:
    """A complete Indian plate (state code checked for the usual shape)."""
    match = VALID.match(text)
    if not match:
        return False
    if match.group("district") is None:
        return True  # Bharat series
    # District numbers start at 1; "00" and "0" never exist.
    return text[:2] in STATES and int(match.group("district")) > 0


def _templates(length: int):
    """Role strings ('L' letter, 'D' digit) for a plate of this length."""
    out = []
    for district in (1, 2):
        for series in (1, 2, 3):
            if 2 + district + series + 4 == length:
                out.append("L" * 2 + "D" * district + "L" * series + "D" * 4)
    if length in (9, 10):
        out.append("DD" + "LL" + "DDDD" + "L" * (length - 8))  # 22BH1234AB (BH is literal; checked below)
    return out


def _apply(text: str, roles: str):
    """Fits text to the roles. Returns (result, cost) or None when a character cannot be repaired."""
    chars = []
    changes = 0
    series_from = 2 + roles[2:].index("L") if "L" in roles[2:] else len(roles)
    for index, (ch, role) in enumerate(zip(text, roles)):
        if role == "L":
            if ch.isalpha():
                chars.append(ch)
            elif ch in TO_LETTER:
                chars.append(TO_LETTER[ch])
                # A digit turning into a series letter is a bigger guess than one in the state code.
                changes += 2 if index >= series_from else 1
            else:
                return None
        else:
            if ch.isdigit():
                chars.append(ch)
            elif ch in TO_DIGIT:
                chars.append(TO_DIGIT[ch])
                changes += 1
            else:
                return None
    return "".join(chars), changes


def repair(raw: str):
    """Returns (plate, repaired). `plate` is the cleaned text, fixed when a safe fix exists."""
    text = clean(raw)
    # The blue "IND" band at the left edge of many plates is read as letters.
    if text.startswith("IND") and len(text) > 10 and not is_valid(text):
        text = text[3:]
    if is_valid(text):
        return text, False

    best = None  # (cost, plate)
    n = len(text)
    for length in range(max(8, n - 3), min(11, n) + 1):
        for start in range(0, n - length + 1):
            piece = text[start:start + length]
            dropped = n - length
            for roles in _templates(length):
                fitted = _apply(piece, roles)
                if not fitted:
                    continue
                candidate, changes = fitted
                if roles.startswith("DD") and piece[2:4] != "BH":
                    continue  # the literal BH in the third and fourth places
                if not is_valid(candidate):
                    continue
                # Rarely used three-letter series are a guess, so they cost extra.
                cost = changes + 2.5 * dropped + (1 if roles.count("L") == 5 else 0)
                if cost > MAX_COST:
                    continue
                if best is None or cost < best[0]:
                    best = (cost, candidate)
    if best is None:
        return text, False
    return best[1], True
