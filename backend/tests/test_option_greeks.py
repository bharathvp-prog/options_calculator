from services.option_greeks import compute_option_metrics


def test_accepts_valid_yahoo_iv_when_price_is_consistent():
    row = {
        "strike": 100.0,
        "lastPrice": 10.45,
        "bid": 10.2,
        "ask": 10.7,
        "impliedVolatility": 0.25,
    }
    metrics = compute_option_metrics(
        current_price=110.0,
        strike=100.0,
        T=30 / 365,
        r=0.045,
        option_type="call",
        row=row,
        sibling_rows=[row],
    )
    assert metrics["iv_source"] == "yahoo"
    assert metrics["price_source"] in {"mid", "last"}
    assert metrics["delta_status"] == "ok"
    assert metrics["delta"] is not None and 0.0 < metrics["delta"] < 1.0


def test_rejects_bad_yahoo_iv_when_price_disagrees():
    row = {
        "strike": 275.0,
        "lastPrice": 4.0,
        "bid": 0.0,
        "ask": 0.0,
        "impliedVolatility": 0.12500875,
    }
    metrics = compute_option_metrics(
        current_price=347.8,
        strike=275.0,
        T=25 / 365,
        r=0.045,
        option_type="put",
        row=row,
        sibling_rows=[row],
    )
    assert metrics["iv_source"] == "implied_from_last"
    assert metrics["iv"] is not None and metrics["iv"] > 0.4
    assert metrics["delta"] is not None and metrics["delta"] < -0.05


def test_falls_back_from_placeholder_iv_using_last_price():
    row = {
        "strike": 350.0,
        "lastPrice": 27.7,
        "bid": 0.0,
        "ask": 0.0,
        "impliedVolatility": 0.00001,
    }
    metrics = compute_option_metrics(
        current_price=347.8,
        strike=350.0,
        T=25 / 365,
        r=0.045,
        option_type="put",
        row=row,
        sibling_rows=[row],
    )
    assert metrics["iv_source"] == "implied_from_last"
    assert metrics["iv"] is not None and metrics["iv"] > 0.4
    assert metrics["delta"] is not None and -1.0 < metrics["delta"] < 0.0


def test_interpolates_when_row_has_no_usable_iv_or_price():
    lower = {
        "strike": 345.0,
        "lastPrice": 25.35,
        "bid": 0.0,
        "ask": 0.0,
        "impliedVolatility": 0.0078,
    }
    target = {
        "strike": 350.0,
        "lastPrice": 0.0,
        "bid": 0.0,
        "ask": 0.0,
        "impliedVolatility": 0.00001,
    }
    upper = {
        "strike": 355.0,
        "lastPrice": 30.98,
        "bid": 0.0,
        "ask": 0.0,
        "impliedVolatility": 0.00001,
    }
    metrics = compute_option_metrics(
        current_price=347.8,
        strike=350.0,
        T=25 / 365,
        r=0.045,
        option_type="put",
        row=target,
        sibling_rows=[lower, target, upper],
    )
    assert metrics["iv_source"] == "interpolated"
    assert metrics["iv"] is not None
    assert metrics["delta"] is not None


def test_uses_nearest_strike_when_only_one_neighbor_has_usable_iv():
    target = {
        "strike": 100.0,
        "lastPrice": 0.0,
        "bid": 0.0,
        "ask": 0.0,
        "impliedVolatility": 0.00001,
    }
    neighbor = {
        "strike": 105.0,
        "lastPrice": 7.35,
        "bid": 7.2,
        "ask": 7.5,
        "impliedVolatility": 0.24,
    }
    metrics = compute_option_metrics(
        current_price=100.0,
        strike=100.0,
        T=45 / 365,
        r=0.045,
        option_type="call",
        row=target,
        sibling_rows=[target, neighbor],
    )
    assert metrics["iv_source"] == "nearest_strike"
    assert metrics["delta_status"] == "fallback"
    assert metrics["iv"] is not None


def test_returns_missing_inputs_when_core_inputs_are_invalid():
    row = {
        "strike": 100.0,
        "lastPrice": 5.0,
        "bid": 4.8,
        "ask": 5.2,
        "impliedVolatility": 0.2,
    }
    metrics = compute_option_metrics(
        current_price=None,
        strike=100.0,
        T=30 / 365,
        r=0.045,
        option_type="call",
        row=row,
        sibling_rows=[row],
    )
    assert metrics["iv"] is None
    assert metrics["delta_status"] == "missing_inputs"
    assert metrics["delta"] is None


def test_returns_missing_iv_when_no_source_or_neighbor_can_resolve_it():
    row = {
        "strike": 100.0,
        "lastPrice": 0.0,
        "bid": 0.0,
        "ask": 0.0,
        "impliedVolatility": 0.00001,
    }
    metrics = compute_option_metrics(
        current_price=100.0,
        strike=100.0,
        T=30 / 365,
        r=0.045,
        option_type="call",
        row=row,
        sibling_rows=[row],
    )
    assert metrics["iv"] is None
    assert metrics["iv_source"] is None
    assert metrics["delta_status"] == "missing_iv"
