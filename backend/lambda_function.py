import base64
import json
import logging
import os
import re
import uuid
import secrets
import string
import time
from datetime import datetime, timezone
from decimal import Decimal

import boto3
from botocore.config import Config

# CONFIGURACION

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def required_env(name):
    value = os.getenv(name)
    if value is None or str(value).strip() == "":
        raise RuntimeError(f"Falta variable de entorno requerida: {name}")
    return str(value).strip()


AWS_REGION = required_env("AWS_REGION")

SESSION_TABLE_NAME = required_env("SESSION_TABLE_NAME")
OPERATOR_TABLE_NAME = required_env("OPERATOR_TABLE_NAME")

WEBCHAT_BASE_URL = required_env("WEBCHAT_BASE_URL").rstrip("/")
SESSION_TTL_HOURS = int(required_env("SESSION_TTL_HOURS"))
SESSION_CODE_LENGTH = int(required_env("SESSION_CODE_LENGTH"))

BEDROCK_MODEL_ID = required_env("BEDROCK_MODEL_ID")
BEDROCK_MAX_TOKENS = int(required_env("BEDROCK_MAX_TOKENS"))
BEDROCK_TEMPERATURE = float(required_env("BEDROCK_TEMPERATURE"))

DANA_API_KEY = os.getenv("DANA_API_KEY", "")
OPERATOR_API_KEY = os.getenv("OPERATOR_API_KEY", "")

CORS_ALLOWED_ORIGIN = required_env("CORS_ALLOWED_ORIGIN")

MAX_MESSAGES = int(required_env("MAX_MESSAGES"))
MAX_MESSAGE_LENGTH = int(required_env("MAX_MESSAGE_LENGTH"))

MEDIA_BUCKET = required_env("MEDIA_BUCKET")
MEDIA_PREFIX = required_env("MEDIA_PREFIX").strip("/")
MEDIA_MAX_BYTES = int(required_env("MEDIA_MAX_BYTES"))
MEDIA_URL_TTL_SECONDS = int(required_env("MEDIA_URL_TTL_SECONDS"))
RECEIPT_CONFIDENCE_THRESHOLD = float(
    required_env("RECEIPT_CONFIDENCE_THRESHOLD")
)

CHIME_MEDIA_REGION = required_env("CHIME_MEDIA_REGION")


boto_config = Config(
    region_name=AWS_REGION,
    connect_timeout=10,
    read_timeout=30,
    retries={"max_attempts": 2, "mode": "standard"},
)

dynamodb = boto3.resource("dynamodb", config=boto_config)
session_table = dynamodb.Table(SESSION_TABLE_NAME)
operator_table = dynamodb.Table(OPERATOR_TABLE_NAME)
bedrock_runtime = boto3.client("bedrock-runtime", config=boto_config)

s3 = boto3.client(
    "s3",
    config=Config(
        region_name=AWS_REGION,
        signature_version="s3v4",
        connect_timeout=10,
        read_timeout=30,
        retries={"max_attempts": 2, "mode": "standard"},
    ),
)

chime_meetings = boto3.client(
    "chime-sdk-meetings",
    region_name=AWS_REGION,
    config=Config(
        region_name=AWS_REGION,
        connect_timeout=10,
        read_timeout=30,
        retries={"max_attempts": 2, "mode": "standard"},
    ),
)

ALLOWED_MEDIA_TYPES = {
    "image/jpeg": "image",
    "image/png": "image",
    "image/webp": "image",
    "application/pdf": "document",
    "application/msword": "document",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "document",
    "application/vnd.ms-excel": "document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "document",
    "audio/webm": "audio",
    "audio/mpeg": "audio",
    "audio/mp4": "audio",
    "audio/wav": "audio",
    "audio/x-wav": "audio",
}

BEDROCK_IMAGE_FORMATS = {
    "image/jpeg": "jpeg",
    "image/png": "png",
    "image/webp": "webp",
}


# HELPERS GENERALES

def now_ts():
    return int(time.time())


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def response(status_code=200, body=None, headers=None):
    if body is None:
        body = {}

    final_headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": CORS_ALLOWED_ORIGIN,
        "Access-Control-Allow-Headers": (
            "Content-Type,Authorization,X-Api-Key,X-Operator-Key"
        ),
        "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    }

    if headers:
        final_headers.update(headers)

    if isinstance(body, (dict, list)):
        body = json.dumps(body, ensure_ascii=False, default=str)

    return {
        "statusCode": status_code,
        "headers": final_headers,
        "body": body,
    }


def get_body(event):
    raw = event.get("body")
    if raw is None:
        return {}

    if event.get("isBase64Encoded") and isinstance(raw, str):
        raw = base64.b64decode(raw).decode("utf-8")

    if isinstance(raw, dict):
        return raw

    try:
        return json.loads(raw)
    except Exception:
        return {}


def get_headers(event):
    headers = event.get("headers") or {}
    return {str(k).lower(): str(v) for k, v in headers.items()}


def deep_decimal_to_native(obj):
    if isinstance(obj, list):
        return [deep_decimal_to_native(x) for x in obj]
    if isinstance(obj, dict):
        return {k: deep_decimal_to_native(v) for k, v in obj.items()}
    if isinstance(obj, Decimal):
        if obj == obj.to_integral():
            return int(obj)
        return float(obj)
    return obj


def deep_native_to_decimal(obj):
    if isinstance(obj, list):
        return [deep_native_to_decimal(x) for x in obj]
    if isinstance(obj, dict):
        return {k: deep_native_to_decimal(v) for k, v in obj.items()}
    if isinstance(obj, float):
        return Decimal(str(obj))
    return obj


def to_decimal_safe(value):
    try:
        return Decimal(str(value))
    except Exception:
        return Decimal("0")


def clean_text(value, max_length=None):
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if max_length:
        text = text[:max_length]
    return text


def parse_bool(value, default=False):
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float, Decimal)):
        return bool(value)

    normalized = str(value).strip().lower()
    if normalized in {"true", "1", "yes", "y", "si", "sí", "on"}:
        return True
    if normalized in {"false", "0", "no", "n", "off", ""}:
        return False
    return default


def normalize_currency(value):
    value = clean_text(value, 8).upper()
    return value or "USD"


def generate_code():
    alphabet = string.ascii_letters + string.digits

    for _ in range(8):
        code = "".join(secrets.choice(alphabet) for _ in range(SESSION_CODE_LENGTH))
        existing = session_table.get_item(Key={"CODE": code}).get("Item")
        if not existing:
            return code

    raise RuntimeError("No se pudo generar un codigo de sesion unico")


def trim_messages(messages):
    if not isinstance(messages, list):
        return []
    return messages[-MAX_MESSAGES:]


def make_message(role, text, message_type="text", metadata=None):
    item = {
        "id": secrets.token_hex(8),
        "role": role,
        "type": message_type,
        "text": clean_text(text, MAX_MESSAGE_LENGTH),
        "createdAt": now_iso(),
    }
    if metadata:
        item["metadata"] = metadata
    return item



def safe_filename(value):
    name = str(value or "archivo").strip()
    name = name.split("/")[-1].split("\\")[-1]
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", name)
    return name[:120] or "archivo"


def media_key_for(code, file_name):
    return (
        f"{MEDIA_PREFIX}/{clean_text(code, 64)}/"
        f"{uuid.uuid4().hex}-{safe_filename(file_name)}"
    )


def media_download_url(media_key):
    if not media_key:
        return ""
    try:
        return s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": MEDIA_BUCKET, "Key": media_key},
            ExpiresIn=MEDIA_URL_TTL_SECONDS,
        )
    except Exception:
        logger.exception("No se pudo firmar mediaKey=%s", media_key)
        return ""


def public_message_view(message):
    result = deep_decimal_to_native(message)
    metadata = result.get("metadata") or {}
    media_key = clean_text(metadata.get("mediaKey"), 1000)

    if media_key:
        result["mediaUrl"] = media_download_url(media_key)
        result["fileName"] = metadata.get("fileName") or ""
        result["contentType"] = metadata.get("contentType") or ""

    return result


def receipt_is_matched(session):
    return (
        (session.get("paymentValidation") or {}).get("result") == "MATCH"
        or (session.get("collection") or {}).get("status") in {"RECEIPT_MATCHED", "PAID"}
    )


def build_ui_state(session):
    mode = session.get("MODE") or "BOT"
    step = session.get("FLOW_STEP") or "HOME"
    code = clean_text(session.get("CODE"), 64)
    payment_url = clean_text(
        (session.get("collection") or {}).get("paymentUrl"),
        1000,
    )
    chat_url = f"{WEBCHAT_BASE_URL}/c/{code}" if code else ""

    ui = {
        "showSummaryCard": False,
        "showMainActions": False,
        "showPaymentButton": False,
        "paymentUrl": "",
        "allowReceiptUpload": False,
        "availableActions": [],
    }

    if mode == "WAITING_AGENT":
        return ui

    if mode == "AGENT":
        return ui

    if receipt_is_matched(session):
        ui["showSummaryCard"] = True
        ui["availableActions"] = ["TALK_TO_AGENT"]
        return ui

    if step == "HOME":
        ui["showSummaryCard"] = True
        ui["showMainActions"] = True
        ui["availableActions"] = [
            "PAY_NOW",
            "VIEW_DETAIL",
            "TALK_TO_AGENT",
        ]
        return ui

    if step == "DETAIL_VIEW":
        ui["availableActions"] = [
            "PAY_NOW",
            "TALK_TO_AGENT",
            "BACK_HOME",
        ]
        return ui

    if step == "WAITING_PAYMENT_PROOF":
        ui["allowReceiptUpload"] = True
        ui["availableActions"] = [
            "TALK_TO_AGENT",
            "BACK_HOME",
        ]
        if payment_url and payment_url.rstrip("/") != chat_url.rstrip("/"):
            ui["showPaymentButton"] = True
            ui["paymentUrl"] = payment_url
        return ui

    if step == "PAYMENT_MISMATCH":
        ui["allowReceiptUpload"] = True
        ui["availableActions"] = [
            "TALK_TO_AGENT",
            "BACK_HOME",
        ]
        return ui

    if step == "PAYMENT_MATCHED":
        ui["availableActions"] = [
            "BACK_HOME",
            "TALK_TO_AGENT",
        ]
        return ui

    if step == "PAYMENT_REVIEW":
        ui["availableActions"] = []
        return ui

    return ui


def parse_json_object(text):
    raw = str(text or "").strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.I)
        raw = re.sub(r"\s*```$", "", raw)
    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        raw = raw[start:end + 1]
    return json.loads(raw)


def call_public_view(session):
    call = deep_decimal_to_native(session.get("call") or {})
    if not call:
        return {
            "status": "IDLE",
            "initiatedBy": "",
            "startedAt": None,
            "acceptedAt": None,
            "endedAt": None,
        }

    return {
        "status": call.get("status") or "IDLE",
        "initiatedBy": call.get("initiatedBy") or "",
        "initiatedByName": call.get("initiatedByName") or "",
        "startedAt": call.get("startedAt"),
        "acceptedAt": call.get("acceptedAt"),
        "endedAt": call.get("endedAt"),
        "endedBy": call.get("endedBy") or "",
    }


def chime_join_payload(meeting, attendee):
    return {
        "meeting": deep_decimal_to_native(meeting),
        "attendee": deep_decimal_to_native(attendee),
    }


def get_active_meeting(session):
    call = session.get("call") or {}
    meeting_id = clean_text(call.get("meetingId"), 128)
    if not meeting_id:
        return None

    try:
        result = chime_meetings.get_meeting(MeetingId=meeting_id)
        return result.get("Meeting")
    except Exception:
        logger.exception("No se pudo obtener Chime meeting=%s", meeting_id)
        return None


def validate_call_actor(session, data):
    sender = clean_text(data.get("sender") or "user", 20).lower()

    if sender == "user":
        return "user", ""

    if sender != "operator":
        raise ValueError("invalid_sender")

    operator_id = clean_text(data.get("operatorId"), 80)
    if not operator_id:
        raise ValueError("operatorId_required")

    if session.get("MODE") != "AGENT":
        raise PermissionError("session_not_in_agent_mode")

    if session.get("assignedOperatorId") != operator_id:
        raise PermissionError("operator_not_assigned")

    return "operator", operator_id


def create_chime_attendee(meeting_id, external_user_id):
    result = chime_meetings.create_attendee(
        MeetingId=meeting_id,
        ExternalUserId=clean_text(external_user_id, 64),
    )
    return result.get("Attendee") or {}


def start_call(code, data):
    session = get_session(code)
    if not session:
        return 404, {"success": False, "error": "session_not_found"}

    try:
        sender, operator_id = validate_call_actor(session, data)
    except ValueError as exc:
        return 400, {"success": False, "error": str(exc)}
    except PermissionError as exc:
        return 403, {"success": False, "error": str(exc)}

    if sender != "operator":
        return 403, {"success": False, "error": "operator_required_for_call"}

    current_call = session.get("call") or {}
    if current_call.get("status") in {"RINGING", "IN_CALL"}:
        return 409, {
            "success": False,
            "error": "call_already_active",
            "call": call_public_view(session),
        }

    if session.get("MODE") != "AGENT":
        return 409, {
            "success": False,
            "error": "operator_required_for_call",
        }

    meeting_result = chime_meetings.create_meeting(
        ClientRequestToken=uuid.uuid4().hex,
        ExternalMeetingId=f"linkchat-{clean_text(code, 40)}",
        MediaRegion=CHIME_MEDIA_REGION,
        MeetingFeatures={
            "Video": {"MaxResolution": "None"},
            "Content": {"MaxResolution": "None"},
        },
    )
    meeting = meeting_result.get("Meeting") or {}
    meeting_id = meeting.get("MeetingId")
    if not meeting_id:
        return 502, {"success": False, "error": "chime_meeting_not_created"}

    initiator_name = (
        session.get("assignedOperatorName", "")
        if sender == "operator"
        else (session.get("customer") or {}).get("firstName", "")
    )

    session["call"] = {
        "status": "RINGING",
        "initiatedBy": sender,
        "initiatedByName": initiator_name,
        "meetingId": meeting_id,
        "externalMeetingId": meeting.get("ExternalMeetingId"),
        "mediaRegion": meeting.get("MediaRegion") or CHIME_MEDIA_REGION,
        "startedAt": now_iso(),
        "acceptedAt": None,
        "endedAt": None,
        "endedBy": "",
    }

    session["messages"].append(
        make_message(
            "system",
            f"{initiator_name or 'Un participante'} inicio una llamada de audio.",
            metadata={
                "event": "CALL_RINGING",
                "initiatedBy": sender,
            },
        )
    )
    save_session(session)

    attendee = create_chime_attendee(
        meeting_id,
        f"{sender}-{operator_id or code}-{uuid.uuid4().hex[:8]}",
    )

    return 200, {
        "success": True,
        "call": call_public_view(session),
        "joinInfo": chime_join_payload(meeting, attendee),
        "session": session_public_view(session),
    }


def accept_call(code, data):
    session = get_session(code)
    if not session:
        return 404, {"success": False, "error": "session_not_found"}

    try:
        sender, operator_id = validate_call_actor(session, data)
    except ValueError as exc:
        return 400, {"success": False, "error": str(exc)}
    except PermissionError as exc:
        return 403, {"success": False, "error": str(exc)}

    if sender != "user":
        return 403, {"success": False, "error": "customer_required_to_accept_call"}

    call = session.get("call") or {}
    if call.get("status") != "RINGING":
        return 409, {
            "success": False,
            "error": "call_not_ringing",
            "call": call_public_view(session),
        }

    if sender == call.get("initiatedBy"):
        return 409, {
            "success": False,
            "error": "initiator_cannot_accept_own_call",
        }

    meeting = get_active_meeting(session)
    if not meeting:
        session["call"]["status"] = "ENDED"
        session["call"]["endedAt"] = now_iso()
        session["call"]["endedBy"] = "system"
        save_session(session)
        return 410, {"success": False, "error": "call_meeting_expired"}

    attendee = create_chime_attendee(
        meeting["MeetingId"],
        f"{sender}-{operator_id or code}-{uuid.uuid4().hex[:8]}",
    )

    session["call"]["status"] = "IN_CALL"
    session["call"]["acceptedAt"] = now_iso()
    session["messages"].append(
        make_message(
            "system",
            "La llamada de audio fue atendida.",
            metadata={"event": "CALL_ACCEPTED"},
        )
    )
    save_session(session)

    return 200, {
        "success": True,
        "call": call_public_view(session),
        "joinInfo": chime_join_payload(meeting, attendee),
        "session": session_public_view(session),
    }


def join_call(code, data):
    session = get_session(code)
    if not session:
        return 404, {"success": False, "error": "session_not_found"}

    try:
        sender, operator_id = validate_call_actor(session, data)
    except ValueError as exc:
        return 400, {"success": False, "error": str(exc)}
    except PermissionError as exc:
        return 403, {"success": False, "error": str(exc)}

    call = session.get("call") or {}
    if call.get("status") not in {"RINGING", "IN_CALL"}:
        return 409, {
            "success": False,
            "error": "call_not_active",
            "call": call_public_view(session),
        }

    if sender == "user" and call.get("status") != "IN_CALL":
        return 409, {"success": False, "error": "call_not_accepted"}

    meeting = get_active_meeting(session)
    if not meeting:
        return 410, {"success": False, "error": "call_meeting_expired"}

    attendee = create_chime_attendee(
        meeting["MeetingId"],
        f"{sender}-{operator_id or code}-{uuid.uuid4().hex[:8]}",
    )

    return 200, {
        "success": True,
        "call": call_public_view(session),
        "joinInfo": chime_join_payload(meeting, attendee),
        "session": session_public_view(session),
    }


def reject_call(code, data):
    session = get_session(code)
    if not session:
        return 404, {"success": False, "error": "session_not_found"}

    try:
        sender, operator_id = validate_call_actor(session, data)
    except ValueError as exc:
        return 400, {"success": False, "error": str(exc)}
    except PermissionError as exc:
        return 403, {"success": False, "error": str(exc)}

    if sender != "user":
        return 403, {"success": False, "error": "customer_required_to_reject_call"}

    call = session.get("call") or {}
    if call.get("status") != "RINGING":
        return 409, {
            "success": False,
            "error": "call_not_ringing",
            "call": call_public_view(session),
        }

    meeting_id = clean_text(call.get("meetingId"), 128)
    if meeting_id:
        try:
            chime_meetings.delete_meeting(MeetingId=meeting_id)
        except Exception:
            logger.exception("No se pudo borrar meeting rechazado=%s", meeting_id)

    session["call"]["status"] = "REJECTED"
    session["call"]["endedAt"] = now_iso()
    session["call"]["endedBy"] = sender
    session["messages"].append(
        make_message(
            "system",
            "La llamada de audio fue rechazada.",
            metadata={
                "event": "CALL_REJECTED",
                "rejectedBy": sender,
            },
        )
    )
    save_session(session)

    return 200, {
        "success": True,
        "call": call_public_view(session),
        "session": session_public_view(session),
    }


def end_call(code, data):
    session = get_session(code)
    if not session:
        return 404, {"success": False, "error": "session_not_found"}

    try:
        sender, operator_id = validate_call_actor(session, data)
    except ValueError as exc:
        return 400, {"success": False, "error": str(exc)}
    except PermissionError as exc:
        return 403, {"success": False, "error": str(exc)}

    call = session.get("call") or {}
    if call.get("status") not in {"RINGING", "IN_CALL"}:
        return 409, {
            "success": False,
            "error": "call_not_active",
            "call": call_public_view(session),
        }

    meeting_id = clean_text(call.get("meetingId"), 128)
    if meeting_id:
        try:
            chime_meetings.delete_meeting(MeetingId=meeting_id)
        except Exception:
            logger.exception("No se pudo borrar meeting=%s", meeting_id)

    session["call"]["status"] = "ENDED"
    session["call"]["endedAt"] = now_iso()
    session["call"]["endedBy"] = sender
    session["messages"].append(
        make_message(
            "system",
            "La llamada de audio finalizo.",
            metadata={
                "event": "CALL_ENDED",
                "endedBy": sender,
            },
        )
    )
    save_session(session)

    return 200, {
        "success": True,
        "call": call_public_view(session),
        "session": session_public_view(session),
    }


def session_public_view(session):
    session = deep_decimal_to_native(session)

    return {
        "code": session.get("CODE"),
        "status": session.get("STATUS"),
        "mode": session.get("MODE"),
        "process": session.get("PROCESS"),
        "flowStep": session.get("FLOW_STEP") or "HOME",
        "customer": session.get("customer", {}),
        "collection": session.get("collection", {}),
        "brand": session.get("brand", {}),
        "assignedOperatorId": session.get("assignedOperatorId"),
        "assignedOperatorName": session.get("assignedOperatorName"),
        "messages": [
            public_message_view(message)
            for message in session.get("messages", [])
        ],
        "paymentValidation": session.get("paymentValidation"),
        "ui": build_ui_state(session),
        "call": call_public_view(session),
        "createdAt": session.get("createdAt"),
        "expiresAt": session.get("expireAt"),
    }

def operator_public_view(operator):
    operator = deep_decimal_to_native(operator)
    return {
        "operatorId": operator.get("OPERATOR_ID"),
        "name": operator.get("NAME"),
        "email": operator.get("EMAIL"),
        "active": parse_bool(operator.get("ACTIVE"), False),
        "available": parse_bool(operator.get("AVAILABLE"), False),
        "currentSessionCode": operator.get("CURRENT_SESSION_CODE") or "",
        "updatedAt": operator.get("updatedAt"),
    }


# AUTORIZACION SIMPLE PARA POC

def require_dana_key(event):
    if not DANA_API_KEY:
        return True
    supplied = get_headers(event).get("x-api-key", "")
    return secrets.compare_digest(supplied, DANA_API_KEY)


def require_operator_key(event):
    if not OPERATOR_API_KEY:
        return True
    supplied = get_headers(event).get("x-operator-key", "")
    return secrets.compare_digest(supplied, OPERATOR_API_KEY)


# SESIONES

def get_session(code):
    code = clean_text(code, 64)
    if not code:
        return None

    item = session_table.get_item(Key={"CODE": code}).get("Item")
    if not item:
        return None

    item = deep_decimal_to_native(item)

    if int(item.get("expireAt") or 0) and int(item["expireAt"]) <= now_ts():
        return None

    if item.get("STATUS") in {"REVOKED", "EXPIRED"}:
        return None

    return item


def save_session(session):
    session["messages"] = trim_messages(session.get("messages", []))
    session["updatedAt"] = now_iso()
    session_table.put_item(Item=deep_native_to_decimal(session))
    return session


def create_session(data):
    first_name = clean_text(
        data.get("firstName")
        or data.get("nombre")
        or data.get("name"),
        80,
    )
    if not first_name:
        raise ValueError("firstName es requerido")

    phone = clean_text(
        data.get("phone")
        or data.get("telefono")
        or data.get("telephone"),
        40,
    )

    balance = to_decimal_safe(data.get("balance") or data.get("saldo"))
    if balance < 0:
        raise ValueError("balance no puede ser negativo")

    currency = normalize_currency(data.get("currency") or data.get("moneda"))
    due_date = clean_text(data.get("dueDate") or data.get("fechaLimite"), 40)
    reference = clean_text(data.get("reference") or data.get("referencia"), 100)
    payment_url = clean_text(data.get("paymentUrl") or data.get("urlPago"), 1000)

    company_name = clean_text(
        data.get("companyName")
        or data.get("empresa")
        or "Example Company",
        120,
    )
    company_subtitle = clean_text(
        data.get("companySubtitle")
        or data.get("subtitulo")
        or "Atencion digital",
        120,
    )

    external_id = clean_text(
        data.get("externalId")
        or data.get("idCliente")
        or data.get("idConversation")
        or "",
        150,
    )

    code = generate_code()
    created_at = now_ts()
    expire_at = created_at + (SESSION_TTL_HOURS * 3600)

    welcome_messages = [
        make_message(
            "assistant",
            f"Hola {first_name}. Aquí tienes el estado de tu cuenta.",
        )
    ]

    item = {
        "CODE": code,
        "STATUS": "ACTIVE",
        "MODE": "BOT",
        "PROCESS": "COLLECTIONS",
        "FLOW_STEP": "HOME",
        "paymentValidation": None,
        "call": {
            "status": "IDLE",
            "initiatedBy": "",
            "initiatedByName": "",
            "meetingId": "",
            "externalMeetingId": "",
            "mediaRegion": "",
            "startedAt": None,
            "acceptedAt": None,
            "endedAt": None,
            "endedBy": "",
        },
        "externalId": external_id,
        "customer": {
            "firstName": first_name,
            "phone": phone,
        },
        "collection": {
            "balance": balance,
            "currency": currency,
            "dueDate": due_date,
            "reference": reference,
            "paymentUrl": payment_url,
            "status": "PENDING",
        },
        "brand": {
            "companyName": company_name,
            "subtitle": company_subtitle,
        },
        "assignedOperatorId": "",
        "assignedOperatorName": "",
        "messages": welcome_messages,
        "createdAt": now_iso(),
        "createdAtEpoch": created_at,
        "updatedAt": now_iso(),
        "expireAt": expire_at,
    }

    session_table.put_item(Item=item)

    return {
        "success": True,
        "code": code,
        "chatUrl": f"{WEBCHAT_BASE_URL}/c/{code}",
        "expiresAt": expire_at,
        "session": session_public_view(item),
    }

def bedrock_system_prompt(session):
    customer = session.get("customer", {})
    collection = session.get("collection", {})
    brand = session.get("brand", {})

    first_name = clean_text(customer.get("firstName"), 80)
    company_name = clean_text(brand.get("companyName"), 120)
    currency = clean_text(collection.get("currency"), 8)
    balance = collection.get("balance", 0)
    due_date = clean_text(collection.get("dueDate"), 40)
    reference = clean_text(collection.get("reference"), 100)
    flow_step = clean_text(session.get("FLOW_STEP") or "HOME", 80)
    payment_confirmed = receipt_is_matched(session)
    receipt_status = "pago acreditado" if payment_confirmed else "sin pago acreditado"
    balance_label = "Monto pagado" if payment_confirmed else "Saldo pendiente"

    return f"""
Eres el asistente digital de cobranza de {company_name} dentro de DANA LinkChat.

Tu funcion es atender de manera breve, clara, respetuosa y profesional un proceso SIMPLE de cobranza.

Contexto autorizado de esta sesion:
- Cliente: {first_name}
- {balance_label}: {currency} {balance}
- Fecha limite: {due_date}
- Referencia: {reference}
- Etapa actual del flujo: {flow_step}
- Estado del comprobante: {receipt_status}

REGLAS OBLIGATORIAS:
1. No inventes montos, fechas, referencias, descuentos, acuerdos ni informacion del cliente.
2. No negocies refinanciamientos, promesas de pago, quitas, descuentos ni nuevas fechas.
3. No solicites numeros completos de tarjeta, CVV, claves, contrasenas ni datos bancarios sensibles.
4. Si preguntan como pagar y aun no hay pago acreditado, indica que pueden usar la opcion "Pagar ahora". Si el pago ya esta acreditado, no sugieras pagar otra vez.
5. Si necesitan una excepcion, negociacion, reclamo o algo fuera de la informacion disponible, indica que pueden solicitar "Hablar con un asesor".
6. No digas que eres WhatsApp ni imites una marca externa.
7. Responde normalmente en espanol.
8. Mantente en el contexto de cobranza y no hagas afirmaciones que no esten respaldadas por la sesion.
9. Responde directamente en una o dos frases breves (maximo 30 palabras). No repitas el saldo, la fecha ni la referencia si ya aparecen en el resumen, salvo que el cliente los pregunte.
10. Si la etapa es WAITING_PAYMENT_PROOF, indica que puede adjuntar el comprobante desde el chat.
11. En esta demo, MATCH significa pago acreditado. No afirmes eso para REVIEW, MISMATCH o INVALID_RECEIPT.
""".strip()


def build_bedrock_messages(session, new_user_text=None):
    history = session.get("messages", [])
    conversation = []
    started = False

    for msg in history[-12:]:
        role = msg.get("role")
        text = clean_text(msg.get("text"), MAX_MESSAGE_LENGTH)

        if not text:
            continue

        if not started:
            if role != "user":
                continue
            started = True

        if role == "user":
            if conversation and conversation[-1]["role"] == "user":
                conversation[-1]["content"][0]["text"] += "\\n" + text
            else:
                conversation.append({
                    "role": "user",
                    "content": [{"text": text}],
                })

        elif role == "assistant":
            if conversation and conversation[-1]["role"] == "user":
                conversation.append({
                    "role": "assistant",
                    "content": [{"text": text}],
                })

    return conversation

def ask_bedrock(session, user_text):
    result = bedrock_runtime.converse(
        modelId=BEDROCK_MODEL_ID,
        system=[{"text": bedrock_system_prompt(session)}],
        messages=build_bedrock_messages(session, user_text),
        inferenceConfig={
            "maxTokens": BEDROCK_MAX_TOKENS,
            "temperature": BEDROCK_TEMPERATURE,
        },
    )

    content = result.get("output", {}).get("message", {}).get("content", [])
    text = "".join(
        block.get("text", "")
        for block in content
        if isinstance(block, dict)
    ).strip()

    if not text:
        return "No pude responder. Intenta de nuevo o habla con un asesor."

    return clean_text(text, MAX_MESSAGE_LENGTH)


# MENSAJES DEL CLIENTE

def send_customer_message(code, data):
    session = get_session(code)
    if not session:
        return 404, {"success": False, "error": "session_not_found"}

    if session.get("STATUS") != "ACTIVE":
        return 409, {"success": False, "error": "session_not_active"}

    text = clean_text(data.get("message") or data.get("text"), MAX_MESSAGE_LENGTH)
    if not text:
        return 400, {"success": False, "error": "message_required"}

    user_message = make_message("user", text)

    messages = session.get("messages", [])
    messages.append(user_message)
    session["messages"] = trim_messages(messages)

    mode = session.get("MODE") or "BOT"

    if mode == "BOT":
        try:
            answer = ask_bedrock(session, text)
        except Exception:
            logger.exception("Bedrock fallo para session=%s", code)
            answer = "No pude responder. Intenta de nuevo o habla con un asesor."

        assistant_message = make_message("assistant", answer)
        session["messages"].append(assistant_message)
        save_session(session)

        return 200, {
            "success": True,
            "mode": "BOT",
            "userMessage": user_message,
            "reply": assistant_message,
            "session": session_public_view(session),
        }

    if mode == "WAITING_AGENT":
        save_session(session)
        return 200, {
            "success": True,
            "mode": "WAITING_AGENT",
            "userMessage": user_message,
            "reply": None,
            "session": session_public_view(session),
        }

    if mode == "AGENT":
        save_session(session)
        return 200, {
            "success": True,
            "mode": "AGENT",
            "userMessage": user_message,
            "reply": None,
            "session": session_public_view(session),
        }

    save_session(session)
    return 200, {
        "success": True,
        "mode": mode,
        "userMessage": user_message,
        "reply": None,
        "session": session_public_view(session),
    }


# ACCIONES DE COBRANZA

def process_customer_action(code, data):
    session = get_session(code)
    if not session:
        return 404, {"success": False, "error": "session_not_found"}

    action = clean_text(data.get("action"), 80).upper()
    collection = session.get("collection", {})

    if receipt_is_matched(session) and action in {"PAY_NOW", "VIEW_DETAIL", "BACK_HOME"}:
        return 409, {"success": False, "error": "payment_already_confirmed"}

    if action == "PAY_NOW":
        session["FLOW_STEP"] = "WAITING_PAYMENT_PROOF"

        user_message = make_message("user", "Quiero pagar ahora")
        reply = make_message(
            "assistant",
            "Cuando pagues, adjunta aquí el comprobante.",
            metadata={"action": "PAY_NOW"},
        )

        session["messages"].extend([user_message, reply])
        save_session(session)

        return 200, {
            "success": True,
            "action": action,
            "session": session_public_view(session),
        }

    if action == "VIEW_DETAIL":
        session["FLOW_STEP"] = "DETAIL_VIEW"

        user_message = make_message("user", "Quiero ver el detalle")
        currency = clean_text(collection.get("currency"), 8)
        balance = collection.get("balance", 0)
        due_date = clean_text(collection.get("dueDate"), 40)
        reference = clean_text(collection.get("reference"), 100)

        detail = (
            f"Saldo pendiente: {currency} {balance}. "
            f"Fecha limite: {due_date or 'No disponible'}. "
            f"Referencia: {reference or 'No disponible'}."
        )

        reply = make_message(
            "assistant",
            detail,
            metadata={"action": "VIEW_DETAIL"},
        )

        session["messages"].extend([user_message, reply])
        save_session(session)

        return 200, {
            "success": True,
            "action": action,
            "session": session_public_view(session),
        }

    if action == "BACK_HOME":
        session["FLOW_STEP"] = "HOME"
        reply = make_message(
            "assistant",
            "Puedes continuar desde el resumen de tu cuenta.",
            metadata={"action": "BACK_HOME"},
        )
        session["messages"].append(reply)
        save_session(session)

        return 200, {
            "success": True,
            "action": action,
            "session": session_public_view(session),
        }

    if action == "TALK_TO_AGENT":
        session["MODE"] = "WAITING_AGENT"
        session["FLOW_STEP"] = "WAITING_AGENT"
        session["assignedOperatorId"] = ""
        session["assignedOperatorName"] = ""

        user_message = make_message("user", "Quiero hablar con un asesor")
        system_message = make_message(
            "system",
            "Estamos buscando un asesor disponible.",
            metadata={"action": "TALK_TO_AGENT"},
        )

        session["messages"].extend([user_message, system_message])
        save_session(session)

        return 200, {
            "success": True,
            "action": action,
            "mode": "WAITING_AGENT",
            "session": session_public_view(session),
        }

    return 400, {
        "success": False,
        "error": "unsupported_action",
        "supported": [
            "PAY_NOW",
            "VIEW_DETAIL",
            "BACK_HOME",
            "TALK_TO_AGENT",
        ],
    }


# MEDIA Y COMPROBANTES

def validate_media_request(data):
    file_name = safe_filename(data.get("fileName"))
    content_type = clean_text(data.get("contentType"), 160).lower()
    size = int(data.get("size") or 0)

    media_type = ALLOWED_MEDIA_TYPES.get(content_type)
    if not media_type:
        raise ValueError("unsupported_content_type")

    if size <= 0:
        raise ValueError("invalid_file_size")

    if size > MEDIA_MAX_BYTES:
        raise ValueError("file_too_large")

    return file_name, content_type, size, media_type


def authorize_media_sender(session, data):
    sender = clean_text(data.get("sender") or "user", 20).lower()

    if sender == "user":
        return "user", ""

    if sender != "operator":
        raise ValueError("invalid_sender")

    operator_id = clean_text(data.get("operatorId"), 80)
    if not operator_id:
        raise ValueError("operatorId_required")

    if session.get("MODE") != "AGENT":
        raise PermissionError("session_not_in_agent_mode")

    if session.get("assignedOperatorId") != operator_id:
        raise PermissionError("operator_not_assigned")

    return "operator", operator_id


def create_media_upload(code, data):
    session = get_session(code)
    if not session:
        return 404, {"success": False, "error": "session_not_found"}

    try:
        file_name, content_type, size, media_type = validate_media_request(data)
        sender, operator_id = authorize_media_sender(session, data)
    except ValueError as exc:
        return 400, {"success": False, "error": str(exc)}
    except PermissionError as exc:
        return 403, {"success": False, "error": str(exc)}

    media_key = media_key_for(code, file_name)

    upload_url = s3.generate_presigned_url(
        "put_object",
        Params={
            "Bucket": MEDIA_BUCKET,
            "Key": media_key,
            "ContentType": content_type,
        },
        ExpiresIn=900,
        HttpMethod="PUT",
    )

    return 200, {
        "success": True,
        "uploadUrl": upload_url,
        "mediaKey": media_key,
        "fileName": file_name,
        "contentType": content_type,
        "mediaType": media_type,
        "size": size,
        "sender": sender,
        "operatorId": operator_id,
        "uploadHeaders": {
            "Content-Type": content_type,
        },
    }


def analyze_payment_receipt(session, media_key, content_type):
    image_format = BEDROCK_IMAGE_FORMATS.get(content_type)
    if not image_format:
        return {
            "isPaymentReceipt": False,
            "confidence": 0,
            "reason": "El archivo no es una imagen compatible para validar comprobantes.",
            "extracted": {},
        }

    obj = s3.get_object(Bucket=MEDIA_BUCKET, Key=media_key)
    image_bytes = obj["Body"].read()

    prompt = """
Analiza esta imagen como posible comprobante de pago.

Devuelve SOLO un objeto JSON valido, sin markdown, con esta forma:
{
  "isPaymentReceipt": true,
  "confidence": 0.0,
  "extracted": {
    "amount": null,
    "currency": null,
    "date": null,
    "operationNumber": null,
    "payer": null,
    "recipient": null,
    "bank": null,
    "phone": null,
    "reference": null
  },
  "reason": ""
}

Reglas:
- No inventes datos que no sean visibles.
- amount debe representar el monto pagado y ser numero sin simbolos cuando sea legible.
- currency debe ser la moneda visible o inferible directamente del comprobante, por ejemplo VES o USD.
- confidence debe estar entre 0 y 1.
- isPaymentReceipt solo debe ser true si la imagen parece realmente un comprobante,
  recibo o confirmacion de una operacion de pago.
- El banco de origen puede ser cualquiera.
- No asumas que la referencia bancaria debe coincidir con la referencia de deuda.
- payer, recipient, bank, phone y reference son informativos para esta demostracion.
""".strip()

    result = bedrock_runtime.converse(
        modelId=BEDROCK_MODEL_ID,
        messages=[{
            "role": "user",
            "content": [
                {"text": prompt},
                {
                    "image": {
                        "format": image_format,
                        "source": {"bytes": image_bytes},
                    }
                },
            ],
        }],
        inferenceConfig={
            "maxTokens": 800,
            "temperature": 0,
        },
    )

    content = result.get("output", {}).get("message", {}).get("content", [])
    raw = "".join(
        block.get("text", "")
        for block in content
        if isinstance(block, dict)
    ).strip()

    parsed = parse_json_object(raw)
    parsed["confidence"] = float(parsed.get("confidence") or 0)
    parsed["extracted"] = parsed.get("extracted") or {}
    return parsed


def text_matches(expected, actual):
    expected = clean_text(expected, 200).lower()
    actual = clean_text(actual, 200).lower()

    if not expected:
        return None
    if not actual:
        return False

    expected_norm = re.sub(r"[^a-z0-9]+", "", expected)
    actual_norm = re.sub(r"[^a-z0-9]+", "", actual)
    return expected_norm in actual_norm or actual_norm in expected_norm


def normalize_amount(value):
    if value in (None, ""):
        return None

    text = clean_text(value, 80)
    if not text:
        return None

    text = (
        text.replace("Bs.", "")
        .replace("Bs", "")
        .replace("VES", "")
        .replace("USD", "")
        .replace("$", "")
        .replace(" ", "")
    )

    if "," in text and "." in text:
        if text.rfind(",") > text.rfind("."):
            text = text.replace(".", "").replace(",", ".")
        else:
            text = text.replace(",", "")
    elif "," in text:
        parts = text.split(",")
        if len(parts[-1]) in {1, 2}:
            text = "".join(parts[:-1]) + "." + parts[-1]
        else:
            text = text.replace(",", "")
    elif "." in text:
        parts = text.split(".")
        if len(parts) > 2:
            text = "".join(parts[:-1]) + "." + parts[-1]
        elif len(parts[-1]) == 3:
            text = text.replace(".", "")

    text = re.sub(r"[^0-9.-]", "", text)
    if not text or text in {"-", ".", "-."}:
        return None

    try:
        return Decimal(text)
    except Exception:
        return None


def normalize_receipt_currency(value):
    raw = clean_text(value, 40).upper()
    if not raw:
        return None

    normalized = (
        raw.replace("Í", "I")
        .replace("Ó", "O")
        .replace("Á", "A")
        .replace("É", "E")
        .replace("Ú", "U")
        .strip()
    )

    ves_aliases = {"VES", "BS", "BS.", "BSS", "BS.S", "BOLIVAR", "BOLIVARES"}
    usd_aliases = {"USD", "US$", "$", "DOLAR", "DOLARES"}

    if normalized in ves_aliases or "BOLIVAR" in normalized:
        return "VES"
    if normalized in usd_aliases or "DOLAR" in normalized:
        return "USD"

    return normalized[:8]

def validate_payment_receipt(session, analysis):
    collection = session.get("collection", {})
    extracted = analysis.get("extracted") or {}

    is_receipt = bool(analysis.get("isPaymentReceipt"))
    confidence = float(analysis.get("confidence") or 0)

    expected_amount = normalize_amount(collection.get("balance"))
    detected_amount = normalize_amount(extracted.get("amount"))
    expected_currency = normalize_receipt_currency(collection.get("currency"))
    detected_currency = normalize_receipt_currency(extracted.get("currency"))

    amount_match = None
    if expected_amount is not None and detected_amount is not None:
        amount_match = abs(detected_amount - expected_amount) <= Decimal("0.01")

    currency_match = None
    if expected_currency and detected_currency:
        currency_match = detected_currency == expected_currency

    if not is_receipt:
        result = "INVALID_RECEIPT"
    elif amount_match is False:
        result = "MISMATCH"
    elif currency_match is False:
        result = "MISMATCH"
    elif detected_amount is None:
        result = "REVIEW"
    elif expected_amount is None:
        result = "REVIEW"
    elif confidence < RECEIPT_CONFIDENCE_THRESHOLD:
        result = "REVIEW"
    else:
        result = "MATCH"

    return {
        "result": result,
        "confidence": confidence,
        "checks": {
            "isPaymentReceipt": is_receipt,
            "amountMatches": amount_match,
            "currencyMatches": currency_match,
        },
        "expected": {
            "amount": deep_decimal_to_native(expected_amount) if expected_amount is not None else None,
            "currency": expected_currency,
        },
        "extracted": {
            "amount": deep_decimal_to_native(detected_amount) if detected_amount is not None else extracted.get("amount"),
            "currency": detected_currency or extracted.get("currency"),
            "date": extracted.get("date"),
            "operationNumber": extracted.get("operationNumber"),
            "payer": extracted.get("payer"),
            "recipient": extracted.get("recipient"),
            "bank": extracted.get("bank"),
            "phone": extracted.get("phone"),
            "reference": extracted.get("reference"),
        },
        "reason": clean_text(analysis.get("reason"), 500),
        "validatedAt": now_iso(),
    }


def confirm_media_upload(code, data):
    session = get_session(code)
    if not session:
        return 404, {"success": False, "error": "session_not_found"}

    try:
        file_name, content_type, requested_size, media_type = validate_media_request(data)
        sender, operator_id = authorize_media_sender(session, data)
    except ValueError as exc:
        return 400, {"success": False, "error": str(exc)}
    except PermissionError as exc:
        return 403, {"success": False, "error": str(exc)}

    media_key = clean_text(data.get("mediaKey"), 1000)
    expected_prefix = f"{MEDIA_PREFIX}/{clean_text(code, 64)}/"

    if not media_key or not media_key.startswith(expected_prefix):
        return 400, {"success": False, "error": "invalid_media_key"}

    try:
        head = s3.head_object(Bucket=MEDIA_BUCKET, Key=media_key)
    except Exception:
        logger.exception("Media no encontrada key=%s", media_key)
        return 404, {"success": False, "error": "media_not_found"}

    actual_size = int(head.get("ContentLength") or 0)
    actual_content_type = clean_text(head.get("ContentType"), 160).lower()

    if actual_size <= 0 or actual_size > MEDIA_MAX_BYTES:
        try:
            s3.delete_object(Bucket=MEDIA_BUCKET, Key=media_key)
        except Exception:
            pass
        return 400, {"success": False, "error": "invalid_uploaded_size"}

    if actual_content_type and actual_content_type != content_type:
        return 400, {"success": False, "error": "content_type_mismatch"}

    role = "assistant" if sender == "operator" else "user"
    metadata = {
        "mediaKey": media_key,
        "fileName": file_name,
        "contentType": content_type,
        "size": actual_size,
        "source": sender,
    }

    if operator_id:
        metadata["operatorId"] = operator_id
        metadata["operatorName"] = session.get("assignedOperatorName", "")

    media_message = make_message(
        role,
        file_name,
        message_type=media_type,
        metadata=metadata,
    )

    session["messages"].append(media_message)

    receipt_validation = None

    if (
        sender == "user"
        and media_type == "image"
        and session.get("FLOW_STEP") in {
            "WAITING_PAYMENT_PROOF",
            "PAYMENT_MISMATCH",
        }
    ):
        session["FLOW_STEP"] = "PAYMENT_REVIEW"
        save_session(session)

        try:
            analysis = analyze_payment_receipt(
                session,
                media_key,
                content_type,
            )
            receipt_validation = validate_payment_receipt(session, analysis)
            session["paymentValidation"] = receipt_validation

            result = receipt_validation["result"]

            if result == "MATCH":
                session["FLOW_STEP"] = "PAYMENT_MATCHED"
                session["collection"]["status"] = "PAID"
                reply = make_message(
                    "assistant",
                    "Pago acreditado. Gracias.",
                    metadata={"event": "RECEIPT_MATCHED", "validation": "MATCH"},
                )
                session["messages"].append(reply)

            elif result == "MISMATCH":
                session["FLOW_STEP"] = "PAYMENT_MISMATCH"
                text = "El monto o la moneda no coinciden. Adjunta otro comprobante o habla con un asesor."
                session["messages"].append(make_message(
                    "assistant", text,
                    metadata={"event": "RECEIPT_MISMATCH", "validation": "MISMATCH"},
                ))

            elif result == "INVALID_RECEIPT":
                session["FLOW_STEP"] = "PAYMENT_MISMATCH"
                session["messages"].append(make_message(
                    "assistant",
                    "No parece un comprobante. Adjunta otro archivo o habla con un asesor.",
                    metadata={"event": "INVALID_RECEIPT", "validation": "INVALID_RECEIPT"},
                ))

            else:
                session["FLOW_STEP"] = "PAYMENT_REVIEW"
                session["MODE"] = "WAITING_AGENT"
                session["assignedOperatorId"] = ""
                session["assignedOperatorName"] = ""
                session["messages"].append(make_message(
                    "system",
                    "Buscando un asesor para revisar tu comprobante.",
                    metadata={"event": "RECEIPT_REVIEW", "validation": "REVIEW"},
                ))


        except Exception:
            logger.exception("Fallo validando comprobante session=%s", code)
            session["FLOW_STEP"] = "PAYMENT_REVIEW"
            session["MODE"] = "WAITING_AGENT"
            session["assignedOperatorId"] = ""
            session["assignedOperatorName"] = ""
            session["paymentValidation"] = {
                "result": "REVIEW",
                "reason": "receipt_analysis_failed",
                "validatedAt": now_iso(),
            }
            session["messages"].append(
                make_message(
                    "system",
                    "Buscando un asesor para revisar tu comprobante.",
                    metadata={
                        "event": "RECEIPT_REVIEW",
                        "validation": "REVIEW",
                    },
                )
            )

    save_session(session)

    return 200, {
        "success": True,
        "message": public_message_view(media_message),
        "receiptValidation": receipt_validation,
        "session": session_public_view(session),
    }



# OPERADORES

def list_operators():
    resp = operator_table.scan()
    operators = [
        operator_public_view(item)
        for item in resp.get("Items", [])
    ]
    operators.sort(key=lambda x: (not x["active"], x["name"] or ""))
    return operators


def find_operator_by_email(email):
    email = clean_text(email, 160).lower()
    if not email:
        return None

    resp = operator_table.scan()
    for item in resp.get("Items", []):
        if clean_text(item.get("EMAIL"), 160).lower() == email:
            return item
    return None


def upsert_operator(data):
    requested_id = clean_text(
        data.get("operatorId") or data.get("id"),
        80,
    )
    name = clean_text(data.get("name") or data.get("nombre"), 120)
    email = clean_text(data.get("email"), 160).lower()

    if not name:
        raise ValueError("name es requerido")
    if not email:
        raise ValueError("email es requerido")

    current = None

    if requested_id:
        current = operator_table.get_item(
            Key={"OPERATOR_ID": requested_id}
        ).get("Item")

    if not current:
        current = find_operator_by_email(email)

    current = current or {}

    operator_id = (
        clean_text(current.get("OPERATOR_ID"), 80)
        or requested_id
        or ("op-" + secrets.token_hex(4))
    )

    current_session_code = clean_text(
        current.get("CURRENT_SESSION_CODE"),
        64,
    )

    active = parse_bool(
        data.get("active"),
        parse_bool(current.get("ACTIVE"), True),
    )
    available = parse_bool(
        data.get("available"),
        parse_bool(current.get("AVAILABLE"), True),
    )

    if not active or current_session_code:
        available = False

    item = {
        "OPERATOR_ID": operator_id,
        "NAME": name,
        "EMAIL": email,
        "ACTIVE": active,
        "AVAILABLE": available,
        "CURRENT_SESSION_CODE": current_session_code,
        "createdAt": current.get("createdAt") or now_iso(),
        "updatedAt": now_iso(),
    }

    operator_table.put_item(Item=item)
    return operator_public_view(item)


def set_operator_status(operator_id, data):
    operator_id = clean_text(operator_id, 80)
    operator = operator_table.get_item(
        Key={"OPERATOR_ID": operator_id}
    ).get("Item")

    if not operator:
        return None

    current_session_code = clean_text(
        operator.get("CURRENT_SESSION_CODE"),
        64,
    )

    if "active" in data:
        operator["ACTIVE"] = parse_bool(
            data.get("active"),
            parse_bool(operator.get("ACTIVE"), True),
        )

    if "available" in data:
        operator["AVAILABLE"] = parse_bool(
            data.get("available"),
            parse_bool(operator.get("AVAILABLE"), True),
        )

    if not parse_bool(operator.get("ACTIVE"), True):
        operator["AVAILABLE"] = False

    if current_session_code:
        operator["AVAILABLE"] = False

    operator["updatedAt"] = now_iso()
    operator_table.put_item(Item=operator)
    return operator_public_view(operator)

def waiting_sessions():
    resp = session_table.scan()
    results = []

    for raw in resp.get("Items", []):
        item = deep_decimal_to_native(raw)
        if item.get("STATUS") != "ACTIVE":
            continue
        if item.get("MODE") != "WAITING_AGENT":
            continue
        if int(item.get("expireAt") or 0) <= now_ts():
            continue

        results.append(session_public_view(item))

    results.sort(key=lambda x: x.get("createdAt") or "")
    return results


def take_session(code, data):
    session = get_session(code)
    if not session:
        return 404, {"success": False, "error": "session_not_found"}

    if session.get("MODE") != "WAITING_AGENT":
        return 409, {
            "success": False,
            "error": "session_not_waiting_agent",
            "mode": session.get("MODE"),
        }

    operator_id = clean_text(data.get("operatorId"), 80)
    if not operator_id:
        return 400, {"success": False, "error": "operatorId_required"}

    operator = operator_table.get_item(
        Key={"OPERATOR_ID": operator_id}
    ).get("Item")

    if not operator:
        return 404, {"success": False, "error": "operator_not_found"}

    operator = deep_decimal_to_native(operator)

    if not parse_bool(operator.get("ACTIVE"), False):
        return 409, {"success": False, "error": "operator_inactive"}

    if not parse_bool(operator.get("AVAILABLE"), False):
        return 409, {"success": False, "error": "operator_not_available"}

    current_code = clean_text(operator.get("CURRENT_SESSION_CODE"), 64)
    if current_code and current_code != code:
        return 409, {
            "success": False,
            "error": "operator_already_has_session",
            "currentSessionCode": current_code,
        }

    session["MODE"] = "AGENT"
    if session.get("FLOW_STEP") == "WAITING_AGENT":
        session["FLOW_STEP"] = "AGENT"
    session["assignedOperatorId"] = operator_id
    session["assignedOperatorName"] = operator.get("NAME", "")

    system_message = make_message(
        "system",
        f"{operator.get('NAME', 'Un asesor')} se ha unido a la conversacion.",
        metadata={
            "operatorId": operator_id,
            "event": "AGENT_JOINED",
        },
    )
    session["messages"].append(system_message)
    save_session(session)

    operator["AVAILABLE"] = False
    operator["CURRENT_SESSION_CODE"] = code
    operator["updatedAt"] = now_iso()
    operator_table.put_item(Item=operator)

    return 200, {
        "success": True,
        "session": session_public_view(session),
        "operator": operator_public_view(operator),
    }


def operator_send_message(code, data):
    session = get_session(code)
    if not session:
        return 404, {"success": False, "error": "session_not_found"}

    operator_id = clean_text(data.get("operatorId"), 80)
    text = clean_text(data.get("message") or data.get("text"), MAX_MESSAGE_LENGTH)

    if not operator_id:
        return 400, {"success": False, "error": "operatorId_required"}
    if not text:
        return 400, {"success": False, "error": "message_required"}

    if session.get("MODE") != "AGENT":
        return 409, {
            "success": False,
            "error": "session_not_in_agent_mode",
        }

    if session.get("assignedOperatorId") != operator_id:
        return 403, {
            "success": False,
            "error": "operator_not_assigned",
        }

    message = make_message(
        "assistant",
        text,
        metadata={
            "source": "operator",
            "operatorId": operator_id,
            "operatorName": session.get("assignedOperatorName", ""),
        },
    )

    session["messages"].append(message)
    save_session(session)

    return 200, {
        "success": True,
        "message": message,
        "session": session_public_view(session),
    }


def release_session_to_bot(code, data):
    session = get_session(code)
    if not session:
        return 404, {"success": False, "error": "session_not_found"}

    operator_id = clean_text(
        data.get("operatorId") or session.get("assignedOperatorId"),
        80,
    )

    if session.get("MODE") != "AGENT":
        return 409, {
            "success": False,
            "error": "session_not_in_agent_mode",
        }

    if session.get("assignedOperatorId") != operator_id:
        return 403, {
            "success": False,
            "error": "operator_not_assigned",
        }

    operator_name = session.get("assignedOperatorName") or "El asesor"

    session["MODE"] = "BOT"
    if session.get("FLOW_STEP") in {"AGENT", "WAITING_AGENT", "PAYMENT_REVIEW"}:
        session["FLOW_STEP"] = "PAYMENT_MATCHED" if receipt_is_matched(session) else "HOME"
    session["assignedOperatorId"] = ""
    session["assignedOperatorName"] = ""
    session["messages"].append(
        make_message(
            "system",
            f"{operator_name} finalizo la atencion. El asistente digital vuelve a estar disponible.",
            metadata={"event": "RETURNED_TO_BOT"},
        )
    )
    save_session(session)

    operator = operator_table.get_item(
        Key={"OPERATOR_ID": operator_id}
    ).get("Item")

    if operator:
        operator["AVAILABLE"] = True
        operator["CURRENT_SESSION_CODE"] = ""
        operator["updatedAt"] = now_iso()
        operator_table.put_item(Item=operator)

    return 200, {
        "success": True,
        "session": session_public_view(session),
        "operator": operator_public_view(operator) if operator else None,
    }


# TEST EVENTS DE CONSOLA

def handle_test_action(event):
    action = clean_text(event.get("action"), 80)

    if action == "create_test_session":
        required_fields = [
            "firstName",
            "balance",
            "currency",
            "dueDate",
            "reference",
            "paymentUrl",
        ]

        missing = [
            field
            for field in required_fields
            if event.get(field) is None or str(event.get(field)).strip() == ""
        ]

        if missing:
            return {
                "success": False,
                "error": "missing_test_fields",
                "missing": missing,
            }

        return create_session({
            "firstName": event.get("firstName"),
            "phone": event.get("phone") or event.get("telefono"),
            "balance": event.get("balance"),
            "currency": event.get("currency"),
            "dueDate": event.get("dueDate"),
            "reference": event.get("reference"),
            "paymentUrl": event.get("paymentUrl"),
            "externalId": event.get("externalId"),
        })

    if action == "get_session":
        session = get_session(event.get("CODE"))
        return {
            "success": bool(session),
            "session": session_public_view(session) if session else None,
        }

    if action == "add_operator":
        return {
            "success": True,
            "operator": upsert_operator({
                "operatorId": event.get("operatorId"),
                "name": event.get("name") or "Laura Martinez",
                "email": event.get("email") or "laura@example.com",
                "active": event.get("active", True),
                "available": event.get("available", True),
            }),
        }

    if action == "list_operators":
        return {
            "success": True,
            "operators": list_operators(),
        }

    if action == "waiting_sessions":
        return {
            "success": True,
            "sessions": waiting_sessions(),
        }

    return None


# ROUTING HTTP

def split_path(path):
    return [part for part in str(path or "/").split("/") if part]


def route_http(event):
    request_context = event.get("requestContext") or {}
    http = request_context.get("http") or {}

    method = (
        http.get("method")
        or event.get("httpMethod")
        or ""
    ).upper()

    path = (
        http.get("path")
        or event.get("rawPath")
        or event.get("path")
        or "/"
    )

    if method == "OPTIONS":
        return response(200, {})

    parts = split_path(path)
    body = get_body(event)

    # HEALTH
    if method == "GET" and path == "/health":
        return response(200, {
            "ok": True,
            "service": "dana-webchat-api",
            "version": "1.6.1",
            "sessionTable": SESSION_TABLE_NAME,
            "operatorTable": OPERATOR_TABLE_NAME,
            "bedrockModel": BEDROCK_MODEL_ID,
            "mediaBucket": MEDIA_BUCKET,
            "chimeControlRegion": AWS_REGION,
            "chimeMediaRegion": CHIME_MEDIA_REGION,
        })

    # --------------------------------------------------------
    # CREAR SESION - LLAMADO POR DANA
    # POST /sessions
    # --------------------------------------------------------
    if method == "POST" and parts == ["sessions"]:
        if not require_dana_key(event):
            return response(401, {
                "success": False,
                "error": "unauthorized",
            })

        try:
            return response(201, create_session(body))
        except ValueError as exc:
            return response(400, {
                "success": False,
                "error": str(exc),
            })
        except Exception as exc:
            logger.exception("Error creando sesion")
            return response(500, {
                "success": False,
                "error": "create_session_failed",
                "detail": str(exc),
            })

    # --------------------------------------------------------
    # SESION CLIENTE
    # GET /sessions/{code}
    # --------------------------------------------------------
    if (
        method == "GET"
        and len(parts) == 2
        and parts[0] == "sessions"
    ):
        session = get_session(parts[1])
        if not session:
            return response(404, {
                "success": False,
                "error": "session_not_found",
            })

        return response(200, {
            "success": True,
            "session": session_public_view(session),
        })

    # --------------------------------------------------------
    # MENSAJE CLIENTE
    # POST /sessions/{code}/messages
    # --------------------------------------------------------
    if (
        method == "POST"
        and len(parts) == 3
        and parts[0] == "sessions"
        and parts[2] == "messages"
    ):
        status, result = send_customer_message(parts[1], body)
        return response(status, result)

    # --------------------------------------------------------
    # ACCIONES CLIENTE
    # POST /sessions/{code}/actions
    # --------------------------------------------------------
    if (
        method == "POST"
        and len(parts) == 3
        and parts[0] == "sessions"
        and parts[2] == "actions"
    ):
        status, result = process_customer_action(parts[1], body)
        return response(status, result)

    # LLAMADAS WEBRTC - AMAZON CHIME SDK
    if (
        method == "POST"
        and len(parts) == 4
        and parts[0] == "sessions"
        and parts[2] == "call"
        and parts[3] in {"start", "accept", "join", "reject", "end"}
    ):
        call_action = parts[3]
        sender = clean_text(body.get("sender") or "user", 20).lower()

        if sender == "operator":
            if not require_operator_key(event):
                return response(401, {
                    "success": False,
                    "error": "unauthorized",
                })

        try:
            if call_action == "start":
                status, result = start_call(parts[1], body)
            elif call_action == "accept":
                status, result = accept_call(parts[1], body)
            elif call_action == "join":
                status, result = join_call(parts[1], body)
            elif call_action == "reject":
                status, result = reject_call(parts[1], body)
            else:
                status, result = end_call(parts[1], body)
        except Exception as exc:
            logger.exception(
                "Fallo llamada Chime action=%s session=%s",
                call_action,
                parts[1],
            )
            return response(500, {
                "success": False,
                "error": "call_operation_failed",
                "detail": str(exc),
            })

        return response(status, result)

    # MEDIA
    if (
        method == "POST"
        and len(parts) == 4
        and parts[0] == "sessions"
        and parts[2] == "media"
        and parts[3] == "presign"
    ):
        if clean_text(body.get("sender"), 20).lower() == "operator":
            if not require_operator_key(event):
                return response(401, {
                    "success": False,
                    "error": "unauthorized",
                })

        status, result = create_media_upload(parts[1], body)
        return response(status, result)

    if (
        method == "POST"
        and len(parts) == 4
        and parts[0] == "sessions"
        and parts[2] == "media"
        and parts[3] == "confirm"
    ):
        if clean_text(body.get("sender"), 20).lower() == "operator":
            if not require_operator_key(event):
                return response(401, {
                    "success": False,
                    "error": "unauthorized",
                })

        status, result = confirm_media_upload(parts[1], body)
        return response(status, result)

    # OPERADORES
    if parts and parts[0] == "operators":
        if not require_operator_key(event):
            return response(401, {
                "success": False,
                "error": "unauthorized",
            })

        # GET /operators
        if method == "GET" and parts == ["operators"]:
            return response(200, {
                "success": True,
                "operators": list_operators(),
            })

        # POST /operators
        if method == "POST" and parts == ["operators"]:
            try:
                operator = upsert_operator(body)
                return response(200, {
                    "success": True,
                    "operator": operator,
                })
            except ValueError as exc:
                return response(400, {
                    "success": False,
                    "error": str(exc),
                })

        # POST /operators/{id}/status
        if (
            method == "POST"
            and len(parts) == 3
            and parts[2] == "status"
        ):
            operator = set_operator_status(parts[1], body)
            if not operator:
                return response(404, {
                    "success": False,
                    "error": "operator_not_found",
                })

            return response(200, {
                "success": True,
                "operator": operator,
            })

    # --------------------------------------------------------
    # COLA DE OPERADORES
    # GET /operator-queue
    # --------------------------------------------------------
    if method == "GET" and parts == ["operator-queue"]:
        if not require_operator_key(event):
            return response(401, {
                "success": False,
                "error": "unauthorized",
            })

        return response(200, {
            "success": True,
            "sessions": waiting_sessions(),
        })

    # --------------------------------------------------------
    # TOMAR CHAT
    # POST /sessions/{code}/take
    # --------------------------------------------------------
    if (
        method == "POST"
        and len(parts) == 3
        and parts[0] == "sessions"
        and parts[2] == "take"
    ):
        if not require_operator_key(event):
            return response(401, {
                "success": False,
                "error": "unauthorized",
            })

        status, result = take_session(parts[1], body)
        return response(status, result)

    # --------------------------------------------------------
    # MENSAJE DEL OPERADOR
    # POST /sessions/{code}/operator-message
    # --------------------------------------------------------
    if (
        method == "POST"
        and len(parts) == 3
        and parts[0] == "sessions"
        and parts[2] == "operator-message"
    ):
        if not require_operator_key(event):
            return response(401, {
                "success": False,
                "error": "unauthorized",
            })

        status, result = operator_send_message(parts[1], body)
        return response(status, result)

    # --------------------------------------------------------
    # DEVOLVER CHAT AL BOT
    # POST /sessions/{code}/return-to-bot
    # --------------------------------------------------------
    if (
        method == "POST"
        and len(parts) == 3
        and parts[0] == "sessions"
        and parts[2] == "return-to-bot"
    ):
        if not require_operator_key(event):
            return response(401, {
                "success": False,
                "error": "unauthorized",
            })

        status, result = release_session_to_bot(parts[1], body)
        return response(status, result)

    return response(404, {
        "success": False,
        "error": "not_found",
        "method": method,
        "path": path,
    })


# LAMBDA HANDLER

def lambda_handler(event, context):
    logger.info(
        "EVENT method/path/action: %s",
        json.dumps({
            "action": event.get("action") if isinstance(event, dict) else None,
            "rawPath": event.get("rawPath") if isinstance(event, dict) else None,
            "httpMethod": event.get("httpMethod") if isinstance(event, dict) else None,
        }),
    )

    if isinstance(event, dict) and event.get("action"):
        result = handle_test_action(event)
        if result is not None:
            return result

    return route_http(event)
