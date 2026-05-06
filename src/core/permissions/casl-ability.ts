import {
  AbilityBuilder,
  PureAbility,
  type RawRuleOf,
  type Subject,
  fieldPatternMatcher,
  mongoQueryMatcher,
} from "@casl/ability";

/**
 * CASL ability builder.
 *
 * Inputs are the de-resolved rule shape — the DB-Rule resolver (next
 * slice) transforms persisted `Permission` rows into this format with
 * variables (`$CURRENT_USER`, `$NOW`, …) already substituted. The
 * factory produces a frozen `PureAbility` so request-time logic can
 * not mutate it; rebuild for any change.
 */

export type AbilityAction = "create" | "read" | "update" | "delete" | "manage" | string;
export type AbilitySubjectType = string;

export interface AbilityRule {
  action: AbilityAction | AbilityAction[];
  subject: AbilitySubjectType | AbilitySubjectType[];
  conditions?: Record<string, unknown>;
  fields?: string[];
  inverted?: boolean;
}

export type Ability = PureAbility<[AbilityAction, Subject]>;

/**
 * Type-erasing wire signature for `builder.can` / `builder.cannot`.
 * CASL's overloaded `MongoAbility` builder methods narrow each
 * argument tighter than the project's stored `AbilityRule` shape;
 * the wire-shape interface accepts the runtime contract directly.
 */
type AbilityBuilderCmd = (
  action: AbilityAction | AbilityAction[],
  subject: Subject | Subject[],
  fields: readonly string[] | undefined,
  conditions: Record<string, unknown> | undefined,
) => void;

type AbilityBuildOptions = NonNullable<Parameters<AbilityBuilder<Ability>["build"]>[0]>;

export function buildAbility(rules: AbilityRule[]): Ability {
  const builder = new AbilityBuilder<Ability>(PureAbility);
  for (const rule of rules) {
    const cmd: AbilityBuilderCmd = (
      rule.inverted ? builder.cannot : builder.can
    ) as AbilityBuilderCmd;
    // CASL rejects empty fields[]. Persisted Permission rows use `[]`
    // here to mean "no field-level restriction" at this layer; strict
    // deny-all-fields semantics is reserved for a future slice.
    const fields = rule.fields && rule.fields.length > 0 ? rule.fields : undefined;
    cmd(rule.action, rule.subject, fields, rule.conditions);
  }
  const buildOptions: AbilityBuildOptions = {
    detectSubjectType: (item) => {
      if (item && typeof item === "object" && "__caslSubjectType__" in item) {
        return (item as { __caslSubjectType__: string }).__caslSubjectType__;
      }
      return (item as { constructor: { name: string } })?.constructor?.name ?? "unknown";
    },
    conditionsMatcher: mongoQueryMatcher as AbilityBuildOptions["conditionsMatcher"],
    fieldMatcher: fieldPatternMatcher,
  };
  const ability = builder.build(buildOptions);
  // Freeze to prevent post-build mutation; tests rely on this.
  const original = ability.update.bind(ability);
  ability.update = ((nextRules: RawRuleOf<Ability>[]) => {
    if (nextRules !== undefined) {
      throw new Error("ability is frozen — rebuild via buildAbility() for changes");
    }
    return original(nextRules);
  }) as typeof ability.update;
  return ability;
}
