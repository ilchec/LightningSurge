import { gql } from 'lightning/graphql';

/**
 * Pure functions behind the User Comparison tab: building the per-user GraphQL query, extracting a
 * flat comparable object from its response, and the two diff-building shapes the tab's tables share -
 * one for field-based categories (Basic Settings, Profile & Role, where both users always have some
 * value), one for list/set-based categories (Permission Sets, Permission Set Groups, Public Groups,
 * Queues, where an item may genuinely be absent on one side - the "gap" the tab renders as an
 * unchecked checkbox rather than a blank cell).
 *
 * `Profile { Name { value } }` and `UserRole { Name { value } }` traversal from User have never been
 * used elsewhere in this app - only `Manager` traversal (Org Chart) is independently confirmed. Both
 * follow the exact same underlying UI API mechanism confirmed for Manager (each parent relationship
 * on an object has a corresponding field on the GraphQL type, named after the relationship), so this
 * is a low-risk extension of a proven pattern, not a fresh guess - but genuinely not yet confirmed
 * live the way Manager traversal is, worth confirming on the first real deploy.
 *
 * Two separate single-`eq`-match queries (one per selected user) are used rather than one combined
 * `where: { Id: { in: [...] } }` query - `in` isn't used anywhere else in this app (only `eq`/`like`/
 * `and` are proven), so this reuses the exact query shape Org Chart's own buildUserNodeQuery already
 * has confirmed working, rather than gambling on an unverified operator.
 */

/** Every Basic Settings field, in display order - see extractComparisonUserNode for where each key comes from. */
export const BASIC_SETTINGS_FIELDS = [
  { key: 'username', label: 'Username' },
  { key: 'email', label: 'Email' },
  { key: 'alias', label: 'Alias' },
  { key: 'title', label: 'Title' },
  { key: 'department', label: 'Department' },
  { key: 'division', label: 'Division' },
  { key: 'active', label: 'Active' },
  { key: 'userType', label: 'User Type' },
  { key: 'timeZone', label: 'Time Zone' },
  { key: 'locale', label: 'Locale' },
  { key: 'language', label: 'Language' }
];

/** Every Profile & Role field, in display order. */
export const PROFILE_ROLE_FIELDS = [
  { key: 'profile', label: 'Profile' },
  { key: 'role', label: 'Role' },
  { key: 'manager', label: 'Manager' }
];

/** One user's own comparison data - every Basic Settings/Profile & Role field this tab needs, in one request. */
export function buildUserComparisonQuery(userId) {
  return gql`
    query {
      uiapi {
        query {
          User(where: { Id: { eq: "${userId}" } }, first: 1) {
            edges {
              node {
                Id
                Name {
                  value
                }
                Username {
                  value
                }
                Email {
                  value
                }
                Alias {
                  value
                }
                Title {
                  value
                }
                Department {
                  value
                }
                Division {
                  value
                }
                IsActive {
                  value
                }
                UserType {
                  value
                }
                TimeZoneSidKey {
                  value
                }
                LocaleSidKey {
                  value
                }
                LanguageLocaleKey {
                  value
                }
                Profile {
                  Name {
                    value
                  }
                }
                UserRole {
                  Name {
                    value
                  }
                }
                Manager {
                  Name {
                    value
                  }
                }
              }
            }
          }
        }
      }
    }
  `;
}

/**
 * Flattens a buildUserComparisonQuery response into a plain, comparable object keyed to match
 * BASIC_SETTINGS_FIELDS/PROFILE_ROLE_FIELDS's own `key`s - or null if the user wasn't found/visible.
 * Role/Manager default to a descriptive placeholder rather than an empty string when absent - unlike
 * a list-based category, an empty Role really is a meaningful, common state worth showing plainly,
 * not something that should read like the "gap" a missing permission set/group renders as.
 */
export function extractComparisonUserNode(data) {
  const edge = data?.uiapi?.query?.User?.edges?.[0];
  if (!edge) {
    return null;
  }
  const node = edge.node;
  return {
    id: node.Id,
    name: node.Name?.value ?? node.Id,
    username: node.Username?.value ?? '',
    email: node.Email?.value ?? '',
    alias: node.Alias?.value ?? '',
    title: node.Title?.value ?? '',
    department: node.Department?.value ?? '',
    division: node.Division?.value ?? '',
    active: node.IsActive?.value ? 'Active' : 'Inactive',
    userType: node.UserType?.value ?? '',
    timeZone: node.TimeZoneSidKey?.value ?? '',
    locale: node.LocaleSidKey?.value ?? '',
    language: node.LanguageLocaleKey?.value ?? '',
    profile: node.Profile?.Name?.value ?? '',
    role: node.UserRole?.Name?.value ?? '(No Role)',
    manager: node.Manager?.Name?.value ?? '(No Manager)'
  };
}

/**
 * One row per field def, reading the same key off each user's flattened comparison data - both
 * users always have *some* value here (even if it's a placeholder like "(No Role)"), so unlike
 * buildSetDiffRows, a mismatched row always has both columns populated, never a gap.
 */
export function buildFieldRows(userA, userB, fieldDefs) {
  return fieldDefs.map((fieldDef) => {
    const valueA = userA?.[fieldDef.key] ?? '';
    const valueB = userB?.[fieldDef.key] ?? '';
    return { label: fieldDef.label, valueA, valueB, isDifferent: valueA !== valueB };
  });
}

/**
 * One row per distinct name across the *union* of both lists, sorted alphabetically (not "matches
 * first, then differences" - one consistent order that tends to keep similarly-named items near
 * each other). `hasA`/`hasB` are plain booleans, not the name repeated per column - the name is
 * already the row's own label, so the table renders presence/absence as a checkbox per user
 * instead (the "gap" this tab's design calls for is an unchecked box, not a blank cell).
 */
export function buildSetDiffRows(namesA, namesB) {
  const setA = new Set(namesA || []);
  const setB = new Set(namesB || []);
  const allNames = [...new Set([...setA, ...setB])].sort((a, b) => a.localeCompare(b));
  return allNames.map((name) => {
    const hasA = setA.has(name);
    const hasB = setB.has(name);
    return { label: name, hasA, hasB, isDifferent: hasA !== hasB };
  });
}

/** `rows` unchanged when showAll is true, otherwise only the rows that actually differ - the entire "Show All / Show Only Different" mechanism. */
export function filterDifferentOnly(rows, showAll) {
  return showAll ? rows : rows.filter((row) => row.isDifferent);
}
