import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Tailwind sınıflarını birleştirir (çakışanlarda sonuncu kazanır).
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
