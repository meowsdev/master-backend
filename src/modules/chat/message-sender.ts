import { userDisplayName } from '../../common/contact-privacy';

/** What every chat message loads about its sender. */
export const SENDER_SELECT = { id: true, name: true, username: true, mobileNumber: true, role: true } as const;

/**
 * Gives the sender a WhatsApp-style `displayName` (name, else @username, else "017****4585") and drops
 * the phone number, so it never leaves the server: socket events skip the contact-privacy interceptor.
 */
export function withSenderDisplayName<
  T extends { sender: { name: string | null; username: string | null; mobileNumber: string } },
>(message: T) {
  const { mobileNumber: _hidden, ...sender } = message.sender;
  return { ...message, sender: { ...sender, displayName: userDisplayName(message.sender) } };
}
