import { z } from "zod";

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/).transform((value) => value.toLowerCase());
const logoPath = z.string().regex(/^[0-9a-f-]{36}\/logo-[0-9a-f-]{36}\.(png|jpg|webp)$/);

const brandSchema = z.object({
  version: z.literal(1).optional(),
  displayName: z.string().trim().min(1).max(120).nullable().optional(),
  tagline: z.string().trim().max(180).optional(),
  primaryColor: hexColor.optional(),
  accentColor: hexColor.optional(),
  logoPath: logoPath.nullable().optional(),
});

export type BrandConfig = {
  version: 1;
  displayName: string | null;
  tagline: string;
  primaryColor: string;
  accentColor: string;
  logoPath: string | null;
};

export const DEFAULT_BRAND: BrandConfig = {
  version: 1,
  displayName: null,
  tagline: "Resultados para decidir con contexto",
  primaryColor: "#0c4a6e",
  accentColor: "#0e7490",
  logoPath: null,
};

export function parseBrandConfig(value: unknown): BrandConfig {
  const parsed = brandSchema.safeParse(value);
  return parsed.success ? { ...DEFAULT_BRAND, ...parsed.data, version: 1 } : { ...DEFAULT_BRAND };
}

export function brandConfigSchema() {
  return z.object({
    displayName: z.string().trim().max(120),
    tagline: z.string().trim().max(180),
    primaryColor: hexColor,
    accentColor: hexColor,
  });
}

export function logoPublicUrl(path: string | null): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base || !path) return null;
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `${base}/storage/v1/object/public/tenant-branding/${encoded}`;
}

export function hexToRgb(value: string): [number, number, number] {
  const color = /^#[0-9a-f]{6}$/i.test(value) ? value.slice(1) : DEFAULT_BRAND.primaryColor.slice(1);
  return [0, 2, 4].map((index) => Number.parseInt(color.slice(index, index + 2), 16) / 255) as [number, number, number];
}
