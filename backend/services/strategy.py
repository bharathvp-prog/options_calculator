import re
import calendar
from datetime import datetime

MONTHS = {
    "january": 1, "jan": 1, "february": 2, "feb": 2,
    "march": 3, "mar": 3, "april": 4, "apr": 4,
    "may": 5, "june": 6, "jun": 6, "july": 7, "jul": 7,
    "august": 8, "aug": 8, "september": 9, "sep": 9, "sept": 9,
    "october": 10, "oct": 10, "november": 11, "nov": 11,
    "december": 12, "dec": 12,
}

SKIP_WORDS = {
    # Articles / pronouns / prepositions
    "I", "A", "AN", "THE", "AND", "OR", "BUT", "BY", "IN", "ON", "AT",
    "TO", "OF", "FOR", "NOT", "NO", "IS", "BE", "AM", "IT", "AS", "UP",
    "MY", "WE", "DO", "GO", "SO", "IF", "HE", "SHE", "ME", "US",
    # Common verbs that look like tickers
    "WILL", "STAY", "MOVE", "GROW", "FALL", "RISE", "FLAT", "FROM",
    "INTO", "OVER", "THAN", "THIS", "THAT", "WITH", "HAVE", "BEEN",
    "THEY", "WHEN", "WHAT", "SOME", "JUST", "ALSO", "VERY", "MUCH",
    "BOTH", "EACH", "MAKE", "TAKE", "KNOW", "LOOK", "COME", "WANT",
    "GIVE", "BACK", "EVEN", "LONG", "CALL", "PUTS", "STOP", "HOLD",
    "SELL", "HOPE", "FEEL", "SAID", "SAYS", "DOES", "DONT", "CANT",
    "WONT", "STAY", "PLAY", "RISK", "PLAN", "HUGE", "BULL", "BEAR",
    # Finance acronyms unlikely to be tickers in context
    "EPS", "ETF", "IPO", "CEO", "CFO", "YOY", "QOQ", "EV", "ATM",
    "OTM", "ITM", "PUT", "ROI", "NET", "MAX", "MIN",
}

BULLISH_WORDS = [
    "grow", "rise", "rally", "increase", "higher", "bullish", "appreciate",
    "reach", "climb", "upside", "gain", "long", "confident", "going up",
    "move up", "head to", "heading to", "go to", "will hit", "will reach",
    "will grow", "will rise", "will appreciate", "positive", "strong", "up to",
]
BEARISH_WORDS = [
    "fall", "drop", "crash", "decline", "decrease", "lower", "bearish",
    "depreciate", "sink", "lose", "downside", "short", "going down",
    "move down", "head down", "plummet", "collapse", "tumble",
    "will fall", "will drop", "will crash", "will decline", "below",
    "negative", "weak",
]
VOLATILE_WORDS = [
    "volatile", "swing", "either way", "big move", "sharp move",
    "explode", "breakout", "catalyst", "event", "earnings", "announcement",
    "uncertain", "don't know which way", "either direction",
]
NEUTRAL_WORDS = [
    "flat", "stable", "sideways", "consolidate", "stay around",
    "remain around", "won't move much", "range-bound", "staying flat",
]
CAP_WORDS = [
    "no more than", "capped at", "ceiling", "not above", "won't exceed",
    "at most", "but not higher", "but no higher", "limited upside",
    "up to", "as high as", "max",
]


def extract_ticker(text: str) -> str | None:
    # $TICKER format
    m = re.search(r'\$([A-Z]{1,5})\b', text)
    if m:
        return m.group(1)

    # Uppercase words that aren't common English
    for word in text.split():
        clean = re.sub(r'[^A-Za-z]', '', word)
        if clean.isupper() and 1 <= len(clean) <= 5 and clean not in SKIP_WORDS:
            return clean

    # After "on", "for", "about", "in" (case-insensitive, handles lowercase tickers)
    m = re.search(
        r'\b(?:on|for|about|in|stock|shares?)\s+([A-Za-z]{1,5})\b',
        text, re.IGNORECASE
    )
    if m:
        candidate = m.group(1).upper()
        if candidate not in SKIP_WORDS:
            return candidate

    return None


def extract_prices(text: str) -> list[float]:
    # $NNN first
    dollar_prices = [
        float(m.group(1))
        for m in re.finditer(r'\$(\d{1,6}(?:\.\d{1,2})?)\b', text)
    ]
    if dollar_prices:
        return sorted(set(dollar_prices))

    # Standalone numbers, skipping years
    prices = []
    for m in re.finditer(r'\b(\d{2,6}(?:\.\d{1,2})?)\b', text):
        val = float(m.group(1))
        if 1900 <= val <= 2100:
            continue
        prices.append(val)
    return sorted(set(prices))


def extract_date(text: str) -> str | None:
    t = text.lower()
    month_pat = '|'.join(MONTHS.keys())

    # "by/in/before/end of [month] [year]"
    m = re.search(
        rf'\b(?:by|in|before|through|until|end\s+of|for)?\s*({month_pat})\s+(\d{{4}})\b',
        t
    )
    if m:
        month = MONTHS[m.group(1)]
        year = int(m.group(2))
        last_day = calendar.monthrange(year, month)[1]
        return f"{year}-{month:02d}-{last_day:02d}"

    # Just year: "by 2028" or "in 2028"
    m = re.search(r'\b(?:by|in|before)?\s*(20\d{2})\b', text)
    if m:
        return f"{m.group(1)}-12-31"

    return None


def detect_sentiment(text: str) -> str:
    t = text.lower()
    scores = {
        "bullish": sum(1 for w in BULLISH_WORDS if w in t),
        "bearish": sum(1 for w in BEARISH_WORDS if w in t),
        "volatile": sum(1 for w in VOLATILE_WORDS if w in t),
        "neutral": sum(1 for w in NEUTRAL_WORDS if w in t),
    }
    best = max(scores, key=scores.get)
    return best if scores[best] > 0 else "bullish"


def has_cap(text: str) -> bool:
    t = text.lower()
    return any(p in t for p in CAP_WORDS)


def identify_strategy(view: str) -> dict:
    ticker = extract_ticker(view)
    prices = extract_prices(view)
    expiry_to = extract_date(view)
    sentiment = detect_sentiment(view)
    capped = has_cap(view)
    today = datetime.today().strftime("%Y-%m-%d")

    if not ticker:
        return {"error": "Could not identify a ticker symbol. Try including it like 'AMD' or '$AAPL'."}
    if not expiry_to:
        return {"error": "Could not identify a time horizon. Try something like 'by June 2026' or 'in 2026'."}

    def leg(option_type, side, strike_hint):
        return {
            "option_type": option_type,
            "side": side,
            "strike_hint": strike_hint,
            "expiry_from": today,
            "expiry_to": expiry_to,
        }

    if sentiment == "bullish":
        if len(prices) >= 2:
            lower, upper = sorted(prices)[:2]
            return {
                "strategy_name": "Bull Call Spread",
                "description": (
                    f"You're bullish on {ticker}, expecting it to rise to ~${lower:,.0f} "
                    f"but no higher than ~${upper:,.0f}. A bull call spread buys a call at "
                    f"the lower strike and sells one at the upper strike — you profit in that "
                    f"range at a lower upfront cost than a naked call."
                ),
                "ticker": ticker,
                "same_expiry": True,
                "legs": [leg("call", "buy", lower), leg("call", "sell", upper)],
            }
        elif len(prices) == 1 and capped:
            target = prices[0]
            upper = round(target * 1.15)
            return {
                "strategy_name": "Bull Call Spread",
                "description": (
                    f"You're bullish on {ticker} but see limited upside around ${target:,.0f}. "
                    f"A bull call spread buys a call near ${target:,.0f} and sells one further "
                    f"out (~${upper:,.0f}) to offset premium."
                ),
                "ticker": ticker,
                "same_expiry": True,
                "legs": [leg("call", "buy", target), leg("call", "sell", upper)],
            }
        elif len(prices) == 1:
            return {
                "strategy_name": "Long Call",
                "description": (
                    f"You're bullish on {ticker}, expecting it to reach ~${prices[0]:,.0f}. "
                    f"A long call gives leveraged upside exposure with defined risk — "
                    f"your max loss is the premium paid."
                ),
                "ticker": ticker,
                "same_expiry": False,
                "legs": [leg("call", "buy", prices[0])],
            }
        else:
            return {
                "strategy_name": "Long Call",
                "description": (
                    f"You're bullish on {ticker}. "
                    f"A long call gives leveraged upside with defined downside risk."
                ),
                "ticker": ticker,
                "same_expiry": False,
                "legs": [leg("call", "buy", None)],
            }

    elif sentiment == "bearish":
        if len(prices) >= 2:
            lower, upper = sorted(prices)[:2]
            return {
                "strategy_name": "Bear Put Spread",
                "description": (
                    f"You're bearish on {ticker}, expecting it to fall toward ~${lower:,.0f}. "
                    f"A bear put spread buys a put at the higher strike (~${upper:,.0f}) and "
                    f"sells one at the lower strike (~${lower:,.0f}), profiting on the decline "
                    f"at a reduced cost."
                ),
                "ticker": ticker,
                "same_expiry": True,
                "legs": [leg("put", "buy", upper), leg("put", "sell", lower)],
            }
        elif len(prices) == 1:
            target = prices[0]
            return {
                "strategy_name": "Long Put",
                "description": (
                    f"You're bearish on {ticker}, expecting it to fall to ~${target:,.0f}. "
                    f"A long put profits as the stock declines below the strike."
                ),
                "ticker": ticker,
                "same_expiry": False,
                "legs": [leg("put", "buy", target)],
            }
        else:
            return {
                "strategy_name": "Long Put",
                "description": (
                    f"You're bearish on {ticker}. "
                    f"A long put profits as the stock declines below the strike."
                ),
                "ticker": ticker,
                "same_expiry": False,
                "legs": [leg("put", "buy", None)],
            }

    elif sentiment == "volatile":
        if len(prices) >= 2:
            lower, upper = sorted(prices)[:2]
            return {
                "strategy_name": "Long Strangle",
                "description": (
                    f"You expect a big move in {ticker} but aren't sure of the direction. "
                    f"A long strangle buys an OTM call (~${upper:,.0f}) and an OTM put "
                    f"(~${lower:,.0f}), profiting from a large move in either direction."
                ),
                "ticker": ticker,
                "same_expiry": True,
                "legs": [leg("call", "buy", upper), leg("put", "buy", lower)],
            }
        else:
            return {
                "strategy_name": "Long Straddle",
                "description": (
                    f"You expect a big move in {ticker} but aren't sure of the direction. "
                    f"A long straddle buys both a call and a put at the same ATM strike, "
                    f"profiting from large moves in either direction."
                ),
                "ticker": ticker,
                "same_expiry": True,
                "legs": [leg("call", "buy", None), leg("put", "buy", None)],
            }

    else:  # neutral
        if len(prices) >= 2:
            lower, upper = sorted(prices)[:2]
            return {
                "strategy_name": "Iron Condor",
                "description": (
                    f"You expect {ticker} to stay between ~${lower:,.0f} and ~${upper:,.0f}. "
                    f"An iron condor collects premium by selling an OTM call spread above "
                    f"and an OTM put spread below the expected range."
                ),
                "ticker": ticker,
                "same_expiry": True,
                "legs": [
                    leg("put", "buy", round(lower * 0.95)),
                    leg("put", "sell", lower),
                    leg("call", "sell", upper),
                    leg("call", "buy", round(upper * 1.05)),
                ],
            }
        elif len(prices) == 1:
            target = prices[0]
            return {
                "strategy_name": "Iron Condor",
                "description": (
                    f"You expect {ticker} to stay flat around ${target:,.0f}. "
                    f"An iron condor collects premium by selling an OTM call and put spread "
                    f"tightly around your target price."
                ),
                "ticker": ticker,
                "same_expiry": True,
                "legs": [
                    leg("put", "buy", round(target * 0.90)),
                    leg("put", "sell", round(target * 0.95)),
                    leg("call", "sell", round(target * 1.05)),
                    leg("call", "buy", round(target * 1.10)),
                ],
            }
        else:
            return {
                "strategy_name": "Iron Condor",
                "description": (
                    f"You expect {ticker} to stay range-bound. "
                    f"An iron condor collects premium by selling OTM call and put spreads "
                    f"around the current price."
                ),
                "ticker": ticker,
                "same_expiry": True,
                "legs": [
                    leg("put", "buy", None),
                    leg("put", "sell", None),
                    leg("call", "sell", None),
                    leg("call", "buy", None),
                ],
            }
