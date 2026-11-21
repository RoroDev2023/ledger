// [Rahim] Zod schemas for the Shop MCP documents we read. The tools publish no output schema
// (shop-tools.md "Results"), so these follow the documented examples and keep unknown fields (passthrough).
import { z } from 'zod';

/** Integer in the currency's minor units: 6400 USD = $64.00 (shop-quickstart.md). */
export const MoneySchema = z.object({ amount: z.number().int(), currency: z.string() }).passthrough();
export type Money = z.infer<typeof MoneySchema>;

export const SellerSchema = z
  .object({ id: z.string().optional(), name: z.string(), url: z.string().optional(), domain: z.string() })
  .passthrough();
export type Seller = z.infer<typeof SellerSchema>;

export const OptionSelectionSchema = z.object({ name: z.string(), label: z.string() }).passthrough();

export const VariantSchema = z
  .object({
    id: z.string(),
    title: z.string().optional(),
    options: z.array(OptionSelectionSchema).optional(),
    price: MoneySchema,
    availability: z.object({ available: z.boolean().optional() }).passthrough().optional(),
    url: z.string().optional(),
    seller: SellerSchema.optional(),
  })
  .passthrough();
export type Variant = z.infer<typeof VariantSchema>;

export const ProductSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.unknown().optional(),
    options: z.array(z.object({ name: z.string() }).passthrough()).optional(),
    price_range: z.object({ min: MoneySchema, max: MoneySchema }).passthrough().optional(),
    variants: z.array(VariantSchema).default([]),
  })
  .passthrough();
export type Product = z.infer<typeof ProductSchema>;

export const ShopMessageSchema = z
  .object({ type: z.string(), code: z.string().optional(), content: z.string().optional(), severity: z.string().optional() })
  .passthrough();
export type ShopMessage = z.infer<typeof ShopMessageSchema>;

export const SearchDocSchema = z
  .object({
    products: z.array(ProductSchema),
    messages: z.array(ShopMessageSchema).default([]),
    pagination: z.object({ has_next_page: z.boolean().optional(), total_count: z.number().optional(), cursor: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();
export type SearchDoc = z.infer<typeof SearchDocSchema>;

export const ProductDocSchema = z.object({ product: ProductSchema, messages: z.array(ShopMessageSchema).default([]) }).passthrough();
export type ProductDoc = z.infer<typeof ProductDocSchema>;

/** Checkout document (shop-checkout.md "What comes back"). `id` and `continue_url` carry an access key: never log them. */
export const CheckoutDocSchema = z
  .object({
    id: z.string(),
    status: z.string(),
    currency: z.string().optional(),
    line_items: z.array(z.unknown()).optional(),
    totals: z.unknown().optional(),
    messages: z.array(ShopMessageSchema).default([]),
    continue_url: z.string().optional(),
    expires_at: z.string().optional(),
  })
  .passthrough();
export type CheckoutDoc = z.infer<typeof CheckoutDocSchema>;
