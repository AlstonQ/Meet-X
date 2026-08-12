import { describe, expect, it } from "vitest";
import { decideAutoJoin, type AutoJoinInput } from "./auto-join.js";

type Fixture = {
  name: string;
  input: AutoJoinInput;
  shouldJoin: boolean;
  reason: ReturnType<typeof decideAutoJoin>["reason"];
};

const baseInput: AutoJoinInput = {
  workspaceRule: "all",
  audience: "internal",
  consentPolicy: "announce",
  explicitConsent: false,
  hasConferenceUrl: true
};

const fixtures: Fixture[] = [
  { name: "all internal announce", input: baseInput, shouldJoin: true, reason: "allowed" },
  { name: "all external announce", input: { ...baseInput, audience: "external" }, shouldJoin: true, reason: "allowed" },
  { name: "all external explicit with consent", input: { ...baseInput, audience: "external", consentPolicy: "explicit_opt_in", explicitConsent: true }, shouldJoin: true, reason: "allowed" },
  { name: "all external explicit without consent", input: { ...baseInput, audience: "external", consentPolicy: "explicit_opt_in" }, shouldJoin: false, reason: "explicit_consent_required" },
  { name: "manual blocks internal", input: { ...baseInput, workspaceRule: "manual" }, shouldJoin: false, reason: "manual_required" },
  { name: "manual blocks external", input: { ...baseInput, workspaceRule: "manual", audience: "external" }, shouldJoin: false, reason: "manual_required" },
  { name: "external only allows external", input: { ...baseInput, workspaceRule: "external_only", audience: "external" }, shouldJoin: true, reason: "allowed" },
  { name: "external only blocks internal", input: { ...baseInput, workspaceRule: "external_only" }, shouldJoin: false, reason: "audience_not_allowed" },
  { name: "internal only allows internal", input: { ...baseInput, workspaceRule: "internal_only" }, shouldJoin: true, reason: "allowed" },
  { name: "internal only blocks external", input: { ...baseInput, workspaceRule: "internal_only", audience: "external" }, shouldJoin: false, reason: "audience_not_allowed" },
  { name: "missing URL blocks all", input: { ...baseInput, hasConferenceUrl: false }, shouldJoin: false, reason: "missing_conference_url" },
  { name: "calendar manual override blocks", input: { ...baseInput, calendarRuleOverride: "manual" }, shouldJoin: false, reason: "manual_required" },
  { name: "calendar external override allows external", input: { ...baseInput, calendarRuleOverride: "external_only", audience: "external" }, shouldJoin: true, reason: "allowed" },
  { name: "calendar external override blocks internal", input: { ...baseInput, calendarRuleOverride: "external_only" }, shouldJoin: false, reason: "audience_not_allowed" },
  { name: "calendar internal override allows internal", input: { ...baseInput, workspaceRule: "external_only", calendarRuleOverride: "internal_only" }, shouldJoin: true, reason: "allowed" },
  { name: "calendar internal override blocks external", input: { ...baseInput, workspaceRule: "all", calendarRuleOverride: "internal_only", audience: "external" }, shouldJoin: false, reason: "audience_not_allowed" },
  { name: "implicit policy all external allowed", input: { ...baseInput, audience: "external", consentPolicy: "implicit" }, shouldJoin: true, reason: "allowed" },
  { name: "implicit policy no disclosure required", input: { ...baseInput, consentPolicy: "implicit" }, shouldJoin: true, reason: "allowed" },
  { name: "explicit internal allowed without opt in", input: { ...baseInput, consentPolicy: "explicit_opt_in" }, shouldJoin: true, reason: "allowed" },
  { name: "missing URL beats manual", input: { ...baseInput, workspaceRule: "manual", hasConferenceUrl: false }, shouldJoin: false, reason: "missing_conference_url" },
  { name: "override all beats workspace manual", input: { ...baseInput, workspaceRule: "manual", calendarRuleOverride: "all" }, shouldJoin: true, reason: "allowed" }
];

describe("decideAutoJoin", () => {
  it.each(fixtures)("$name", ({ input, shouldJoin, reason }) => {
    const decision = decideAutoJoin(input);

    expect(decision.shouldJoin).toBe(shouldJoin);
    expect(decision.reason).toBe(reason);
  });

  it("requires disclosure for announce and explicit opt-in policies", () => {
    expect(decideAutoJoin({ ...baseInput, consentPolicy: "announce" }).disclosureRequired).toBe(true);
    expect(decideAutoJoin({ ...baseInput, consentPolicy: "explicit_opt_in" }).disclosureRequired).toBe(true);
    expect(decideAutoJoin({ ...baseInput, consentPolicy: "implicit" }).disclosureRequired).toBe(false);
  });
});
