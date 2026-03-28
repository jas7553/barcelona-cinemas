import type { CinemaRegistry, Listings } from "./types";

export async function fetchCinemas(): Promise<CinemaRegistry> {
  const res = await fetch("/api/cinemas");
  if (!res.ok) throw new Error(`/api/cinemas ${res.status}`);
  return res.json() as Promise<CinemaRegistry>;
}

export async function fetchListings(): Promise<Listings> {
  const res = await fetch("/api/listings");
  if (!res.ok) throw new Error(`/api/listings ${res.status}`);
  return res.json() as Promise<Listings>;
}

