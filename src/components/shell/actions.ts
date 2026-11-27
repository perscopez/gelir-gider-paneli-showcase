"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function setLocale(formData: FormData) {
  (await cookies()).set("locale", formData.get("locale") === "en" ? "en" : "tr", { path: "/", maxAge: 31536000, sameSite: "lax" });
  revalidatePath("/", "layout");
}

export async function signOut() {
  await (await createClient()).auth.signOut();
  redirect("/login");
}

// Gösterim modu: başkalarına gösterirken uydurma sayılar kullanılır (gerçek veri okunmaz, hiçbir şey yazılmaz).
export async function setDemo(formData: FormData) {
  const { data } = await (await createClient()).auth.getUser();
  if (!data.user) redirect("/login");
  const jar = await cookies();
  if (formData.get("on") === "1") jar.set("demo", "1", { path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 12 });
  else jar.delete("demo");
  revalidatePath("/", "layout");
  redirect("/");
}
