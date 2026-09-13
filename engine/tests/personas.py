"""Synthetic 120-day ledgers for the forecast and shield engines.

Ana: salaried, biweekly payroll, rent and four subscriptions, delivery creeping up.
Luis: freelancer, irregular client payments, thin balance.
Descriptors go through ledger.classify exactly like rows from Supabase do.
"""

from __future__ import annotations

import random
from calendar import monthrange
from datetime import date, datetime, time, timedelta, timezone

from app import clabe
from app.enrichment import MX_TZ
from app.ledger import LedgerAccount, Movement, classify

NOW = datetime(2026, 9, 13, 18, 0, tzinfo=timezone.utc)
HISTORY_DAYS = 120


def random_clabe(rng: random.Random, bank: str) -> str:
    first17 = f"{bank}{rng.randint(1, 999):03d}{''.join(str(rng.randint(0, 9)) for _ in range(11))}"
    return f"{first17}{clabe.check_digit(first17)}"


def own_clabe(digits: str) -> str:
    return clabe.from_account_number(digits)


def at(day: date, hour: int, minute: int = 0) -> datetime:
    return datetime.combine(day, time(hour, minute), tzinfo=MX_TZ).astimezone(timezone.utc)


def pesos(rng: random.Random, low: int, high: int) -> int:
    return rng.randint(low, high) * 100


def movement(txn_id: str, account_id: str, when: datetime, amount_cents: int, kind: str, raw: str,
             payee_clabe: str | None = None) -> Movement:
    counterparty, category, display = classify(raw)
    return Movement(txn_id, account_id, amount_cents, kind, "completed", raw, when, counterparty, category, display, payee_clabe)


def _is_day(day: date, dom: int) -> bool:
    return day.day == min(dom, monthrange(day.year, day.month)[1])


class _Ledger:
    def __init__(self, account_id: str) -> None:
        self.account_id = account_id
        self.rows: list[Movement] = []

    def add(self, when: datetime, amount_cents: int, kind: str, raw: str, payee_clabe: str | None = None) -> None:
        txn_id = f"txn_{self.account_id.removeprefix('acc_')}_{len(self.rows) + 1:05d}"
        self.rows.append(movement(txn_id, self.account_id, when, amount_cents, kind, raw, payee_clabe))


def _ana(rng: random.Random, days: list[date]) -> _Ledger:
    led = _Ledger("acc_ana_checking")
    landlord, friend = random_clabe(rng, "014"), random_clabe(rng, "012")
    recent = days[-30]
    for d in days:
        if _is_day(d, 15) or _is_day(d, 31):
            led.add(at(d, 14, 2), 1_425_000, "deposit", "DEPOSITO NOMINA TEC DEL NORTE")
        if _is_day(d, 1):
            led.add(at(d, 10, 20), -950_000, "transfer", "SPEI ENVIADO RENTA DEPTO", landlord)
        if _is_day(d, 3):
            led.add(at(d, 12, 40), -11_900, "purchase", "SPOTIFY MX P1A2B3")
        if _is_day(d, 5):
            led.add(at(d, 3, 15), -23_900, "purchase", "NETFLIX.COM MX")
        if _is_day(d, 7):
            led.add(at(d, 7, 5), -44_900, "purchase", "SMART FIT MEXICO SA")
        if _is_day(d, 10):
            led.add(at(d, 11, 30), -63_900, "purchase", "TELMEX PAGO FIJO 81XXXX")
        if _is_day(d, 18):
            led.add(at(d, 10, 12), -pesos(rng, 842, 915), "purchase", "CFE SUMINISTRADOR SERV BASICOS")
        if _is_day(d, 28):
            led.add(at(d, 6, 0), -19_000, "fee", "COMISION MANEJO DE CUENTA")
        if _is_day(d, 22):
            led.add(at(d, 19, 10), -50_000, "transfer", "SPEI ENVIADO MARIANA LOPEZ", friend)
        if d.weekday() == 5:
            led.add(at(d, 13, rng.randint(0, 59)), -pesos(rng, 950, 1400), "purchase", rng.choice(["SORIANA HIPER CUMBRES", "CHEDRAUI SELECTO VALLE"]))
        if rng.random() < 0.40:
            led.add(at(d, rng.randint(8, 20), rng.randint(0, 59)), -pesos(rng, 56, 110), "purchase", "OXXO TEC 4412 MTY")
        if rng.random() < (0.38 if d >= recent else 0.24):
            led.add(at(d, rng.randint(19, 22), rng.randint(0, 59)), -pesos(rng, 249, 340), "purchase", "RAPPI MX CDMX")
        if d.weekday() < 5 and rng.random() < 0.45:
            led.add(at(d, rng.choice([8, 18]), rng.randint(0, 59)), -pesos(rng, 98, 126), "purchase", "DIDI RIDES MX")
        if rng.random() < 0.25:
            led.add(at(d, rng.randint(9, 17), rng.randint(0, 59)), -pesos(rng, 75, 93), "purchase", "STARBUCKS VALLE ORIENTE")
        if rng.random() < 0.07:
            led.add(at(d, rng.randint(12, 21), rng.randint(0, 59)), -pesos(rng, 300, 1500), "purchase", "AMAZON MX MARKETPLACE")
        if rng.random() < 0.04:
            led.add(at(d, rng.randint(10, 19), rng.randint(0, 59)), -pesos(rng, 186, 420), "purchase", "FARMACIAS GUADALAJARA 1120")
    return led


def _luis(rng: random.Random, days: list[date]) -> _Ledger:
    led = _Ledger("acc_luis_checking")
    landlord = random_clabe(rng, "072")
    clients = ["AGENCIA CREATIVA NORTE", "ESTUDIO DISENO SAN PEDRO", "CONSULTORIA MTY"]
    next_pay = days[0] + timedelta(days=2)
    for d in days:
        if d == next_pay:
            led.add(at(d, rng.randint(10, 17), rng.randint(0, 59)), pesos(rng, 7000, 12000), "deposit",
                    f"SPEI RECIBIDO {rng.choice(clients)}")
            next_pay = d + timedelta(days=rng.randint(9, 17))
        if _is_day(d, 3):
            led.add(at(d, 12, 0), -700_000, "transfer", "SPEI ENVIADO RENTA DEPTO", landlord)
        if _is_day(d, 1):
            led.add(at(d, 6, 30), -49_900, "purchase", "SMART FIT MEXICO SA")
        if _is_day(d, 5):
            led.add(at(d, 4, 0), -23_900, "purchase", "NETFLIX.COM MX")
        if _is_day(d, 12):
            led.add(at(d, 9, 0), -12_900, "purchase", "SPOTIFY MX P1A2B3")
            led.add(at(d, 9, 5), -34_900, "purchase", "TELMEX PLAN MX")
        if _is_day(d, 22):
            led.add(at(d, 10, 0), -pesos(rng, 560, 640), "purchase", "CFE SUMINISTRADOR SERV BASICOS")
        if d.weekday() == 6:
            led.add(at(d, 12, rng.randint(0, 59)), -pesos(rng, 700, 1100), "purchase", "SORIANA HIPER CUMBRES")
        if rng.random() < 0.35:
            led.add(at(d, rng.randint(9, 23), rng.randint(0, 59)), -pesos(rng, 40, 120), "purchase", "OXXO GONZALITOS 8871")
        if rng.random() < 0.30:
            led.add(at(d, rng.randint(20, 23), rng.randint(0, 59)), -pesos(rng, 180, 320), "purchase", "RAPPI MX CDMX")
        if rng.random() < 0.20:
            led.add(at(d, rng.randint(10, 22), rng.randint(0, 59)), -pesos(rng, 70, 150), "purchase", "DIDI*VIAJE 8821")
    return led


_PERSONAS = [
    ("ana", "00010000148", 2_313_600, ("Ahorro Meta Viaje", "00010000290", 2_738_400), _ana),
    ("luis", "00020000377", 420_000, ("Apartado emergencias", "00020000461", 250_000), _luis),
]


def generate(now: datetime = NOW, seed: int = 52) -> dict[str, tuple[list[LedgerAccount], list[Movement]]]:
    """name -> (checking + savings accounts, checking history sorted by time)."""
    rng = random.Random(seed)
    today = now.astimezone(MX_TZ).date()
    days = [today - timedelta(days=i) for i in range(HISTORY_DAYS, 0, -1)]
    out = {}
    for name, digits, balance, (savings_name, savings_digits, savings_balance), builder in _PERSONAS:
        ledger = builder(rng, days)
        checking_clabe, savings_clabe = own_clabe(digits), own_clabe(savings_digits)
        accounts = [
            LedgerAccount(ledger.account_id, f"cus_{name}", "Cuenta de cheques", "checking", clabe.last_four(checking_clabe), checking_clabe, balance),
            LedgerAccount(f"acc_{name}_savings", f"cus_{name}", savings_name, "savings", clabe.last_four(savings_clabe), savings_clabe, savings_balance),
        ]
        out[name] = (accounts, sorted(ledger.rows, key=lambda m: m.occurred_at))
    return out
