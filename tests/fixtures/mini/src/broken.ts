// @ts-nocheck
import { nope } from "./missing";
import alias from "@/missing";
import leftPad from "left-pad";
import { readFileSync } from "node:fs";
import { a } from "./a";

export const broken = [nope, alias, leftPad, readFileSync, a];
