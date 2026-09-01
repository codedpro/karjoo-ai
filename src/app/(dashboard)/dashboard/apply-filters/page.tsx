import { redirect } from "next/navigation";

export default function ApplyFiltersRedirectPage() {
  redirect("/dashboard/profiles#targeting");
}
