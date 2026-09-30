import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { ApiError } from "@/lib/http/api";
import { route } from "@/lib/http/route";
import { requireMerchant } from "@/lib/merchant/require-merchant";
import { toInvoiceDto } from "@/lib/payments/invoice-dto";

// One of the signed-in merchant's invoices. Another merchant's invoice returns 404
// (not 403), so its existence isn't revealed.
export const GET = route<{ id: string }>("invoices.get", async (request, { params }) => {
  const { merchant } = await requireMerchant(request);
  if (!z.uuid().safeParse(params.id).success) throw new ApiError("NotFound");

  const invoice = await db.invoice.findFirst({ where: { id: params.id, merchantId: merchant.id } });
  if (!invoice) throw new ApiError("NotFound");
  return NextResponse.json(toInvoiceDto(invoice));
});
