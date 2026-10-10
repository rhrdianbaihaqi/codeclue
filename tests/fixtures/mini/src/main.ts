import { c } from "./c";
import { d } from "./d";
import { e } from "./e";
import { widgetTest } from "./widget.test";
import type { Api } from "./api.d";
import { schema } from "./generated/schema";

export function main(api: Api): string {
  widgetTest();
  return c({ id: "1", name: "x" }) + d({ id: "1", name: "x" }) + e({ id: "1", name: "x" }) + schema.version;
}
