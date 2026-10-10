import type { User } from "@/types";

export function e(user: User): number {
  return user.name.length;
}
