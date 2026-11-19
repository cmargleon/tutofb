# Correo de clientes con Google Workspace

**Configuración → Correo de Manglar** permite a administradores conectar una vez
`contacto@agenciamanglar.mx` para toda la app. La autorización OAuth no depende
de ningún cliente y regresa a `/configuracion#correo`. La pestaña **Correos** de
la ficha de cliente permite enviar mensajes de texto a sus contactos guardados.
Todos los envíos usan el mismo buzón. No hay envíos automáticos ni adjuntos.

## Configuración

- Habilitar Gmail API en `tutofb-260320-1003`.
- Crear un cliente OAuth web; guardar su JSON descargado en el secreto Firebase
  `GMAIL_OAUTH_CLIENT` mediante `firebase functions:secrets:set ... --data-file ...`.
  No guardar credenciales en el repositorio ni variables Vite.
- URI de retorno exacta:
  `https://us-central1-tutofb-260320-1003.cloudfunctions.net/gmailOAuthCallback`.
- Se solicitan `openid`, `email` y `https://www.googleapis.com/auth/gmail.send`.
  Los dos primeros verifican la identidad del buzón; no se pide lectura de Gmail.
- Con público externo en pruebas, agregar el buzón como usuario de prueba.
  Google limita a siete días los refresh tokens de apps externas en pruebas que
  solicitan permisos como Gmail. Antes de operación permanente, resolver el estado
  de publicación/verificación aplicable o usar un proyecto interno de Workspace.
  No cambiar la organización del proyecto Firebase como parte de este alta.

## Seguridad y operación

Las funciones revalidan usuarios activos, rol admin y acceso al cliente. Se rechaza
cualquier otro remitente o destinatario ajeno a los contactos guardados, clientes
archivados e inyección de cabeceras. Conectar/desconectar afecta a todo el buzón.
Los tokens se cifran con AES-GCM usando el secreto OAuth como material de clave.
Si se cambia ese secreto, volver a conectar el buzón. `emailPrivate` y
`emailOAuthStates` no tienen permisos de acceso directo desde el cliente.
Los estados OAuth vencen en diez minutos y se consumen una sola vez con PKCE.

Cada intento tiene UUID persistido en el navegador durante la sesión y reclamado
en transacción antes de contactar Google. No se repite un UUID ya reclamado. Un
fallo de red o 5xx posterior al intento se marca `unknown`; una interrupción abrupta
puede dejar `sending`. En ambos casos revisar Enviados antes de crear otro mensaje.
No se infiere entrega o lectura de un envío aceptado por Gmail. Límite local de diez
intentos por minuto en el buzón, además de las cuotas de Google. El historial conserva
destinatario, asunto, cuerpo, actor y estado en documentos privados del servidor.

## Validación

`npm test` incluye validación, MIME, cifrado y rechazo anónimo. Para probar OAuth,
autorización y concurrencia sin enviar correos reales:

```sh
firebase emulators:exec --project demo-manglar-automation --only firestore,auth \
  'node --import tsx --test tests/email.integration.test.ts'
```

Desplegar solo las seis funciones nuevas de correo y Hosting. Una prueba real debe
realizarla el operador después de autorizar el buzón y revisar destinatario/mensaje.
