"""Run a temporary end-to-end Chime API check and remove its test records."""

import json
import os
import subprocess
import sys
import uuid


BASE_URL = os.environ.get(
    "DANA_TEST_API_URL",
    "https://ts7l5pjnxnrs5ocu2ttjgrdb5y0zporq.lambda-url.us-east-1.on.aws",
).rstrip("/")


def request(path, method="GET", body=None):
    command = ["curl", "--fail-with-body", "-sS", "--max-time", "30", "-X", method, "-H", "Content-Type: application/json"]
    if os.environ.get("DANA_API_KEY"):
        command += ["-H", f"x-api-key: {os.environ['DANA_API_KEY']}"]
    if os.environ.get("OPERATOR_API_KEY"):
        command += ["-H", f"x-operator-key: {os.environ['OPERATOR_API_KEY']}"]
    if body is not None:
        command += ["--data-binary", "@-"]
    result = subprocess.run(command + [BASE_URL + path], input=None if body is None else json.dumps(body).encode("utf-8"), capture_output=True)
    if result.returncode:
        raise RuntimeError(f"{method} {path}: {result.stdout.decode('utf-8', 'replace')[:500]}")
    return json.loads(result.stdout)


def check(condition, label):
    if not condition:
        raise AssertionError(label)
    print(f"OK: {label}")


def main():
    session_code = None
    operator_id = None
    meeting_id = None
    try:
        health = request("/health")
        check(health.get("version") == "1.6" and health.get("chimeMediaRegion") == "us-east-1", "Lambda v1.6 responde con región Chime")

        marker = uuid.uuid4().hex[:10]
        created = request("/sessions", "POST", {
            "firstName": "Prueba Chime",
            "balance": 1,
            "currency": "USD",
            "externalId": f"integration-{marker}",
        })
        session_code = created["code"]
        check(created["session"]["call"]["status"] == "IDLE", "sesión inicia sin llamada")

        waiting = request(f"/sessions/{session_code}/actions", "POST", {"action": "TALK_TO_AGENT"})
        check(waiting["session"]["mode"] == "WAITING_AGENT", "cliente entra a cola")

        operator = request("/operators", "POST", {
            "name": "Prueba Chime",
            "email": f"chime-{marker}@example.invalid",
        })
        operator_id = operator["operator"]["operatorId"]
        taken = request(f"/sessions/{session_code}/take", "POST", {"operatorId": operator_id})
        check(taken["session"]["mode"] == "AGENT", "operador toma conversación")

        started = request(f"/sessions/{session_code}/call/start", "POST", {"sender": "operator", "operatorId": operator_id})
        meeting_id = started.get("joinInfo", {}).get("meeting", {}).get("MeetingId")
        check(bool(meeting_id) and started["call"]["status"] == "RINGING", "Chime crea reunión y llama")
        check(bool(started["joinInfo"]["attendee"].get("JoinToken")), "operador recibe token de conexión")

        accepted = request(f"/sessions/{session_code}/call/accept", "POST", {"sender": "user"})
        check(accepted["call"]["status"] == "IN_CALL", "cliente atiende")
        check(bool(accepted["joinInfo"]["attendee"].get("JoinToken")), "cliente recibe token de conexión")

        joined = request(f"/sessions/{session_code}/call/join", "POST", {"sender": "operator", "operatorId": operator_id})
        check(joined["call"]["status"] == "IN_CALL", "operador puede reconectarse")

        ended = request(f"/sessions/{session_code}/call/end", "POST", {"sender": "user"})
        check(ended["call"]["status"] == "ENDED", "cliente finaliza llamada")
        persisted = request(f"/sessions/{session_code}")
        check(persisted["session"]["call"]["status"] == "ENDED", "estado final persiste")
    finally:
        if meeting_id:
            subprocess.run(["aws", "chime-sdk-meetings", "delete-meeting", "--meeting-id", meeting_id, "--region", "us-east-1"], check=False, capture_output=True)
        if session_code:
            subprocess.run(["aws", "dynamodb", "delete-item", "--table-name", "DANA-WebChat-Sessions", "--key", json.dumps({"CODE": {"S": session_code}}), "--region", "us-east-1"], check=True, capture_output=True)
        if operator_id:
            subprocess.run(["aws", "dynamodb", "delete-item", "--table-name", "DANA-WebChat-Operators", "--key", json.dumps({"OPERATOR_ID": {"S": operator_id}}), "--region", "us-east-1"], check=True, capture_output=True)
        print("Registros temporales eliminados")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise
