# DANA LinkChat

PoC de conversación web empresarial adaptable a la identidad de cada cliente. Esta primera versión usa la marca de Example Company y demuestra un flujo de cobranza con datos ficticios.

## Tecnología y ejecución

React, Vite, TailwindCSS y lucide-react. Requiere Node.js 20.19+ o 22.12+.

```bash
npm install
npm run dev
npm run build
```

`npm run dev` abre la demo en `/` y también admite `/c/demo-session`. `npm run build` genera el sitio estático en `dist/`.

## Configuración

Copie `.env.example` a `.env` si necesita cambiar variables locales:

```env
VITE_API_BASE_URL=
VITE_APP_NAME=DANA LinkChat
VITE_ENV=development
```

Con `VITE_API_BASE_URL` vacío, `src/services/api.js` usa mocks en memoria. Para conectar `dana-webchat-api`, defina la URL base y adapte en ese archivo las rutas y el contrato de respuesta cuando el Lambda esté listo. Los métodos `getSession`, `getMessages`, `sendMessage` y `sendAction` ya están separados de la interfaz. La ruta `/c/:sessionToken` recibe un token opaco en el path; no incluya datos personales en la URL. No hay pagos reales ni carga de archivos al servidor en esta demo.

La identidad visual está centralizada en `src/config/brand.js`; los SVG locales están en `src/assets/brand/`.

## AWS Amplify Hosting

Conecte este repositorio desde GitHub en Amplify Hosting. El archivo `amplify.yml` usa `npm ci`, ejecuta `npm run build` y publica `dist/`. Configure las variables `VITE_` en Amplify si utiliza una API. Añada una regla de reescritura SPA con origen `/<*>`, destino `/index.html` y estado `200` para abrir directamente `/c/:sessionToken`. El archivo `public/_redirects` incluye esa regla para plataformas que la admiten.
