import { b } from "./b";
import type { User } from "@/types";

export function a(user: User, next: typeof b = b): string {
  return next(user.name);
}
