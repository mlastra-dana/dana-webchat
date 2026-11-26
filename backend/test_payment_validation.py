"""Validate payment decision rules without AWS credentials."""

import ast
import math
import re
import unittest
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace


SOURCE = Path(__file__).with_name("lambda_function.py")
NEEDED = {"clean_text", "to_decimal_safe", "deep_decimal_to_native", "text_matches", "identifier_matches", "validate_payment_receipt", "confirm_media_upload"}
tree = ast.parse(SOURCE.read_text())
functions = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in NEEDED]
namespace = {
    "Decimal": Decimal,
    "math": math,
    "re": re,
    "now_iso": lambda: datetime.now(timezone.utc).isoformat(),
    "RECEIPT_CONFIDENCE_THRESHOLD": 0.8,
}
exec(compile(ast.Module(body=functions, type_ignores=[]), str(SOURCE), "exec"), namespace)


class PaymentValidationTests(unittest.TestCase):
    def setUp(self):
        self.session = {
            "collection": {"balance": Decimal("200.00"), "currency": "USD"},
            "paymentVerification": {"operationNumber": "OP-12345"},
        }

    def result(self, **extracted):
        analysis = {
            "isPaymentReceipt": True,
            "confidence": 0.95,
            "extracted": {"amount": 200, "currency": "USD", "operationNumber": "OP-12345", **extracted},
        }
        return namespace["validate_payment_receipt"](self.session, analysis)

    def test_matching_amount_and_currency(self):
        self.assertEqual(self.result()["result"], "MATCH")

    def test_wrong_amount_is_mismatch(self):
        self.assertEqual(self.result(amount=150)["result"], "MISMATCH")

    def test_wrong_currency_is_mismatch(self):
        result = self.result(currency="VES")
        self.assertEqual(result["result"], "MISMATCH")
        self.assertIn("currency_mismatch", result["mismatches"])

    def test_missing_currency_requires_review(self):
        self.assertEqual(self.result(currency=None)["result"], "REVIEW")

    def test_receipt_without_recipient_name_can_match(self):
        self.assertEqual(self.result(recipient=None)["result"], "MATCH")

    def test_missing_dana_transaction_identifier_requires_review(self):
        self.session["paymentVerification"] = {}
        self.assertEqual(self.result()["result"], "REVIEW")

    def test_missing_operation_number_requires_review(self):
        self.assertEqual(self.result(operationNumber=None)["result"], "REVIEW")

    def test_wrong_operation_number_is_mismatch(self):
        self.assertEqual(self.result(operationNumber="OP-54321")["result"], "MISMATCH")

    def test_explicit_dana_reference_can_match(self):
        self.session["paymentVerification"] = {"reference": "REF-987"}
        self.assertEqual(self.result(operationNumber=None, reference="REF-987")["result"], "MATCH")

    def test_dana_recipient_phone_can_match_without_operation_number_or_name(self):
        self.session["paymentVerification"] = {"phone": "0412-1234567", "bank": "Banco A"}
        self.assertEqual(self.result(operationNumber=None, recipient=None, phone="04121234567", bank="Banco A")["result"], "MATCH")

    def test_missing_dana_recipient_phone_requires_review(self):
        self.session["paymentVerification"] = {"phone": "0412-1234567"}
        self.assertEqual(self.result(operationNumber=None, phone=None)["result"], "REVIEW")

    def test_unreadable_amount_cannot_match(self):
        self.assertEqual(self.result(amount="no legible")["result"], "MISMATCH")

    def test_low_or_invalid_confidence_requires_review(self):
        for confidence in (0.2, float("nan"), float("inf")):
            analysis = {"isPaymentReceipt": True, "confidence": confidence, "extracted": {"amount": 200, "currency": "USD", "operationNumber": "OP-12345"}}
            with self.subTest(confidence=confidence):
                self.assertEqual(namespace["validate_payment_receipt"](self.session, analysis)["result"], "REVIEW")


class ReceiptFlowTests(unittest.TestCase):
    def setUp(self):
        self.session = {
            "CODE": "test-code",
            "MODE": "BOT",
            "FLOW_STEP": "WAITING_PAYMENT_PROOF",
            "collection": {"status": "PENDING"},
            "messages": [],
        }
        self.saved = []
        self.head_calls = 0

        def head_object(**_kwargs):
            self.head_calls += 1
            return {"ContentLength": 100, "ContentType": "image/png"}

        self.context = dict(namespace)
        self.context.update({
            "get_session": lambda _code: self.session,
            "validate_media_request": lambda _data: ("receipt.png", "image/png", 100, "image"),
            "authorize_media_sender": lambda _session, _data: ("user", ""),
            "s3": SimpleNamespace(head_object=head_object, delete_object=lambda **_kwargs: None),
            "MEDIA_BUCKET": "test-bucket",
            "MEDIA_PREFIX": "receipts",
            "MEDIA_MAX_BYTES": 1000,
            "RECEIPT_MAX_BYTES": 1000,
            "make_message": lambda role, text, message_type="text", metadata=None: {"role": role, "text": text, "type": message_type, "metadata": metadata or {}},
            "save_session": lambda session: self.saved.append(session["FLOW_STEP"]),
            "session_public_view": lambda session: dict(session),
            "public_message_view": lambda message: dict(message),
            "logger": SimpleNamespace(exception=lambda *_args: None),
            "analyze_payment_receipt": lambda *_args: {},
            "validate_payment_receipt": lambda *_args: {"result": "MATCH", "extracted": {}, "expected": {}},
        })
        confirm_node = next(node for node in functions if node.name == "confirm_media_upload")
        exec(compile(ast.Module(body=[confirm_node], type_ignores=[]), str(SOURCE), "exec"), self.context)

    def confirm(self):
        return self.context["confirm_media_upload"]("test-code", {"mediaKey": "receipts/test-code/receipt.png"})

    def test_match_marks_receipt_as_matched(self):
        status, _ = self.confirm()
        self.assertEqual(status, 200)
        self.assertEqual(self.session["FLOW_STEP"], "PAYMENT_MATCHED")
        self.assertEqual(self.session["collection"]["status"], "RECEIPT_MATCHED")

    def test_mismatch_allows_another_receipt(self):
        self.context["validate_payment_receipt"] = lambda *_args: {"result": "MISMATCH", "extracted": {}, "expected": {}}
        self.confirm()
        self.assertEqual(self.session["FLOW_STEP"], "PAYMENT_MISMATCH")
        self.assertEqual(self.session["MODE"], "BOT")

    def test_review_enters_operator_queue(self):
        self.context["validate_payment_receipt"] = lambda *_args: {"result": "REVIEW", "extracted": {}, "expected": {}}
        self.confirm()
        self.assertEqual(self.session["FLOW_STEP"], "PAYMENT_REVIEW")
        self.assertEqual(self.session["MODE"], "WAITING_AGENT")

    def test_repeated_confirmation_does_not_analyze_again(self):
        self.confirm()
        status, _ = self.confirm()
        self.assertEqual(status, 200)
        self.assertEqual(self.head_calls, 1)
        self.assertEqual(len([message for message in self.session["messages"] if message["type"] == "image"]), 1)

    def test_wrong_uploaded_size_is_rejected(self):
        self.context["validate_media_request"] = lambda _data: ("receipt.png", "image/png", 99, "image")
        status, body = self.confirm()
        self.assertEqual(status, 400)
        self.assertEqual(body["error"], "invalid_uploaded_size")


if __name__ == "__main__":
    unittest.main()
