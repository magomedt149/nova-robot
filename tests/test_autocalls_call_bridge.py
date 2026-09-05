from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = (ROOT / "app.js").read_text(encoding="utf-8")
BACKEND = (ROOT / "netlify/functions/autocalls-call.js").read_text(encoding="utf-8")


def test_real_call_route_exists():
    assert "/user/make_call" in BACKEND
    assert "assistant_id" in BACKEND
    assert "phone_number" in BACKEND


def test_confirmation_is_mandatory():
    assert "body.confirmed !== true" in BACKEND
    assert "confirmed_at" in BACKEND
    assert "подтверждаю звонок" in APP


def test_secret_stays_server_side():
    assert "process.env.AUTOCALLS_API_KEY" in BACKEND
    assert "AUTOCALLS_API_KEY" not in APP
    assert "X-NOVA-Call-Key" in BACKEND


def test_call_bridge_does_not_add_sms_or_number_purchase():
    assert "/user/sms" not in BACKEND
    assert "/user/phone-numbers/purchase" not in BACKEND
