/** Debe coincidir con el enum del microservicio (`webhook-variable-layout.ts`). */
export type QaVariableKind =
  | "tester_message"
  | "session_id"
  | "datetime"
  | "qa_id"
  | "phone"
  | "document"
  | "link"
  | "image";

export const QA_VARIABLE_CATALOG: {
  kind: QaVariableKind;
  title: string;
  description: string;
  sample: string;
  defaultKey: string;
  /** Si el agente no puede probarse sin este campo */
  required: boolean;
}[] = [
  {
    kind: "tester_message",
    title: "Mensaje del test",
    description: "Texto que simula al cliente en cada turno de la prueba.",
    sample: "(dinámico en cada llamada)",
    defaultKey: "message",
    required: true
  },
  {
    kind: "session_id",
    title: "ID de sesión / conversación",
    description: "UUID único por llamada al webhook; sirve para enlazar turnos.",
    sample: "UUID v4",
    defaultKey: "sessionId",
    required: false
  },
  {
    kind: "datetime",
    title: "Fecha y hora actuales",
    description: "Marca temporal ISO 8601 del momento del POST.",
    sample: "2026-04-22T12:00:00.000Z",
    defaultKey: "sentAt",
    required: false
  },
  {
    kind: "qa_id",
    title: "ID (UUID de prueba)",
    description: "Identificador UUID distinto de la sesión, por si tu API lo pide aparte.",
    sample: "UUID v4",
    defaultKey: "clientId",
    required: false
  },
  {
    kind: "phone",
    title: "Teléfono (fijo de prueba)",
    description: "Siempre el mismo número español inventado para QA.",
    sample: "+34600123456",
    defaultKey: "phone",
    required: false
  },
  {
    kind: "document",
    title: "Documento (texto de ejemplo)",
    description: "Texto ficticio que representa un documento adjunto o contenido.",
    sample: "Texto corto fijo de QA",
    defaultKey: "document",
    required: false
  },
  {
    kind: "link",
    title: "Enlace",
    description: "URL de ejemplo fija para pruebas.",
    sample: "https://ejemplo-qa.buffalo.local/recurso",
    defaultKey: "link",
    required: false
  },
  {
    kind: "image",
    title: "Imagen",
    description: "URL de imagen placeholder fija para pruebas.",
    sample: "https://placehold.co/…",
    defaultKey: "imageUrl",
    required: false
  }
];
