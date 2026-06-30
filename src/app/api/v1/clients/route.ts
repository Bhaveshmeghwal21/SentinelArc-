import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

const CreateClientSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/),
  admin_email: z.string().email(),
  admin_password: z.string().min(8).max(128),
  admin_name: z.string().min(1).max(255).optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parseResult = CreateClientSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        details: parseResult.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 422 }
    );
  }

  const { name, slug, admin_email, admin_password, admin_name } =
    parseResult.data;

  // Check for existing slug
  const existing = await prisma.client.findUnique({
    where: { slug },
  });
  if (existing) {
    return NextResponse.json(
      { error: "Client with this slug already exists" },
      { status: 409 }
    );
  }

  // Hash the admin password
  const passwordHash = await bcrypt.hash(admin_password, 12);

  // Create client and admin user in a transaction
  const result = await prisma.client.create({
    data: {
      name,
      slug,
      users: {
        create: {
          email: admin_email,
          name: admin_name,
          passwordHash,
          role: "ADMIN",
        },
      },
    },
    include: {
      users: {
        select: {
          id: true,
          email: true,
          role: true,
        },
      },
    },
  });

  return NextResponse.json(
    {
      id: result.id,
      name: result.name,
      slug: result.slug,
      admin: result.users[0],
    },
    { status: 201 }
  );
}
