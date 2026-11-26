# DANA LinkChat

Conversación web empresarial adaptable a la identidad de cada cliente. Esta versión muestra sesiones reales de cobranza creadas por DANA y atendidas por `dana-webchat-api`.

## Tecnología y ejecución

React, Vite, TailwindCSS y lucide-react. Requiere Node.js 20.19+ o 22.12+.

```bash
npm install
npm run dev
npm run build
```

Abra una sesión válida en `/c/:sessionToken`. El panel de operadores está en `/operator`, la lista real de asesores en `/operator/settings` y una conversación activa puede abrirse en `/operator/chat/:sessionCode`. La ruta `/` muestra el estado de sesión no disponible. `npm run build` genera el sitio estático en `dist/`.

## Configuración

Copie `.env.example` a `.env` si necesita cambiar variables locales:

```env
VITE_API_BASE_URL=https://ts7l5pjnxnrs5ocu2ttjgrdb5y0zporq.lambda-url.us-east-1.on.aws
VITE_APP_NAME=DANA LinkChat
VITE_ENV=development
```

`VITE_API_BASE_URL` es obligatoria y apunta a la Function URL de `dana-webchat-api`. El frontend carga `GET /sessions/{code}` y usa `session.messages` de la Lambda como fuente de verdad. Los mensajes y acciones del cliente se envían mediante `POST /sessions/{code}/messages` y `POST /sessions/{code}/actions`; no hay respuestas simuladas. La ruta `/c/:sessionToken` recibe un código opaco en el path; no incluya datos personales en la URL. Configure la misma variable en AWS Amplify Hosting antes de compilar y desplegar.

El panel usa `GET/POST /operators`, `POST /operators/{id}/status`, `GET /operator-queue` y las operaciones de sesión `take`, `operator-message` y `return-to-bot`. El ingreso de esta PoC guarda el identificador del operador en `sessionStorage`; no implementa autenticación corporativa. El chat del operador consulta la sesión cada 2,5 segundos mientras está abierto; el cliente hace lo mismo durante la espera y atención humana. Las consultas se omiten si la pestaña no está visible. La cola se consulta cada 3 segundos. La selección y vista previa de archivos genéricos, y la grabación local de voz, continúan sin envío; el comprobante de pago sí usa `/media/presign`, S3 y `/media/confirm` cuando se despliegue la Lambda incluida en [`backend/`](backend/README.md). El botón de llamada usa `tel:` solo cuando la sesión devuelve un teléfono válido.

El saludo inicial se crea en el backend como mensajes reales de `session.messages`. La Lambda incluida crea un solo mensaje de asistente para las **sesiones nuevas**: `Hola {session.customer.firstName}. Este es el detalle de tu saldo pendiente.` El frontend muestra ese mensaje, después la tarjeta de cuenta y después las acciones rápidas; conserva intacto el historial de sesiones ya creadas. Si `firstName` contiene nombre y apellido, el origen de datos debe corregir ese campo para obtener un saludo de solo nombre.

La identidad visual está centralizada en `src/config/brand.js` y usa directamente los SVG del kit en `src/assets/brand/example_brand_kit_2/logos/svg/`.

## AWS Amplify Hosting

Conecte este repositorio desde GitHub en Amplify Hosting. El archivo `amplify.yml` usa `npm ci`, ejecuta `npm run build` y publica `dist/`. Configure las variables `VITE_` en Amplify si utiliza una API. Añada una regla de reescritura SPA con origen `/<*>`, destino `/index.html` y estado `200` para abrir directamente `/c/:sessionToken`. El archivo `public/_redirects` incluye esa regla para plataformas que la admiten.
