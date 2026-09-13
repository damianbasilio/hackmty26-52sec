"""CLABE: bank (3) + plaza (3) + account (11) + check digit (1). Banxico's rule.

Ours are built from the account_number Nessie generates, so every Nessie account
has exactly one CLABE and it ends in the same 4 digits the app shows as last_four.
Same algorithm as app/src/clabe.ts.
"""

from __future__ import annotations

BANK_CODE = "052"
# Monterrey
PLAZA_CODE = "580"
_WEIGHTS = (3, 7, 1)

# Enough to label where money goes; anything else reads "Otro banco".
BANKS = {
    BANK_CODE: "Capital One",
    "002": "Banamex",
    "012": "BBVA",
    "014": "Santander",
    "021": "HSBC",
    "030": "BanBajío",
    "036": "Inbursa",
    "044": "Scotiabank",
    "058": "Banregio",
    "072": "Banorte",
    "127": "Banco Azteca",
    "137": "BanCoppel",
    "638": "Nu México",
    "646": "STP",
}


def check_digit(first17: str) -> int:
    total = sum((int(d) * _WEIGHTS[i % 3]) % 10 for i, d in enumerate(first17))
    return (10 - total % 10) % 10


def is_valid(clabe: str) -> bool:
    return len(clabe) == 18 and clabe.isdigit() and check_digit(clabe[:17]) == int(clabe[17])


def from_account_number(account_number: str | None) -> str | None:
    digits = "".join(ch for ch in str(account_number or "") if ch.isdigit())
    if len(digits) < 11:
        return None
    first17 = f"{BANK_CODE}{PLAZA_CODE}{digits[-11:]}"
    return f"{first17}{check_digit(first17)}"


def last_four(clabe: str) -> str:
    return clabe[13:17]


def bank_name(clabe: str) -> str:
    return BANKS.get(clabe[:3], "Otro banco")


if __name__ == "__main__":
    assert check_digit("03218000011835971") == 9
    built = from_account_number("5550001234567891")
    assert built is not None and is_valid(built) and last_four(built) == "7891"
    assert bank_name(built) == "Capital One"
    assert not is_valid(built[:17] + str((int(built[17]) + 1) % 10))
    assert from_account_number("123") is None
    print("ok")
