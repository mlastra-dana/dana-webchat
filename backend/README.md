# Lambda de DANA LinkChat

`lambda_function.py` contiene la v1.6 entregada por la usuaria. La v1.6 está solo en el repositorio local; la función AWS conserva la versión desplegada anteriormente.

## Llamadas de audio

La API incluye `POST /sessions/{code}/call/{start|accept|join|reject|end}`. El inicio requiere una sesión en modo `AGENT`; el operador debe estar asignado a ella. Lambda devuelve `joinInfo` al participante que inicia, atiende o se reconecta. El frontend usa Amazon Chime SDK for JavaScript para capturar el micrófono y reproducir el audio. `GET /sessions/{code}` expone el estado público en `session.call` para actualizar ambas pantallas.

`CHIME_MEDIA_REGION=us-east-1` y la policy inline `DANALinkChatChimeSDKAccess` ya estaban configuradas en AWS. La policy concede solo `CreateMeeting`, `CreateAttendee`, `GetMeeting` y `DeleteMeeting`; su copia está en `aws/chime-iam-policy.json`.

## Media y despliegue

El script `deploy.sh` conserva el bucket existente `dc-files-vzla-demo`, comprueba la cuenta AWS y las policies presentes, configura `MEDIA_PREFIX=dana-linkchat` y otras variables de media, y publica el código local. No crea buckets ni cambia CORS o permisos de otros recursos. La policy de S3 existente limita el acceso a `dana-linkchat/*`.

La v1.6 compara el monto y la moneda extraídos del comprobante con los de la sesión, sin exigir nombre, banco ni referencia. Si el archivo no parece un comprobante, devuelve `INVALID_RECEIPT` y permite otro intento. El código no usa `paymentVerification` por sesión. Las pruebas `test_payment_validation.py` aún describen una revisión anterior y fallan con la v1.6. `PAYMENT_MATCHED` indica coincidencia documental; no confirma liquidación bancaria.

## Verificación

```bash
python3 -m py_compile backend/lambda_function.py
bash -n backend/deploy.sh
npm run build
```

`python3 backend/live_chime_smoke.py` prueba la API real con una sesión y un operador ficticios, crea y finaliza una reunión Chime y borra los registros de prueba. Requiere credenciales AWS con permiso para borrar esos registros. No comprueba el audio entre dos dispositivos; eso requiere dos navegadores con micrófonos.
