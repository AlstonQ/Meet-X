import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  DEFAULT_DATA_REGION: z.enum(["eu-central-1", "eu-west-1", "us-east-1", "ap-south-1"]),
  CONFIG_SECRET_MANAGER: z.enum(["local", "aws-secrets-manager"]).default("local")
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(source: NodeJS.ProcessEnv): AppConfig {
  return envSchema.parse(source);
}
