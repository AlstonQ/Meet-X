export type AutoJoinRule = "all" | "external_only" | "internal_only" | "manual";
export type ConsentPolicy = "implicit" | "announce" | "explicit_opt_in";
export type MeetingAudience = "internal" | "external";

export type AutoJoinInput = {
  workspaceRule: AutoJoinRule;
  calendarRuleOverride?: AutoJoinRule;
  audience: MeetingAudience;
  consentPolicy: ConsentPolicy;
  explicitConsent: boolean;
  hasConferenceUrl: boolean;
  organizerUserId?: string;
};

export type AutoJoinDecision =
  | { shouldJoin: true; reason: "allowed"; effectiveRule: AutoJoinRule; disclosureRequired: boolean }
  | {
      shouldJoin: false;
      reason:
        | "manual_required"
        | "missing_conference_url"
        | "audience_not_allowed"
        | "explicit_consent_required";
      effectiveRule: AutoJoinRule;
      disclosureRequired: boolean;
    };

export function decideAutoJoin(input: AutoJoinInput): AutoJoinDecision {
  const effectiveRule = input.calendarRuleOverride ?? input.workspaceRule;
  const disclosureRequired = input.consentPolicy === "announce" || input.consentPolicy === "explicit_opt_in";

  if (!input.hasConferenceUrl) {
    return { shouldJoin: false, reason: "missing_conference_url", effectiveRule, disclosureRequired };
  }

  if (effectiveRule === "manual") {
    return { shouldJoin: false, reason: "manual_required", effectiveRule, disclosureRequired };
  }

  if (effectiveRule === "external_only" && input.audience !== "external") {
    return { shouldJoin: false, reason: "audience_not_allowed", effectiveRule, disclosureRequired };
  }

  if (effectiveRule === "internal_only" && input.audience !== "internal") {
    return { shouldJoin: false, reason: "audience_not_allowed", effectiveRule, disclosureRequired };
  }

  if (input.consentPolicy === "explicit_opt_in" && input.audience === "external" && !input.explicitConsent) {
    return { shouldJoin: false, reason: "explicit_consent_required", effectiveRule, disclosureRequired };
  }

  return { shouldJoin: true, reason: "allowed", effectiveRule, disclosureRequired };
}
