import {
  AbilityBuilder,
  PureAbility,
  type RawRuleOf,
  type Subject,
  fieldPatternMatcher,
  mongoQueryMatcher,
} from '@casl/ability';

/**
 * CASL ability builder (PLAN.md §6.2).
 *
 * Inputs are the de-resolved rule shape — the DB-Rule resolver (next
 * slice) transforms persisted `Permission` rows into this format with
 * variables (`$CURRENT_USER`, `$NOW`, …) already substituted. The
 * factory produces a frozen `PureAbility` so request-time logic can
 * not mutate it; rebuild for any change.
 */

export type AbilityAction = 'create' | 'read' | 'update' | 'delete' | 'manage' | string;
export type AbilitySubjectType = string;

export interface AbilityRule {
  action: AbilityAction | AbilityAction[];
  subject: AbilitySubjectType | AbilitySubjectType[];
  conditions?: Record<string, unknown>;
  fields?: string[];
  inverted?: boolean;
}

export type Ability = PureAbility<[AbilityAction, Subject]>;

export function buildAbility(rules: AbilityRule[]): Ability {
  const builder = new AbilityBuilder<Ability>(PureAbility);
  for (const rule of rules) {
    const cmd = rule.inverted ? builder.cannot : builder.can;
    // CASL rejects empty fields[]. Persisted Permission rows use `[]`
    // here to mean "no field-level restriction" at this layer; strict
    // deny-all-fields semantics is reserved for a future slice.
    const fields = rule.fields && rule.fields.length > 0 ? rule.fields : undefined;
    cmd(
      rule.action as never,
      rule.subject as never,
      fields as never,
      rule.conditions as never,
    );
  }
  const ability = builder.build({
    detectSubjectType: (item) => {
      if (item && typeof item === 'object' && '__caslSubjectType__' in item) {
        return (item as { __caslSubjectType__: string }).__caslSubjectType__;
      }
      return (item as { constructor: { name: string } })?.constructor?.name ?? 'unknown';
    },
    conditionsMatcher: mongoQueryMatcher as never,
    fieldMatcher: fieldPatternMatcher,
  });
  // Freeze to prevent post-build mutation; tests rely on this.
  const original = ability.update.bind(ability);
  ability.update = ((nextRules: RawRuleOf<Ability>[]) => {
    if (nextRules !== undefined) {
      throw new Error('ability is frozen — rebuild via buildAbility() for changes');
    }
    return original(nextRules);
  }) as typeof ability.update;
  return ability;
}
