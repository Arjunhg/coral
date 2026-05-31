import { NextResponse, NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { coral } from "@/lib/coral/client";

export async function GET(req: NextRequest){
    const { userId } = await auth();
    if(!userId){
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    try {
        const tables = await coral.listCatalog();
        return NextResponse.json({ tables }, { status: 200 });
    } catch (error) {
        return NextResponse.json({ error: "internal server error" }, { status: 500 });
    }
}
