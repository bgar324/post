import "dotenv/config";
import { z } from "zod";

const ConfigSchema = z.object({
  APP_BASE_URL: z.string().url(),
  SUPABASE_DB_CA_CERT_PATH: z.string().min(1),
  DATABASE_URL: z.string().startsWith("postgres"),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().url(),
  SESSION_SECRET: z.string().min(32),
  TOKEN_ENCRYPTION_KEY: z.string().min(32),
  API_PORT: z.coerce.number().int().positive().default(4174),
});

export const config = ConfigSchema.parse(process.env);
