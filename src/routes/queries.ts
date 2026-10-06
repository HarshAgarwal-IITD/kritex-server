import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { adminAuth } from "../middleware/adminAuth.js";

export const queriesRouter = Router();

const createQuerySchema = z.object({
  name: z.string().trim().min(1).max(200),
  organization: z.string().trim().max(200).optional().or(z.literal("")),
  email: z.string().trim().email().max(200),
  requirements: z.string().trim().min(1).max(5000),
});

// POST /api/queries — public, submitted from the contact form
queriesRouter.post("/", async (req, res, next) => {
  try {
    const parsed = createQuerySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    }

    const { name, organization, email, requirements } = parsed.data;

    const query = await prisma.query.create({
      data: {
        name,
        organization: organization || null,
        email,
        requirements,
      },
    });

    res.status(201).json({ id: query.id, createdAt: query.createdAt });
  } catch (err) {
    next(err);
  }
});

// GET /api/queries — admin only, lists submitted queries
queriesRouter.get("/", adminAuth, async (_req, res, next) => {
  try {
    const queries = await prisma.query.findMany({
      orderBy: { createdAt: "desc" },
    });
    res.json(queries);
  } catch (err) {
    next(err);
  }
});
