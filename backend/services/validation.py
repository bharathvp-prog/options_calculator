def spread_validity_error(leg_results: list[dict]) -> str | None:
    """
    Returns an error reason string if the leg combination is a degenerate spread:
    buy and sell legs of the same option_type have the same strike (happens when the
    requested strike_hint exceeds the available option chain and both legs resolve to
    the same highest-available strike).
    Returns None if the spread is valid.
    """
    buy_strikes = {lr["option_type"]: lr["strike"] for lr in leg_results if lr.get("side") == "buy"}
    sell_strikes = {lr["option_type"]: lr["strike"] for lr in leg_results if lr.get("side") == "sell"}
    for opt_type in set(buy_strikes) & set(sell_strikes):
        if buy_strikes[opt_type] == sell_strikes[opt_type]:
            return "Requested strikes not available — both legs resolved to the same contract"

    return None
