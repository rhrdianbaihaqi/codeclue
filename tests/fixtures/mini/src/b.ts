import { a } from "./a";
import type { User } from "@/types";

export function b(name: string, prev: typeof a = a): string {
  const user: User = { id: "1", name };
  return name.length > 3 ? name : prev(user);
}
