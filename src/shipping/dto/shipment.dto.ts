import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { emailInputSchema } from '../../common/dto/india';
import { isoDateTimeSchema } from '../../common/dto/common';
import { orderStatusSchema, shipmentStatusSchema } from '../../common/dto/enums';

export const trackingEventSchema = z.object({
  at: isoDateTimeSchema,
  status: z.string().meta({ description: 'Carrier status text' }),
  location: z.string().nullable(),
  description: z.string().nullable(),
});

export const shipmentSchema = z.object({
  id: z.string(),
  carrier: z.string().nullable().meta({ example: 'Delhivery' }),
  awb: z.string().nullable(),
  trackingUrl: z.string().nullable(),
  status: shipmentStatusSchema,
  events: z.array(trackingEventSchema),
  shippedAt: isoDateTimeSchema.nullable(),
  deliveredAt: isoDateTimeSchema.nullable(),
});
export type Shipment = z.infer<typeof shipmentSchema>;
export class ShipmentDto extends createZodDto(shipmentSchema) {}

/** Admin view: adds Shiprocket ids and the label. */
export const adminShipmentSchema = shipmentSchema.extend({
  shiprocketOrderId: z.string().nullable(),
  shiprocketShipmentId: z.string().nullable(),
  labelUrl: z.string().nullable().meta({ description: 'Shiprocket label PDF, when generated' }),
  manual: z.boolean().meta({ description: 'Created by the manual ship fallback (no Shiprocket)' }),
});
export class AdminShipmentDto extends createZodDto(adminShipmentSchema) {}

// ---------- Public tracking ----------

export const trackOrderQuerySchema = z.object({
  email: emailInputSchema.meta({ description: 'Email used on the order (prevents enumeration)' }),
});
export class TrackOrderQueryDto extends createZodDto(trackOrderQuerySchema) {}

export const orderTrackingSchema = z.object({
  orderNumber: z.string(),
  status: orderStatusSchema,
  placedAt: isoDateTimeSchema,
  shipments: z.array(shipmentSchema),
  timeline: z.array(
    z.object({ type: z.string(), message: z.string(), createdAt: isoDateTimeSchema }),
  ),
});
export class OrderTrackingDto extends createZodDto(orderTrackingSchema) {}

// ---------- Admin: create Shiprocket shipment ----------

export const createShiprocketShipmentSchema = z.object({
  weightGrams: z
    .number()
    .int()
    .positive()
    .optional()
    .meta({ description: 'Defaults to the sum of product weights' }),
  lengthCm: z.number().int().positive().optional(),
  widthCm: z.number().int().positive().optional(),
  heightCm: z.number().int().positive().optional(),
  pickupLocation: z
    .string()
    .trim()
    .max(100)
    .optional()
    .meta({ description: 'Shiprocket pickup nickname' }),
  courierId: z
    .number()
    .int()
    .positive()
    .optional()
    .meta({ description: 'Default: Shiprocket recommendation' }),
  schedulePickup: z.boolean().default(true),
});
export class CreateShiprocketShipmentDto extends createZodDto(createShiprocketShipmentSchema) {}

// ---------- Webhook ----------

export const webhookAckSchema = z.object({ received: z.literal(true) });
export class WebhookAckDto extends createZodDto(webhookAckSchema) {}
