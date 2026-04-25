import { Hono } from "hono";
import { z } from "zod";
import { getBearerUserId, readBodyObject } from "./auth-routes";
import { query } from "./db";

interface ClientRow {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  contact_email: string | null;
  created_at: string;
  updated_at: string;
}

const createClientSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  contact_email: z.string().optional().nullable(),
  contactEmail: z.string().optional().nullable()
});

function rowToJson(r: ClientRow) {
  return {
    id: r.id,
    owner_id: r.owner_id,
    name: r.name,
    description: r.description,
    contact_email: r.contact_email,
    created_at: r.created_at,
    updated_at: r.updated_at
  };
}

export function createPanelClientsRoutes(): Hono {
  const r = new Hono();

  r.get("/", async (c) => {
    const userId = await getBearerUserId(c);
    if (!userId) {
      return c.json({ detail: "No autenticado" }, 401);
    }
    const rows = await query<ClientRow>(
      `SELECT id, owner_id, name, description, contact_email, created_at, updated_at
       FROM clients
       WHERE owner_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );
    return c.json(rows.map(rowToJson));
  });

  r.post("/", async (c) => {
    const userId = await getBearerUserId(c);
    if (!userId) {
      return c.json({ detail: "No autenticado" }, 401);
    }
    const raw = await readBodyObject(c);
    const parsed = createClientSchema.parse({
      name: raw.name,
      description: raw.description,
      contact_email: raw.contact_email,
      contactEmail: raw.contactEmail
    });
    const contactRaw = parsed.contact_email ?? parsed.contactEmail;
    const contact =
      contactRaw === null || contactRaw === undefined
        ? null
        : String(contactRaw).trim() || null;
    const desc = parsed.description != null ? String(parsed.description) : null;

    const rows = await query<ClientRow>(
      `INSERT INTO clients (owner_id, name, description, contact_email)
       VALUES ($1, $2, $3, $4)
       RETURNING id, owner_id, name, description, contact_email, created_at, updated_at`,
      [userId, parsed.name.trim(), desc, contact]
    );
    const row = rows[0];
    if (!row) {
      return c.json({ detail: "No se pudo crear el cliente" }, 500);
    }
    return c.json(rowToJson(row), 201);
  });

  r.get("/:id", async (c) => {
    const userId = await getBearerUserId(c);
    if (!userId) {
      return c.json({ detail: "No autenticado" }, 401);
    }
    const id = c.req.param("id");
    const rows = await query<ClientRow>(
      `SELECT id, owner_id, name, description, contact_email, created_at, updated_at
       FROM clients WHERE id = $1 AND owner_id = $2`,
      [id, userId]
    );
    if (!rows[0]) {
      return c.json({ detail: "No encontrado" }, 404);
    }
    return c.json(rowToJson(rows[0]));
  });

  return r;
}
