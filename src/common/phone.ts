/**
 * Every way a Bangladeshi mobile number may sit in the database: "+8801712345678" is the form the app stores, but
 * accounts made by hand (seed data, an old import) may hold "8801712345678" or "01712345678". Looking a number up
 * by all of them means a person is found whichever way their number was written, instead of a second, empty
 * account being created next to the real one at their next login.
 */
export function phoneLookupVariants(phone: string): string[] {
  const match = /^\+?880(1[3-9]\d{8})$/.exec(phone);
  if (!match) return [phone];
  const local = match[1];
  return [`+880${local}`, `880${local}`, `0${local}`];
}
