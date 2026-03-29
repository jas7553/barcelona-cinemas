import type { Listings } from "./types";

export async function fetchListings(): Promise<Listings> {
  const res = await fetch("/api/listings");
  if (!res.ok) throw new Error(`/api/listings ${res.status}`);
  return res.json() as Promise<Listings>;
}
