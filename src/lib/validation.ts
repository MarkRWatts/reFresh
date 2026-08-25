/** Shared input bounds for free-text form fields, enforced server-side in
 *  every action (client `maxLength` is a UX nicety, not a backstop — it's
 *  trivially bypassed by posting straight to the action). */
export const MAX_TEXT_LENGTH = 256;

export function isTooLong(value: string, max: number = MAX_TEXT_LENGTH): boolean {
  return value.length > max;
}
