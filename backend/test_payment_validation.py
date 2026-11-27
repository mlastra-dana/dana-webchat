"""Contract tests for the local Lambda v1.6.1, without AWS calls."""

import ast
import copy
import re
import unittest
import uuid
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace


SOURCE = Path(__file__).with_name('lambda_function.py')
TREE = ast.parse(SOURCE.read_text(encoding='utf-8'))
FUNCTIONS = {node.name: node for node in TREE.body if isinstance(node, ast.FunctionDef)}


def load_functions(*names, **dependencies):
    nodes = [FUNCTIONS[name] for name in names]
    context = {'Decimal': Decimal, 're': re, 'uuid': uuid, **dependencies}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(SOURCE), 'exec'), context)
    return context


COMMON = ('clean_text', 'deep_decimal_to_native', 'deep_native_to_decimal',
          'normalize_amount', 'normalize_receipt_currency', 'validate_payment_receipt')


def payment_context(**dependencies):
    return load_functions(*COMMON, RECEIPT_CONFIDENCE_THRESHOLD=0.85,
                          now_iso=lambda: '2026-11-26T00:00:00Z', **dependencies)


class PaymentValidationTests(unittest.TestCase):
    def setUp(self):
        self.context = payment_context()
        self.session = {'collection': {
            'balance': Decimal('64024.00'), 'currency': 'VES',
            'reference': 'DEUDA-123', 'dueDate': '2026-12-01',
        }, 'customer': {'firstName': 'Cliente'}}

    def result(self, *, amount=Decimal('64024.00'), currency='VES',
               is_receipt=True, confidence=0.95, **details):
        analysis = {'isPaymentReceipt': is_receipt, 'confidence': confidence,
                    'extracted': {'amount': amount, 'currency': currency, **details}}
        return self.context['validate_payment_receipt'](self.session, analysis)

    def test_matching_amount_and_currency(self):
        result = self.result()
        self.assertEqual(result['result'], 'MATCH')
        self.assertEqual(result['checks']['amountMatches'], True)
        self.assertEqual(result['checks']['currencyMatches'], True)

    def test_localized_amount_and_bolivar_alias_match(self):
        result = self.result(amount='64.024,00', currency='Bs.')
        self.assertEqual(result['result'], 'MATCH')
        self.assertEqual(result['extracted']['amount'], 64024)
        self.assertEqual(result['extracted']['currency'], 'VES')

    def test_wrong_amount_is_mismatch(self):
        self.assertEqual(self.result(amount=Decimal('50000.00'))['result'], 'MISMATCH')

    def test_wrong_currency_is_mismatch(self):
        self.assertEqual(self.result(currency='USD')['result'], 'MISMATCH')

    def test_non_receipt_is_invalid(self):
        self.assertEqual(self.result(is_receipt=False)['result'], 'INVALID_RECEIPT')

    def test_unreadable_amount_requires_review(self):
        self.assertEqual(self.result(amount='no legible')['result'], 'REVIEW')

    def test_insufficient_amount_information_requires_review(self):
        self.assertEqual(self.result(amount=None)['result'], 'REVIEW')

    def test_low_confidence_requires_review(self):
        self.assertEqual(self.result(confidence=0.4)['result'], 'REVIEW')

    def test_threshold_is_inclusive(self):
        self.assertEqual(self.result(confidence=0.85)['result'], 'MATCH')

    def test_different_bank_does_not_affect_match(self):
        self.assertEqual(self.result(bank='Otro banco')['result'], 'MATCH')

    def test_different_banking_reference_does_not_affect_match(self):
        self.assertEqual(self.result(reference='REF-DISTINTA')['result'], 'MATCH')

    def test_different_recipient_does_not_affect_match(self):
        self.assertEqual(self.result(recipient='Otra persona')['result'], 'MATCH')

    def test_different_phone_and_account_do_not_affect_match(self):
        self.assertEqual(self.result(phone='0000000', account='OTRA-CUENTA')['result'], 'MATCH')


class StrictDynamoTable:
    """DynamoDB's relevant constraint: nested floats cannot be serialized."""

    def __init__(self, item=None):
        self.item = copy.deepcopy(item)
        self.writes = []

    def get_item(self, Key):
        return {'Item': copy.deepcopy(self.item)} if self.item else {}

    def put_item(self, Item):
        def verify(value):
            if isinstance(value, float):
                raise TypeError('Float types are not supported. Use Decimal types instead.')
            if isinstance(value, dict):
                for child in value.values():
                    verify(child)
            elif isinstance(value, list):
                for child in value:
                    verify(child)
        verify(Item)
        self.item = copy.deepcopy(Item)
        self.writes.append(copy.deepcopy(Item))


def message(role, text, message_type='text', metadata=None):
    return {'role': role, 'text': text, 'type': message_type,
            'metadata': metadata or {}}


class FakeS3:
    def __init__(self):
        self.head = {'ContentLength': 100, 'ContentType': 'image/png'}
        self.presigns = []
        self.deleted = []

    def generate_presigned_url(self, operation, **kwargs):
        self.presigns.append((operation, kwargs))
        return f'https://example.invalid/{operation}'

    def head_object(self, **kwargs):
        return self.head

    def delete_object(self, **kwargs):
        self.deleted.append(kwargs)


class MediaFlowTests(unittest.TestCase):
    def setUp(self):
        self.session = {
            'CODE': 'test-code', 'MODE': 'BOT', 'FLOW_STEP': 'WAITING_PAYMENT_PROOF',
            'collection': {'balance': Decimal('64024.00'), 'currency': 'VES', 'status': 'PENDING'},
            'messages': [],
        }
        self.table = StrictDynamoTable()
        self.s3 = FakeS3()
        self.analysis = {'isPaymentReceipt': True, 'confidence': 0.94,
                         'extracted': {'amount': '64.024,00', 'currency': 'Bs.'}}
        names = (*COMMON, 'save_session', 'safe_filename', 'media_key_for',
                 'validate_media_request', 'authorize_media_sender',
                 'create_media_upload', 'confirm_media_upload')
        self.context = load_functions(
            *names, RECEIPT_CONFIDENCE_THRESHOLD=0.85,
            get_session=lambda _code: self.session, session_table=self.table,
            trim_messages=lambda items: items, now_iso=lambda: '2026-11-26T00:00:00Z',
            MEDIA_PREFIX='receipts', MEDIA_BUCKET='test-bucket', MEDIA_MAX_BYTES=1000,
            ALLOWED_MEDIA_TYPES={'image/png': 'image', 'application/pdf': 'document',
                                 'audio/webm': 'audio'}, s3=self.s3,
            make_message=message, session_public_view=lambda session: copy.deepcopy(session),
            public_message_view=lambda item: copy.deepcopy(item),
            analyze_payment_receipt=lambda *_args: self.analysis,
            logger=SimpleNamespace(exception=lambda *_args: None),
        )
        self.data = {'fileName': 'receipt.png', 'contentType': 'image/png',
                     'size': 100, 'sender': 'user'}

    def confirm(self):
        return self.context['confirm_media_upload']('test-code',
            {**self.data, 'mediaKey': 'receipts/test-code/receipt.png'})

    def test_presign_returns_s3_upload_url(self):
        status, body = self.context['create_media_upload']('test-code', self.data)
        self.assertEqual(status, 200)
        self.assertEqual(body['uploadHeaders']['Content-Type'], 'image/png')
        self.assertTrue(body['mediaKey'].startswith('receipts/test-code/'))
        self.assertEqual(self.s3.presigns[0][0], 'put_object')

    def test_confirm_match_saves_float_confidence_as_decimal(self):
        status, body = self.confirm()
        self.assertEqual(status, 200)
        self.assertEqual(body['receiptValidation']['result'], 'MATCH')
        self.assertEqual(self.session['FLOW_STEP'], 'PAYMENT_MATCHED')
        self.assertEqual(self.table.item['paymentValidation']['confidence'], Decimal('0.94'))
        self.assertIsInstance(self.table.item['paymentValidation']['confidence'], Decimal)
        self.assertEqual(self.session['paymentValidation']['confidence'], 0.94)
        self.assertEqual(self.session['collection']['status'], 'PAID')
        self.assertEqual(self.session['messages'][-1]['text'], 'Pago acreditado. Gracias.')
        self.assertEqual(self.session['messages'][0]['type'], 'image')

    def test_confirm_mismatch_allows_another_receipt(self):
        self.analysis['extracted']['amount'] = 50000
        status, body = self.confirm()
        self.assertEqual(status, 200)
        self.assertEqual(body['receiptValidation']['result'], 'MISMATCH')
        self.assertEqual(self.session['FLOW_STEP'], 'PAYMENT_MISMATCH')
        self.assertEqual(self.session['MODE'], 'BOT')

    def test_confirm_review_enters_operator_queue(self):
        self.analysis['extracted']['amount'] = None
        status, body = self.confirm()
        self.assertEqual(status, 200)
        self.assertEqual(body['session']['paymentValidation']['result'], 'REVIEW')
        self.assertEqual(self.session['MODE'], 'WAITING_AGENT')
        self.assertEqual(self.session['FLOW_STEP'], 'PAYMENT_REVIEW')

    def test_confirm_invalid_receipt_allows_retry_without_queue(self):
        self.analysis['isPaymentReceipt'] = False
        status, body = self.confirm()
        self.assertEqual(status, 200)
        self.assertEqual(body['receiptValidation']['result'], 'INVALID_RECEIPT')
        self.assertEqual(self.session['MODE'], 'BOT')
        self.assertEqual(self.session['FLOW_STEP'], 'PAYMENT_MISMATCH')

    def test_confirm_analysis_error_goes_to_review(self):
        self.context['analyze_payment_receipt'] = lambda *_args: (_ for _ in ()).throw(RuntimeError('AI unavailable'))
        status, body = self.confirm()
        self.assertEqual(status, 200)
        self.assertIsNone(body['receiptValidation'])
        self.assertEqual(body['session']['paymentValidation']['result'], 'REVIEW')
        self.assertEqual(self.session['MODE'], 'WAITING_AGENT')

    def test_confirm_rejects_oversized_uploaded_object(self):
        self.s3.head['ContentLength'] = 1001
        status, body = self.confirm()
        self.assertEqual(status, 400)
        self.assertEqual(body['error'], 'invalid_uploaded_size')
        self.assertEqual(len(self.s3.deleted), 1)

    def test_confirm_rejects_content_type_mismatch(self):
        self.s3.head['ContentType'] = 'image/jpeg'
        status, body = self.confirm()
        self.assertEqual(status, 400)
        self.assertEqual(body['error'], 'content_type_mismatch')

    def test_documents_and_voice_notes_are_sent_without_receipt_validation(self):
        for file_name, content_type, media_type in (
            ('documento.pdf', 'application/pdf', 'document'),
            ('nota.webm', 'audio/webm', 'audio'),
        ):
            with self.subTest(content_type=content_type):
                self.data.update(fileName=file_name, contentType=content_type)
                self.s3.head['ContentType'] = content_type
                status, body = self.context['create_media_upload']('test-code', self.data)
                self.assertEqual(status, 200)
                self.assertEqual(body['mediaType'], media_type)
                status, body = self.context['confirm_media_upload']('test-code',
                    {**self.data, 'mediaKey': body['mediaKey']})
                self.assertEqual(status, 200)
                self.assertEqual(body['message']['type'], media_type)
                self.assertIsNone(body['receiptValidation'])


class MatchedReceiptLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.session = {
            'CODE': 'test-code', 'MODE': 'BOT', 'FLOW_STEP': 'HOME',
            'collection': {'status': 'PAID', 'balance': Decimal('64024.00')},
            'paymentValidation': {'result': 'MATCH'}, 'messages': [],
        }
        self.context = load_functions(
            'clean_text', 'receipt_is_matched', 'build_ui_state',
            'process_customer_action',
            get_session=lambda _code: self.session,
            WEBCHAT_BASE_URL='https://example.invalid',
        )

    def test_reopening_matched_session_only_offers_an_advisor(self):
        ui = self.context['build_ui_state'](self.session)
        self.assertTrue(ui['showSummaryCard'])
        self.assertEqual(ui['availableActions'], ['TALK_TO_AGENT'])
        self.assertFalse(ui['allowReceiptUpload'])
        self.assertFalse(ui['showPaymentButton'])

    def test_matched_receipt_cannot_restart_payment(self):
        for action in ('PAY_NOW', 'BACK_HOME', 'VIEW_DETAIL'):
            status, body = self.context['process_customer_action'](
                'test-code', {'action': action})
            self.assertEqual(status, 409)
            self.assertEqual(body['error'], 'payment_already_confirmed')
            self.assertEqual(self.session['FLOW_STEP'], 'HOME')


class FakeChime:
    def __init__(self):
        self.meeting = {'MeetingId': 'meeting-1', 'ExternalMeetingId': 'linkchat-test-code',
                        'MediaRegion': 'us-east-1'}
        self.deleted = []
        self.attendees = 0

    def create_meeting(self, **kwargs):
        return {'Meeting': self.meeting}

    def get_meeting(self, **kwargs):
        return {'Meeting': self.meeting}

    def create_attendee(self, **kwargs):
        self.attendees += 1
        return {'Attendee': {'JoinToken': f'token-{self.attendees}'}}

    def delete_meeting(self, **kwargs):
        self.deleted.append(kwargs['MeetingId'])


class OperatorAndChimeTests(unittest.TestCase):
    def setUp(self):
        self.session = {
            'CODE': 'test-code', 'MODE': 'WAITING_AGENT', 'FLOW_STEP': 'PAYMENT_REVIEW',
            'STATUS': 'ACTIVE', 'collection': {}, 'messages': [], 'customer': {'firstName': 'Ana'},
            'paymentValidation': {'result': 'REVIEW', 'confidence': 0.4},
        }
        self.operator_table = StrictDynamoTable({
            'OPERATOR_ID': 'op-1', 'NAME': 'Asesor', 'EMAIL': 'asesor@example.invalid',
            'ACTIVE': True, 'AVAILABLE': True, 'CURRENT_SESSION_CODE': '',
        })
        self.session_table = StrictDynamoTable()
        self.chime = FakeChime()
        names = ('clean_text', 'parse_bool', 'deep_decimal_to_native',
                 'deep_native_to_decimal', 'call_public_view', 'chime_join_payload',
                 'get_active_meeting', 'validate_call_actor', 'create_chime_attendee',
                 'start_call', 'accept_call', 'join_call', 'reject_call', 'end_call', 'save_session',
                 'receipt_is_matched', 'operator_public_view', 'take_session', 'operator_send_message',
                 'release_session_to_bot')
        self.context = load_functions(
            *names, get_session=lambda _code: self.session,
            operator_table=self.operator_table, session_table=self.session_table,
            chime_meetings=self.chime, CHIME_MEDIA_REGION='us-east-1',
            now_iso=lambda: '2026-11-26T00:00:00Z', trim_messages=lambda items: items,
            make_message=message, session_public_view=lambda session: copy.deepcopy(session),
            MAX_MESSAGE_LENGTH=1000, logger=SimpleNamespace(exception=lambda *_args: None),
        )

    def take(self):
        return self.context['take_session']('test-code', {'operatorId': 'op-1'})

    def test_operator_take_reply_and_return_to_bot(self):
        status, body = self.take()
        self.assertEqual(status, 200)
        self.assertEqual(body['session']['MODE'], 'AGENT')
        self.assertEqual(self.operator_table.item['CURRENT_SESSION_CODE'], 'test-code')
        status, body = self.context['operator_send_message']('test-code',
            {'operatorId': 'op-1', 'message': 'Hola'})
        self.assertEqual(status, 200)
        self.assertEqual(body['message']['text'], 'Hola')
        status, body = self.context['release_session_to_bot']('test-code',
            {'operatorId': 'op-1'})
        self.assertEqual(status, 200)
        self.assertEqual(body['session']['MODE'], 'BOT')
        self.assertEqual(self.operator_table.item['CURRENT_SESSION_CODE'], '')
        self.assertEqual(self.operator_table.item['AVAILABLE'], True)

    def test_return_to_bot_preserves_matched_receipt(self):
        self.session['paymentValidation'] = {'result': 'MATCH', 'confidence': Decimal('0.94')}
        self.session['collection']['status'] = 'PAID'
        self.assertEqual(self.take()[0], 200)
        status, body = self.context['release_session_to_bot']('test-code',
            {'operatorId': 'op-1'})
        self.assertEqual(status, 200)
        self.assertEqual(body['session']['FLOW_STEP'], 'PAYMENT_MATCHED')
        self.assertEqual(body['session']['collection']['status'], 'PAID')

    def test_chime_start_accept_join_end(self):
        self.assertEqual(self.take()[0], 200)
        status, denied = self.context['start_call']('test-code', {'sender': 'user'})
        self.assertEqual((status, denied['error']), (403, 'operator_required_for_call'))
        status, started = self.context['start_call']('test-code',
            {'sender': 'operator', 'operatorId': 'op-1'})
        self.assertEqual(status, 200)
        self.assertEqual(started['call']['status'], 'RINGING')
        self.assertTrue(started['joinInfo']['attendee']['JoinToken'])
        status, denied = self.context['join_call']('test-code', {'sender': 'user'})
        self.assertEqual((status, denied['error']), (409, 'call_not_accepted'))
        status, denied = self.context['accept_call']('test-code',
            {'sender': 'operator', 'operatorId': 'op-1'})
        self.assertEqual((status, denied['error']), (403, 'customer_required_to_accept_call'))
        status, accepted = self.context['accept_call']('test-code', {'sender': 'user'})
        self.assertEqual(status, 200)
        self.assertEqual(accepted['call']['status'], 'IN_CALL')
        self.assertTrue(accepted['joinInfo']['attendee']['JoinToken'])
        status, joined = self.context['join_call']('test-code',
            {'sender': 'operator', 'operatorId': 'op-1'})
        self.assertEqual(status, 200)
        self.assertEqual(joined['call']['status'], 'IN_CALL')
        self.assertEqual(self.chime.attendees, 3)
        status, ended = self.context['end_call']('test-code', {'sender': 'user'})
        self.assertEqual(status, 200)
        self.assertEqual(ended['call']['status'], 'ENDED')
        self.assertEqual(self.chime.deleted, ['meeting-1'])
        self.assertEqual(self.session_table.item['paymentValidation']['confidence'], Decimal('0.4'))

    def test_customer_can_reject_operator_call(self):
        self.assertEqual(self.take()[0], 200)
        self.assertEqual(self.context['start_call']('test-code',
            {'sender': 'operator', 'operatorId': 'op-1'})[0], 200)
        status, denied = self.context['reject_call']('test-code',
            {'sender': 'operator', 'operatorId': 'op-1'})
        self.assertEqual((status, denied['error']), (403, 'customer_required_to_reject_call'))
        status, rejected = self.context['reject_call']('test-code', {'sender': 'user'})
        self.assertEqual(status, 200)
        self.assertEqual(rejected['call']['status'], 'REJECTED')


if __name__ == '__main__':
    unittest.main()
