from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = (ROOT / "app.js").read_text(encoding="utf-8")
BACKEND = (ROOT / "netlify/functions/autocalls-call.js").read_text(encoding="utf-8")


def test_free_call_lock_is_hard_enabled():
    assert "const FREE_CALL_LOCK = true;" in BACKEND
    assert "NOVA FREE CALL LOCK" in APP
    assert "NOVA FREE CALL LOCK" in BACKEND


def test_real_phone_call_request_is_blocked():
    assert "action === 'make_call'" in BACKEND
    assert "statusCode" not in ""
    assert "No /user/make_call request was sent." in BACKEND
    assert "autocallsRequest('/user/make_call'" not in BACKEND
    assert 'autocallsRequest("/user/make_call"' not in BACKEND


def test_free_development_test_exists():
    assert "action === 'free_test'" in BACKEND
    assert '"type": "test"' not in BACKEND  # JS uses unquoted property syntax
    assert "type: 'test'" in BACKEND
    assert "free Autocalls test" in APP or "бесплатный тест Autocalls" in APP


def test_secret_stays_server_side():
    assert "process.env.AUTOCALLS_API_KEY" in BACKEND
    assert "AUTOCALLS_API_KEY" not in APP
    assert "X-NOVA-Call-Key" in BACKEND


def test_saved_outbound_number_selection_is_non_spending():
    assert "nova.autocalls.fromNumber.v1" in APP
    assert "list_numbers" in APP
    assert "resolve_number" in APP
    assert "/user/phone-numbers/all" in BACKEND
    assert "/user/assistant/" not in BACKEND


def test_bridge_does_not_add_sms_or_number_purchase():
    assert "/user/sms" not in BACKEND
    assert "/user/phone-numbers/purchase" not in BACKEND
