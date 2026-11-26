# Lambda de DANA LinkChat

`lambda_function.py` parte del archivo `dana-webchat-api-v1.4.py` entregado por la usuaria. Conserva las rutas existentes y completa el circuito de comprobantes. El código desplegado actualmente en `dana-webchat-api` es una versión anterior sin rutas de media.

## Recorrido

1. `POST /sessions/{code}/actions` con `PAY_NOW` cambia `FLOW_STEP` a `WAITING_PAYMENT_PROOF`.
2. `POST /sessions/{code}/media/presign` recibe `fileName`, `contentType`, `size` y `sender: "user"`; devuelve `uploadUrl`, `mediaKey` y `uploadHeaders`.
3. El navegador hace `PUT` del archivo a S3 con exactamente los headers firmados.
4. `POST /sessions/{code}/media/confirm` recibe los mismos datos y `mediaKey`. Lambda comprueba el objeto y llama a Bedrock Converse para imágenes JPG, PNG o WebP.
5. Las reglas deciden `MATCH` → `PAYMENT_MATCHED`, `MISMATCH` → `PAYMENT_MISMATCH` con nuevo intento, o `REVIEW` → `PAYMENT_REVIEW` + `WAITING_AGENT`. `RECEIPT_MATCHED` significa que los datos visibles coinciden; no confirma liquidación bancaria.

Los comprobantes se limitan a 3.750.000 bytes para respetar el límite de imágenes de Converse. La confirmación del mismo `mediaKey` es idempotente. Una moneda distinta es `MISMATCH`; datos incompletos o baja confianza producen `REVIEW`.

## Datos de verificación enviados por DANA

Al crear una sesión, DANA envía el saldo y la moneda habituales y puede añadir `paymentVerification`. Para que un comprobante llegue a `MATCH` automáticamente, DANA debe aportar al menos un identificador comprobable: número de operación, referencia de pago, teléfono, documento o número de cuenta del destinatario. El nombre del destinatario no es obligatorio.

```json
{
  "firstName": "Ana",
  "balance": 200,
  "currency": "USD",
  "paymentVerification": {
    "phone": "0412-1234567",
    "bank": "Banco de ejemplo"
  }
}
```

Campos opcionales de `paymentVerification`: `operationNumber`, `reference`, `bank`, `phone`, `accountNumber`, `recipientId`, `recipient`. Lambda compara todos los que DANA envíe con lo extraído del comprobante. `reference` debe ser una **referencia de pago**, no la referencia de cobranza general en `collection.reference`; esta última no se compara automáticamente. Si falta un identificador verificable o el comprobante no lo muestra, el caso va a `REVIEW`. Una diferencia explícita produce `MISMATCH` y permite otro comprobante. `MATCH` solo indica coincidencia documental; la liquidación debe confirmarse con el proveedor de pagos.

## Preparación de AWS

La función existente usa `python3.15`, `lambda_function.lambda_handler` y el modelo `amazon.nova-lite-v1:0`. Antes del despliegue le faltan las variables `MEDIA_*`, un bucket S3 y permisos para objetos. También tiene un timeout de 3 segundos, insuficiente para validar imágenes con Bedrock.

`deploy.sh` prepara un bucket privado `dana-webchat-receipts-905418296062-us-east-1`, cifrado SSE-S3, CORS restringido al origen Amplify actual y a Vite local, y una política IAM limitada a `receipts/*`. Después añade las variables de media, ajusta Lambda a 60 segundos y 256 MB y publica el código. Conserva las variables existentes. **No ejecutar sin aprobar el despliegue en AWS.**

El script no configura destinatarios globales. La verificación usa los valores que DANA proporciona en cada sesión.

El bucket CORS incluido usa el origen Amplify detectado el 26 de noviembre de 2026. Si cambia el dominio de producción, actualice `aws/media-cors.json` antes de desplegar. El script no configura una política de retención: defínala según los requisitos legales y operativos antes de usar comprobantes reales.

## Comprobaciones locales

```bash
python3 -m unittest discover -s backend -p 'test_*.py' -v
python3 -m py_compile backend/lambda_function.py
bash -n backend/deploy.sh
```
