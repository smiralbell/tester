# QA Microservice para Agentes WhatsApp

Microservicio en **Bun** para ejecutar pruebas automáticas sobre tu agente conversacional de WhatsApp.

## Que hace

- Guarda configuraciones por proyecto (webhook del agente + contexto del cliente + instrucciones QA).
- Permite definir escenarios de prueba.
- Ejecuta runs automáticos donde:
  - una IA genera mensajes de cliente (OpenRouter),
  - llama a tu webhook del agente,
  - otra evaluación de IA puntúa respuesta, errores y recomendaciones.
- Persiste resultados y métricas en Postgres.

## Requisitos

- Bun 1.1+
- Postgres 14+
- API key de OpenRouter

## Variables de entorno

1. Copia `.env.example` a `.env`.
2. Completa los valores:

```bash
PORT=8000
DATABASE_URL=postgresql://user:password@localhost:5432/qa_microservice
OPENROUTER_API_KEY=sk-or-v1-xxxx
OPENROUTER_MODEL=openai/gpt-4o-mini
APP_BASE_URL=http://localhost:8000
REQUEST_TIMEOUT_MS=30000
WEBHOOK_MAX_RETRIES=2
ALLOWED_ORIGINS=*
INTERNAL_API_KEY=
JWT_SECRET=pon-una-cadena-larga-y-aleatoria
```

**Panel (crear cuenta):** el frontend suele llamar a `http://localhost:8000/api/auth/register`. Por eso `PORT=8000` en el mismo proceso sirve **auth + microservicio QA**. Si ya aplicaste el SQL antiguo, ejecuta también `schema.users.sql` para crear la tabla `users`.

**404 al entrar tras login:** si el navegador te deja en `http://localhost:8000/dashboard` (u otra ruta del panel), el API no tiene esa página. Configura `FRONTEND_URL=http://localhost:3000` (o la URL real del Next); las **GET** que no sean `/api/*` redirigen al panel con el mismo path.

**Panel `GET /api/clients`:** implementado en este mismo proceso. Requiere header `Authorization: Bearer <token>` (el del login). Tabla `clients` en `schema.microservice.sql` o ejecuta `schema.clients-panel.sql` si la base ya existía sin esa tabla.

## SQL manual (tal como pediste)

Ejecuta manualmente el archivo:

- `schema.microservice.sql`

Con eso quedan creadas todas las tablas e indices.

## Ejecutar en local

```bash
bun install
bun run dev
```

**Si ves 404:** el microservicio no vive en la raíz de otro proyecto. Abre `http://localhost:3001/` (o el `PORT` de tu `.env`) y usa rutas como `/health`, no confundas con el frontend en `:3000`.

### Panel web: `Failed to fetch` al crear cuenta

Ese formulario **no llama a este microservicio**. El frontend (Next.js, suele en `:3000`) usa `NEXT_PUBLIC_API_URL` y hace `fetch` al backend de usuarios (típicamente **FastAPI en `:8000`**). Si en `:8000` no hay nada escuchando, el navegador muestra **Failed to fetch** (no es CORS ni un JSON de error).

**Qué hacer:**

1. Arranca el backend del panel en el mismo host y puerto que pone `NEXT_PUBLIC_API_URL` (por defecto `http://localhost:8000`), o cambia esa variable a la URL real del API y **vuelve a construir** el frontend (las variables `NEXT_PUBLIC_*` se fijan en build).
2. Comprueba en el navegador: `http://localhost:8000/health` (o la ruta de health que use tu API) debe responder sin error.
3. Si el backend tiene CORS, incluye el origen del panel en su lista (p. ej. `http://localhost:3000`).

Este repo solo contiene el **microservicio Bun** (`PORT`, por defecto `3001`); el registro de cuentas lo resuelve el **otro** proyecto (frontend + API Python).

## Endpoints principales

### 1) Crear proyecto

`POST /projects`

```json
{
  "name": "Cliente ACME",
  "webhookUrl": "https://tu-agente.com/webhook",
  "webhookAuthToken": "token-opcional",
  "webhookMessageField": "message",
  "webhookSessionField": "sessionId",
  "webhookMetadataField": "metadata",
  "responseMessageField": "reply",
  "clientContext": "Informacion del cliente final...",
  "testInstructions": "Tu agente debe ..."
}
```

### 2) Crear escenario

`POST /scenarios`

```json
{
  "projectId": "uuid-del-proyecto",
  "name": "Calificacion de lead",
  "goal": "Verificar que califica al prospecto correctamente",
  "successCriteria": "Debe hacer preguntas de presupuesto y timeline",
  "maxMessagesDefault": 8
}
```

### 3) Ejecutar run

`POST /runs`

```json
{
  "projectId": "uuid-del-proyecto",
  "scenarioId": "uuid-del-escenario",
  "maxMessages": 10
}
```

### 4) Consultar resultados de run

`GET /runs/:id`

Devuelve estado + intercambio completo + puntuaciones + errores + advice.

### 5) Listados operativos

- `GET /projects`
- `GET /projects/:projectId/scenarios`
- `GET /runs` (con `?projectId=...` opcional)

## Robustez incluida

- CORS configurable por `ALLOWED_ORIGINS`.
- Timeout configurable para OpenRouter y webhooks.
- Reintentos automáticos al invocar webhooks.
- `GET /health` valida conexión real con Postgres.
- Middleware opcional de seguridad por `x-api-key` (`INTERNAL_API_KEY`).

## Despliegue en EasyPanel

- Runtime: Bun
- Build command: `bun install`
- Start command: `bun run start`
- Variables: las del `.env.example`
- Puerto expuesto: `PORT` (por defecto 3001)

## Siguiente mejora recomendada

- Mover `/runs` a procesamiento async con cola (BullMQ/Redis) para runs largos y paralelos.
