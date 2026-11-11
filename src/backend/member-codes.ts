import { formatCode, highestNumber } from '../shared/member-codes';
import type { MemberProfile } from '../shared/types';
import type { Store } from './store';

/** Give cards without a code the next unused number, in the order members joined.
 *  With `only`, just that card: saving one card must not touch the others (a queued change checks they are unchanged). */
export function assignMemberCodes(store: Store, only?: string): MemberProfile[] {
  const members = store.members(), removed = store.list<MemberProfile>('removed_members');
  const missing = members.filter(member => !member.code && (only === undefined || member.id === only));
  if (!missing.length) return [];
  let last = highestNumber([...members, ...removed].map(member => member.code), store.get<{ last: number }>('member_codes', 'main')?.last ?? 0);
  const taken = new Set(members.map(member => member.code?.toLowerCase()).filter(Boolean));
  const updated: MemberProfile[] = [];
  store.transaction(() => {
    for (const member of missing) {
      let code = formatCode(++last);
      while (taken.has(code)) code = formatCode(++last);
      taken.add(code);
      const next = { ...member, code };
      store.put('members', member.id, next);
      updated.push(next);
    }
    store.put('member_codes', 'main', { last });
  });
  return updated;
}
